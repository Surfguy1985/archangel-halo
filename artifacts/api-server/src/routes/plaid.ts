import { Router, type IRouter } from "express";
import { eq, inArray, like } from "drizzle-orm";
import {
  db,
  plaidItemsTable,
  crewsTable,
  invoicesTable,
  propertiesTable,
  expensesTable,
  crewPaymentsTable,
  paymentsTable,
} from "@workspace/db";
import {
  plaidPost,
  plaidErrorMessage,
  getPlaidItem as getItem,
  invalidateBankCashflowCache,
} from "../lib/plaidClient";
import {
  ExchangePlaidPublicTokenBody,
  ExchangePlaidPublicTokenResponse,
  GetBankStatusResponse,
  ListBankAccountsResponse,
  ListBankTransactionsResponse,
  CreatePlaidLinkTokenResponse,
  GetBankAnalysisResponse,
  GetBankAnalysisQueryParams,
  ApplyBankAnalysisQueryParams,
  ApplyBankAnalysisResponse,
} from "@workspace/api-zod";
import { completeJson } from "../lib/ai";
import { logger } from "../lib/logger";
import { syncExpenseLedger, syncInvoiceLedger } from "../lib/ledger";
import { recomputeJobFinancials } from "../lib/jobFinance";

const router: IRouter = Router();

router.post("/plaid/link-token", async (_req, res): Promise<void> => {
  const result = await plaidPost("/link/token/create", {
    user: { client_user_id: "halo-admin" },
    client_name: "HALO — ArchAngel Operations",
    products: ["transactions"],
    country_codes: ["US"],
    language: "en",
  });
  if (!result.ok) {
    logger.warn({ data: result.data }, "Plaid link token failed");
    res.status(502).json({ error: plaidErrorMessage(result.data) });
    return;
  }
  res.json(
    CreatePlaidLinkTokenResponse.parse({ linkToken: result.data.link_token }),
  );
});

router.post("/plaid/exchange", async (req, res): Promise<void> => {
  const body = ExchangePlaidPublicTokenBody.parse(req.body);
  const result = await plaidPost("/item/public_token/exchange", {
    public_token: body.publicToken,
  });
  if (!result.ok) {
    logger.warn({ data: result.data }, "Plaid token exchange failed");
    res.status(502).json({ error: plaidErrorMessage(result.data) });
    return;
  }
  // Single-org: replace any previous connection.
  await db.transaction(async (tx) => {
    await tx.delete(plaidItemsTable);
    await tx.insert(plaidItemsTable).values({
      itemId: result.data.item_id,
      accessToken: result.data.access_token,
      institutionName: body.institutionName ?? null,
    });
  });
  invalidateBankCashflowCache();
  invalidateBankAnalysisCache();
  const item = await getItem();
  res.json(
    ExchangePlaidPublicTokenResponse.parse({
      connected: true,
      institutionName: item?.institutionName ?? null,
      connectedAt: item?.createdAt?.toISOString() ?? null,
    }),
  );
});

router.get("/plaid/status", async (_req, res): Promise<void> => {
  const item = await getItem();
  res.json(
    GetBankStatusResponse.parse({
      connected: !!item,
      institutionName: item?.institutionName ?? null,
      connectedAt: item?.createdAt?.toISOString() ?? null,
    }),
  );
});

router.get("/plaid/accounts", async (_req, res): Promise<void> => {
  const item = await getItem();
  if (!item) {
    res.status(409).json({ error: "No bank connected" });
    return;
  }
  const result = await plaidPost("/accounts/balance/get", {
    access_token: item.accessToken,
  });
  if (!result.ok) {
    logger.warn({ data: result.data }, "Plaid balance fetch failed");
    res.status(502).json({ error: plaidErrorMessage(result.data) });
    return;
  }
  const accounts = (result.data.accounts ?? []).map((a: any) => ({
    accountId: a.account_id,
    name: a.name,
    officialName: a.official_name ?? null,
    mask: a.mask ?? null,
    type: a.type,
    subtype: a.subtype ?? null,
    availableBalance: a.balances?.available ?? null,
    currentBalance: a.balances?.current ?? null,
    currency: a.balances?.iso_currency_code ?? null,
  }));
  res.json(ListBankAccountsResponse.parse(accounts));
});

router.get("/plaid/transactions", async (req, res): Promise<void> => {
  const item = await getItem();
  if (!item) {
    res.status(409).json({ error: "No bank connected" });
    return;
  }
  const daysRaw = Number(req.query.days);
  const days =
    Number.isFinite(daysRaw) && daysRaw >= 1 && daysRaw <= 90
      ? Math.floor(daysRaw)
      : 30;
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const MAX_ROWS = 500;
  const all: any[] = [];
  let offset = 0;
  for (;;) {
    const result = await plaidPost("/transactions/get", {
      access_token: item.accessToken,
      start_date: fmt(start),
      end_date: fmt(end),
      options: { count: 100, offset, include_personal_finance_category: true },
    });
    if (!result.ok) {
      logger.warn({ data: result.data }, "Plaid transactions fetch failed");
      res.status(502).json({ error: plaidErrorMessage(result.data) });
      return;
    }
    const page = result.data.transactions ?? [];
    all.push(...page);
    const total = result.data.total_transactions ?? all.length;
    offset = all.length;
    if (all.length >= total || page.length === 0 || all.length >= MAX_ROWS) {
      break;
    }
  }
  const txns = all.map((t: any) => ({
    transactionId: t.transaction_id,
    accountId: t.account_id,
    amount: t.amount,
    date: t.date,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    category:
      t.personal_finance_category?.primary?.replaceAll("_", " ") ??
      t.category?.[0] ??
      null,
    pending: !!t.pending,
  }));
  res.json(ListBankTransactionsResponse.parse(txns));
});

interface RawTxn {
  transactionId: string;
  date: string;
  name: string;
  merchantName: string | null;
  amount: number;
  pending: boolean;
}

async function fetchTxns(
  accessToken: string,
  days: number,
): Promise<RawTxn[] | null> {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const MAX_ROWS = 500;
  const all: any[] = [];
  let offset = 0;
  for (;;) {
    const result = await plaidPost("/transactions/get", {
      access_token: accessToken,
      start_date: fmt(start),
      end_date: fmt(end),
      options: { count: 100, offset },
    });
    if (!result.ok) {
      logger.warn({ data: result.data }, "Plaid analysis txn fetch failed");
      return null;
    }
    const page = result.data.transactions ?? [];
    all.push(...page);
    const total = result.data.total_transactions ?? all.length;
    offset = all.length;
    if (all.length >= total || page.length === 0 || all.length >= MAX_ROWS) break;
  }
  return all.map((t: any) => ({
    transactionId: t.transaction_id,
    date: t.date,
    name: t.name,
    merchantName: t.merchant_name ?? null,
    amount: Number(t.amount) || 0,
    pending: !!t.pending,
  }));
}

const SUPPLY_VENDORS = [
  "lowe's",
  "lowes",
  "home depot",
  "homedepot",
  "menards",
  "ace hardware",
  "sherwin",
  "sherwin-williams",
  "harbor freight",
  "true value",
  "tractor supply",
  "ferguson",
  "grainger",
  "fastenal",
  "floor & decor",
  "floor and decor",
  "batteries plus",
  "paint",
  "plumbing supply",
  "hd supply",
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** True when every meaningful token of the crew name appears in the txn text. */
function crewNameInText(crewName: string, text: string): boolean {
  const tokens = norm(crewName)
    .split(" ")
    .filter((t) => t.length >= 3 && !["llc", "inc", "the", "and"].includes(t));
  if (tokens.length === 0) return false;
  const t = ` ${norm(text)} `;
  return tokens.every((tok) => t.includes(` ${tok} `));
}

interface AnalysisItem {
  transactionId: string;
  date: string;
  name: string;
  amount: number;
  category?: string | null;
  personName?: string | null;
  crewId?: string | null;
  crewName?: string | null;
  invoiceId?: string | null;
  invoiceNo?: string | null;
  propertyName?: string | null;
  note?: string | null;
}

interface AnalysisData {
  periodDays: number;
  analyzedAt: string;
  expenses: AnalysisItem[];
  crewPayments: AnalysisItem[];
  paidInvoices: AnalysisItem[];
  other: AnalysisItem[];
  totals: {
    expenses: number;
    crewPayments: number;
    paidInvoices: number;
    other: number;
  };
}

const analysisCache = new Map<string, { at: number; data: AnalysisData }>();
const ANALYSIS_TTL_MS = 5 * 60 * 1000;
const analysisInFlight = new Map<string, Promise<AnalysisData>>();

export function invalidateBankAnalysisCache(): void {
  analysisCache.clear();
}

function parseLocalDate(s: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date() : d;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function buildAnalysis(accessToken: string, days: number): Promise<AnalysisData> {
  const txns = await fetchTxns(accessToken, days);
  if (!txns) throw Object.assign(new Error("Plaid fetch failed"), { plaid: true });

  const [crews, invoiceRows] = await Promise.all([
    db.select().from(crewsTable),
    db
      .select({
        id: invoicesTable.id,
        invoiceNo: invoicesTable.invoiceNo,
        amount: invoicesTable.amount,
        taxAmount: invoicesTable.taxAmount,
        status: invoicesTable.status,
        propertyId: invoicesTable.propertyId,
      })
      .from(invoicesTable)
      .where(inArray(invoicesTable.status, ["sent", "overdue", "paid"])),
  ]);
  const propIds = [...new Set(invoiceRows.map((i) => i.propertyId))];
  const props = propIds.length
    ? await db
        .select({ id: propertiesTable.id, name: propertiesTable.name })
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propName = new Map(props.map((p) => [p.id, p.name]));

  const expenses: AnalysisItem[] = [];
  const crewPayments: AnalysisItem[] = [];
  const paidInvoices: AnalysisItem[] = [];
  const other: AnalysisItem[] = [];

  // --- Inflows (Plaid: negative amount = money in) → paid invoices section.
  const usedInvoiceIds = new Set<string>();
  for (const t of txns.filter((t) => t.amount < 0)) {
    const amt = round2(-t.amount);
    const match = invoiceRows.find(
      (inv) => !usedInvoiceIds.has(inv.id) && Math.abs(inv.amount - amt) < 0.01,
    );
    if (match) usedInvoiceIds.add(match.id);
    paidInvoices.push({
      transactionId: t.transactionId,
      date: t.date,
      name: t.merchantName || t.name,
      amount: amt,
      invoiceId: match?.id ?? null,
      invoiceNo: match ? match.invoiceNo : null,
      propertyName: match ? (propName.get(match.propertyId) ?? null) : null,
      note: match ? `Matches invoice ${match.invoiceNo}` : "Deposit — no matching invoice",
    });
  }

  // --- Outflows: crew name cross-reference first, then vendor keywords, then AI.
  const unresolved: RawTxn[] = [];
  for (const t of txns.filter((t) => t.amount > 0)) {
    const text = `${t.name} ${t.merchantName ?? ""}`;
    const crew = crews.find((c) => crewNameInText(c.name, text));
    if (crew) {
      crewPayments.push({
        transactionId: t.transactionId,
        date: t.date,
        name: t.merchantName || t.name,
        amount: round2(t.amount),
        personName: crew.name,
        crewId: crew.id,
        crewName: crew.name,
        note: "Matched to your crew list",
      });
      continue;
    }
    const lower = norm(text);
    if (SUPPLY_VENDORS.some((v) => lower.includes(norm(v)))) {
      expenses.push({
        transactionId: t.transactionId,
        date: t.date,
        name: t.merchantName || t.name,
        amount: round2(t.amount),
        category: "Supplies",
      });
      continue;
    }
    unresolved.push(t);
  }

  // --- AI classification for everything the rules couldn't place.
  if (unresolved.length > 0) {
    const batch = unresolved.slice(0, 150);
    let classified: Record<
      string,
      { section?: string; category?: string; personName?: string }
    > = {};
    try {
      const ai = await completeJson<{
        items?: {
          id?: string;
          section?: string;
          category?: string;
          personName?: string;
        }[];
      }>(
        `You classify bank transactions for Archangel, a contracting company serving apartment communities. For each outgoing transaction decide:
- "expense": purchases from stores/vendors/suppliers (hardware, paint, materials, fuel, tools, software, insurance, utilities, rent, subcontracted services from companies). Give a short category: Supplies, Fuel, Equipment, Software, Insurance, Utilities, Office, Services, Meals, Travel, or Other.
- "crew": payments to an individual PERSON (Zelle/Venmo/Cash App/check/ACH/payroll with a human name). Extract the person's full name into personName, title-cased.
- "other": credit card payments, transfers between own accounts, loan payments, taxes, bank fees, ATM withdrawals — anything that is not a business expense or a person payment.
Known crew members (already matched separately, but use as context): ${crews.map((c) => c.name).join(", ") || "none"}.
Return {"items":[{"id","section","category","personName"}]} covering EVERY id given.`,
        JSON.stringify(
          batch.map((t) => ({
            id: t.transactionId,
            text: `${t.name}${t.merchantName ? ` | ${t.merchantName}` : ""}`,
            amount: t.amount,
            date: t.date,
          })),
        ),
      );
      for (const it of ai.items ?? []) {
        if (it.id) classified[it.id] = it;
      }
    } catch (err) {
      logger.warn({ err }, "Bank analysis AI classification failed; using fallback");
      classified = {};
    }

    for (const t of unresolved) {
      const c = classified[t.transactionId];
      const base: AnalysisItem = {
        transactionId: t.transactionId,
        date: t.date,
        name: t.merchantName || t.name,
        amount: round2(t.amount),
      };
      if (c?.section === "crew") {
        crewPayments.push({
          ...base,
          personName: c.personName?.trim() || t.merchantName || t.name,
          crewId: null,
          crewName: null,
          note: "Not on your crew list",
        });
      } else if (c?.section === "other") {
        other.push({ ...base, category: c.category ?? null });
      } else if (c?.section === "expense") {
        expenses.push({ ...base, category: c.category?.trim() || "Other" });
      } else {
        // AI missing/failed for this txn — default to expense so nothing is hidden.
        expenses.push({ ...base, category: "Uncategorized" });
      }
    }
  }

  const sum = (arr: AnalysisItem[]) => round2(arr.reduce((s, i) => s + i.amount, 0));
  const byDateDesc = (a: AnalysisItem, b: AnalysisItem) => b.date.localeCompare(a.date);
  expenses.sort(byDateDesc);
  crewPayments.sort(byDateDesc);
  paidInvoices.sort(byDateDesc);
  other.sort(byDateDesc);

  return {
    periodDays: days,
    analyzedAt: new Date().toISOString(),
    expenses,
    crewPayments,
    paidInvoices,
    other,
    totals: {
      expenses: sum(expenses),
      crewPayments: sum(crewPayments),
      paidInvoices: sum(paidInvoices),
      other: sum(other),
    },
  };
}

router.get("/plaid/analysis", async (req, res): Promise<void> => {
  const item = await getItem();
  if (!item) {
    res.status(409).json({ error: "No bank connected" });
    return;
  }
  const q = GetBankAnalysisQueryParams.parse(req.query);
  const days = q.days ?? 30;
  // Explicit parse: zod boolean coercion would treat "false" as true.
  const refresh = String(req.query.refresh) === "true";
  const cacheKey = `${item.id}:${days}`;

  const cached = analysisCache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < ANALYSIS_TTL_MS) {
    res.json(GetBankAnalysisResponse.parse(cached.data));
    return;
  }

  try {
    let inFlight = analysisInFlight.get(cacheKey);
    if (!inFlight) {
      inFlight = buildAnalysis(item.accessToken, days).finally(() => {
        analysisInFlight.delete(cacheKey);
      });
      analysisInFlight.set(cacheKey, inFlight);
    }
    const data = await inFlight;
    analysisCache.set(cacheKey, { at: Date.now(), data });
    res.json(GetBankAnalysisResponse.parse(data));
  } catch (err: any) {
    if (err?.plaid) {
      res.status(502).json({ error: "Couldn't fetch transactions from your bank" });
      return;
    }
    throw err;
  }
});

// Serialize apply runs: read-then-insert dedupe checks are only safe when
// one apply executes at a time (single-instance server, single-org app).
let applyChain: Promise<unknown> = Promise.resolve();

router.post("/plaid/analysis/apply", async (req, res): Promise<void> => {
  const run = applyChain.then(() => handleApply(req, res));
  applyChain = run.catch(() => undefined);
  await run;
});

async function handleApply(
  req: import("express").Request,
  res: import("express").Response,
): Promise<void> {
  const item = await getItem();
  if (!item) {
    res.status(409).json({ error: "No bank connected" });
    return;
  }
  const q = ApplyBankAnalysisQueryParams.parse(req.query);
  const days = q.days ?? 30;
  const cacheKey = `${item.id}:${days}`;

  let data: AnalysisData;
  try {
    const cached = analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.at < ANALYSIS_TTL_MS) {
      data = cached.data;
    } else {
      let inFlight = analysisInFlight.get(cacheKey);
      if (!inFlight) {
        inFlight = buildAnalysis(item.accessToken, days).finally(() => {
          analysisInFlight.delete(cacheKey);
        });
        analysisInFlight.set(cacheKey, inFlight);
      }
      data = await inFlight;
      analysisCache.set(cacheKey, { at: Date.now(), data });
    }
  } catch (err: any) {
    if (err?.plaid) {
      res.status(502).json({ error: "Couldn't fetch transactions from your bank" });
      return;
    }
    throw err;
  }

  let expensesCreated = 0;
  let crewPaymentsCreated = 0;
  let invoicesPaid = 0;
  let skippedExisting = 0;
  let skippedUnmatched = 0;

  for (const itemRow of data.expenses) {
    const sourceTag = `bank:${itemRow.transactionId}`;
    const [existing] = await db
      .select({ id: expensesTable.id })
      .from(expensesTable)
      .where(eq(expensesTable.source, sourceTag));
    if (existing) {
      skippedExisting++;
      continue;
    }
    const [row] = await db
      .insert(expensesTable)
      .values({
        vendor: itemRow.name,
        category: itemRow.category ?? "Uncategorized",
        amount: itemRow.amount,
        source: sourceTag,
        paymentStatus: "paid",
        paidAt: new Date(),
        spentOn: parseLocalDate(itemRow.date),
      })
      .returning();
    await syncExpenseLedger(row.id);
    expensesCreated++;
  }

  for (const itemRow of data.crewPayments) {
    let crewId = itemRow.crewId ?? null;
    if (!crewId && itemRow.personName) {
      const wanted = itemRow.personName.trim().toLowerCase();
      const allCrews = await db.select().from(crewsTable);
      const found = allCrews.find((c) => c.name.trim().toLowerCase() === wanted);
      if (found) {
        crewId = found.id;
      } else {
        const [createdCrew] = await db
          .insert(crewsTable)
          .values({ name: itemRow.personName.trim() })
          .returning();
        crewId = createdCrew.id;
      }
    }
    if (!crewId) {
      skippedUnmatched++;
      continue;
    }
    const dedupeTag = `bank:${itemRow.transactionId}`;
    const [existing] = await db
      .select({ id: crewPaymentsTable.id })
      .from(crewPaymentsTable)
      .where(like(crewPaymentsTable.note, `%${dedupeTag}%`));
    if (existing) {
      skippedExisting++;
      continue;
    }
    await db.insert(crewPaymentsTable).values({
      crewId,
      amount: itemRow.amount,
      method: "Bank",
      status: "completed",
      note: `Imported from bank (${dedupeTag})`,
      paidAt: parseLocalDate(itemRow.date),
    });
    crewPaymentsCreated++;
  }

  for (const itemRow of data.paidInvoices) {
    if (!itemRow.invoiceId) {
      skippedUnmatched++;
      continue;
    }
    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, itemRow.invoiceId));
    if (!inv || inv.status === "paid") {
      skippedExisting++;
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.insert(paymentsTable).values({
        invoiceId: inv.id,
        amount: itemRow.amount,
        method: "Bank deposit",
        receivedAt: parseLocalDate(itemRow.date),
      });
      await tx
        .update(invoicesTable)
        .set({ status: "paid", paidAt: parseLocalDate(itemRow.date) })
        .where(eq(invoicesTable.id, inv.id));
    });
    if (inv.jobId) await recomputeJobFinancials(inv.jobId);
    await syncInvoiceLedger(inv.id);
    invoicesPaid++;
  }

  res.json(
    ApplyBankAnalysisResponse.parse({
      expensesCreated,
      crewPaymentsCreated,
      invoicesPaid,
      skippedExisting,
      skippedUnmatched,
    }),
  );
}

router.delete("/plaid/item", async (_req, res): Promise<void> => {
  const item = await getItem();
  if (item) {
    const result = await plaidPost("/item/remove", {
      access_token: item.accessToken,
    });
    if (!result.ok) {
      logger.warn({ data: result.data }, "Plaid item remove failed (deleting locally anyway)");
    }
    await db.delete(plaidItemsTable).where(eq(plaidItemsTable.id, item.id));
    invalidateBankCashflowCache();
    invalidateBankAnalysisCache();
  }
  res.status(204).end();
});

export default router;
