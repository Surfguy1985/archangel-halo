import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  ledgerAccountsTable,
  journalEntriesTable,
  journalLinesTable,
} from "@workspace/db";
import {
  ListLedgerAccountsResponse,
  ListJournalEntriesQueryParams,
  ListJournalEntriesResponse,
  CreateJournalEntryBody,
  CreateJournalEntryResponse,
  DeleteJournalEntryParams,
  DeleteJournalEntryResponse,
  GetProfitAndLossQueryParams,
  GetProfitAndLossResponse,
  GetBalanceSheetReportQueryParams,
  GetBalanceSheetReportResponse,
  GetCashFlowReportQueryParams,
  GetCashFlowReportResponse,
  GetAccountLedgerQueryParams,
  GetAccountLedgerResponse,
  RebuildLedgerEntriesResponse,
  GetTaxReportQueryParams,
  GetTaxReportResponse,
  GetBankReconciliationQueryParams,
  GetBankReconciliationResponse,
  ImportBankTransactionBody,
} from "@workspace/api-zod";
import {
  ensureChartOfAccounts,
  postJournal,
  rebuildLedger,
  expenseAccountCode,
  syncExpenseLedger,
  withRefLock,
} from "../lib/ledger";
import { db as dbase, expensesTable } from "@workspace/db";
import { getPlaidItem, plaidPost, plaidErrorMessage } from "../lib/plaidClient";
import { logger } from "../lib/logger";
import { localToday } from "../lib/localDate";

const router: IRouter = Router();

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const DEBIT_NORMAL = new Set(["asset", "expense"]);

type AccountRow = typeof ledgerAccountsTable.$inferSelect;
type EntryRow = typeof journalEntriesTable.$inferSelect;
type LineRow = typeof journalLinesTable.$inferSelect;

async function loadLedger(): Promise<{
  accounts: AccountRow[];
  entries: EntryRow[];
  lines: LineRow[];
}> {
  await ensureChartOfAccounts();
  const [accounts, entries, lines] = await Promise.all([
    db.select().from(ledgerAccountsTable),
    db.select().from(journalEntriesTable),
    db.select().from(journalLinesTable),
  ]);
  accounts.sort((a, b) => a.code.localeCompare(b.code));
  return { accounts, entries, lines };
}

/** Natural-sign balance for an account given its lines. */
function naturalBalance(account: AccountRow, lines: LineRow[]): number {
  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    if (l.accountId !== account.id) continue;
    debit += l.debit;
    credit += l.credit;
  }
  return round2(DEBIT_NORMAL.has(account.type) ? debit - credit : credit - debit);
}

function serAccount(a: AccountRow, balance: number) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    type: a.type,
    isSystem: a.isSystem,
    balance,
  };
}

function serEntry(e: EntryRow, lines: LineRow[], accounts: Map<string, AccountRow>) {
  return {
    id: e.id,
    entryNo: e.entryNo,
    entryDate: e.entryDate,
    memo: e.memo,
    refType: e.refType,
    refId: e.refId,
    source: e.source,
    createdAt: e.createdAt ? e.createdAt.toISOString() : null,
    lines: lines
      .filter((l) => l.entryId === e.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => {
        const acct = accounts.get(l.accountId);
        return {
          id: l.id,
          accountId: l.accountId,
          accountCode: acct?.code ?? "?",
          accountName: acct?.name ?? "Unknown",
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        };
      }),
  };
}

router.get("/accounting/accounts", async (_req, res): Promise<void> => {
  const { accounts, lines } = await loadLedger();
  res.json(
    ListLedgerAccountsResponse.parse({
      accounts: accounts.map((a) => serAccount(a, naturalBalance(a, lines))),
    }),
  );
});

router.get("/accounting/journal", async (req, res): Promise<void> => {
  const { limit, accountId } = ListJournalEntriesQueryParams.parse(req.query);
  const { accounts, entries, lines } = await loadLedger();
  const acctMap = new Map(accounts.map((a) => [a.id, a]));
  let list = entries.sort((a, b) =>
    b.entryDate === a.entryDate
      ? (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0)
      : b.entryDate.localeCompare(a.entryDate),
  );
  if (accountId) {
    const touched = new Set(
      lines.filter((l) => l.accountId === accountId).map((l) => l.entryId),
    );
    list = list.filter((e) => touched.has(e.id));
  }
  list = list.slice(0, limit && limit > 0 ? limit : 100);
  res.json(
    ListJournalEntriesResponse.parse({
      entries: list.map((e) => serEntry(e, lines, acctMap)),
    }),
  );
});

router.post("/accounting/journal", async (req, res): Promise<void> => {
  const body = CreateJournalEntryBody.parse(req.body);
  try {
    const entryId = await postJournal({
      entryDate: body.entryDate,
      memo: body.memo ?? null,
      refType: "manual",
      refId: null,
      source: "manual",
      lines: body.lines.map((l) => ({
        accountCode: l.accountCode,
        debit: l.debit,
        credit: l.credit,
        description: l.description ?? null,
      })),
    });
    const { accounts, entries, lines } = await loadLedger();
    const entry = entries.find((e) => e.id === entryId)!;
    res.status(201).json(
      CreateJournalEntryResponse.parse(
        serEntry(entry, lines, new Map(accounts.map((a) => [a.id, a]))),
      ),
    );
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Invalid entry" });
  }
});

router.delete("/accounting/journal/:id", async (req, res): Promise<void> => {
  const { id } = DeleteJournalEntryParams.parse(req.params);
  const [entry] = await db
    .select()
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.id, id));
  if (!entry) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  if (entry.source === "system") {
    res.status(400).json({
      error: "System entries come from invoices/expenses — edit the source document instead",
    });
    return;
  }
  await db.transaction(async (tx) => {
    await tx.delete(journalLinesTable).where(eq(journalLinesTable.entryId, id));
    await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, id));
  });
  res.json(DeleteJournalEntryResponse.parse({ ok: true }));
});

function monthStart(): string {
  const t = localToday();
  return `${t.slice(0, 7)}-01`;
}

function inRange(d: string, from: string, to: string): boolean {
  return d >= from && d <= to;
}

router.get("/accounting/reports/pnl", async (req, res): Promise<void> => {
  const q = GetProfitAndLossQueryParams.parse(req.query);
  const from = q.from || monthStart();
  const to = q.to || localToday();
  const { accounts, entries, lines } = await loadLedger();
  const inWindow = new Set(
    entries.filter((e) => inRange(e.entryDate, from, to)).map((e) => e.id),
  );
  const winLines = lines.filter((l) => inWindow.has(l.entryId));
  const rows = (type: "income" | "expense") =>
    accounts
      .filter((a) => a.type === type)
      .map((a) => ({
        code: a.code,
        name: a.name,
        amount: naturalBalance(a, winLines),
      }))
      .filter((r) => r.amount !== 0);
  const income = rows("income");
  const expenses = rows("expense");
  const totalIncome = round2(income.reduce((s, r) => s + r.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, r) => s + r.amount, 0));
  res.json(
    GetProfitAndLossResponse.parse({
      from,
      to,
      income,
      expenses,
      totalIncome,
      totalExpenses,
      netProfit: round2(totalIncome - totalExpenses),
    }),
  );
});

router.get("/accounting/reports/balance-sheet", async (req, res): Promise<void> => {
  const q = GetBalanceSheetReportQueryParams.parse(req.query);
  const asOf = q.asOf || localToday();
  const { accounts, entries, lines } = await loadLedger();
  const upTo = new Set(entries.filter((e) => e.entryDate <= asOf).map((e) => e.id));
  const winLines = lines.filter((l) => upTo.has(l.entryId));
  const rows = (type: string) =>
    accounts
      .filter((a) => a.type === type)
      .map((a) => ({ code: a.code, name: a.name, amount: naturalBalance(a, winLines) }))
      .filter((r) => r.amount !== 0);
  const assets = rows("asset");
  const liabilities = rows("liability");
  const equity = rows("equity");
  // Retained earnings = lifetime income − expenses up to asOf.
  const retained = round2(
    accounts
      .filter((a) => a.type === "income")
      .reduce((s, a) => s + naturalBalance(a, winLines), 0) -
      accounts
        .filter((a) => a.type === "expense")
        .reduce((s, a) => s + naturalBalance(a, winLines), 0),
  );
  if (retained !== 0)
    equity.push({ code: "3900", name: "Retained Earnings", amount: retained });
  const totalAssets = round2(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.amount, 0));
  const totalEquity = round2(equity.reduce((s, r) => s + r.amount, 0));
  res.json(
    GetBalanceSheetReportResponse.parse({
      asOf,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
    }),
  );
});

router.get("/accounting/reports/cash-flow", async (req, res): Promise<void> => {
  const q = GetCashFlowReportQueryParams.parse(req.query);
  const from = q.from || monthStart();
  const to = q.to || localToday();
  const { accounts, entries, lines } = await loadLedger();
  const cash = accounts.find((a) => a.code === "1000");
  if (!cash) {
    res.json(
      GetCashFlowReportResponse.parse({
        from,
        to,
        inflows: [],
        outflows: [],
        netChange: 0,
        openingCash: 0,
        closingCash: 0,
      }),
    );
    return;
  }
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const inflowByAcct = new Map<string, number>();
  const outflowByAcct = new Map<string, number>();
  let openingCash = 0;
  let netChange = 0;
  for (const l of lines) {
    if (l.accountId !== cash.id) continue;
    const e = entryById.get(l.entryId);
    if (!e) continue;
    const delta = l.debit - l.credit;
    if (e.entryDate < from) {
      openingCash += delta;
      continue;
    }
    if (!inRange(e.entryDate, from, to)) continue;
    netChange += delta;
    // Categorize by the largest counter-account in the same entry.
    const counters = lines.filter(
      (x) => x.entryId === l.entryId && x.accountId !== cash.id,
    );
    counters.sort((a, b) => b.debit + b.credit - (a.debit + a.credit));
    const counter = counters[0] ? acctById.get(counters[0].accountId) : undefined;
    const key = counter ? counter.id : "other";
    const map = delta >= 0 ? inflowByAcct : outflowByAcct;
    map.set(key, (map.get(key) ?? 0) + Math.abs(delta));
  }
  const toRows = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([id, amount]) => {
        const a = acctById.get(id);
        return {
          code: a?.code ?? "—",
          name: a?.name ?? "Other",
          amount: round2(amount),
        };
      })
      .sort((x, y) => y.amount - x.amount);
  const opening = round2(openingCash);
  res.json(
    GetCashFlowReportResponse.parse({
      from,
      to,
      inflows: toRows(inflowByAcct),
      outflows: toRows(outflowByAcct),
      netChange: round2(netChange),
      openingCash: opening,
      closingCash: round2(opening + netChange),
    }),
  );
});

router.get("/accounting/ledger", async (req, res): Promise<void> => {
  const q = GetAccountLedgerQueryParams.parse(req.query);
  const { accounts, entries, lines } = await loadLedger();
  const account = accounts.find((a) => a.id === q.accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const from = q.from || "0000-01-01";
  const to = q.to || "9999-12-31";
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const acctLines = lines
    .filter((l) => l.accountId === account.id)
    .map((l) => ({ line: l, entry: entryById.get(l.entryId) }))
    .filter((x): x is { line: LineRow; entry: EntryRow } => Boolean(x.entry))
    .sort((a, b) =>
      a.entry.entryDate === b.entry.entryDate
        ? (a.entry.createdAt?.getTime() ?? 0) - (b.entry.createdAt?.getTime() ?? 0)
        : a.entry.entryDate.localeCompare(b.entry.entryDate),
    );
  let balance = 0;
  const out: Array<{
    entryId: string;
    entryNo: string;
    entryDate: string;
    memo: string | null;
    debit: number;
    credit: number;
    balance: number;
  }> = [];
  for (const { line, entry } of acctLines) {
    const delta = DEBIT_NORMAL.has(account.type)
      ? line.debit - line.credit
      : line.credit - line.debit;
    balance = round2(balance + delta);
    if (!inRange(entry.entryDate, from, to)) continue;
    out.push({
      entryId: entry.id,
      entryNo: entry.entryNo,
      entryDate: entry.entryDate,
      memo: entry.memo,
      debit: line.debit,
      credit: line.credit,
      balance,
    });
  }
  res.json(
    GetAccountLedgerResponse.parse({
      account: serAccount(account, naturalBalance(account, lines)),
      entries: out,
    }),
  );
});

router.post("/accounting/rebuild", async (_req, res): Promise<void> => {
  await ensureChartOfAccounts();
  const posted = await rebuildLedger();
  res.json(RebuildLedgerEntriesResponse.parse({ posted }));
});

// ---------------------------------------------------------------------------
// Tax report — sales tax + Schedule C expense mapping
// ---------------------------------------------------------------------------

const SCHEDULE_C_LINES: Record<string, { line: string; label: string }> = {
  "5000": { line: "11", label: "Contract labor" },
  "5100": { line: "22", label: "Supplies" },
  "5300": { line: "13", label: "Depreciation / equipment & tools" },
  "5400": { line: "9", label: "Car and truck expenses" },
  "5500": { line: "15", label: "Insurance" },
  "5900": { line: "27a", label: "Other expenses" },
};

router.get("/accounting/reports/tax", async (req, res): Promise<void> => {
  const { year: yearRaw } = GetTaxReportQueryParams.parse(req.query);
  const year = yearRaw ?? new Date().getFullYear();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const { accounts, entries, lines } = await loadLedger();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const entryById = new Map(entries.map((e) => [e.id, e]));

  let salesTaxCollected = 0;
  let salesTaxBalance = 0;
  let grossReceipts = 0;
  const expenseTotals = new Map<string, number>();

  for (const l of lines) {
    const acct = byId.get(l.accountId);
    const entry = entryById.get(l.entryId);
    if (!acct || !entry) continue;
    const inYear = entry.entryDate >= from && entry.entryDate <= to;
    if (acct.code === "2100") {
      salesTaxBalance += l.credit - l.debit;
      if (inYear) salesTaxCollected += l.credit;
    }
    if (!inYear) continue;
    if (acct.type === "income") grossReceipts += l.credit - l.debit;
    if (acct.type === "expense") {
      expenseTotals.set(
        acct.code,
        (expenseTotals.get(acct.code) ?? 0) + (l.debit - l.credit),
      );
    }
  }

  const scheduleC = Object.entries(SCHEDULE_C_LINES)
    .map(([code, m]) => ({
      line: m.line,
      label: m.label,
      amount: round2(expenseTotals.get(code) ?? 0),
    }))
    .filter((r) => r.amount !== 0);
  const totalExpenses = round2(
    [...expenseTotals.values()].reduce((s, v) => s + v, 0),
  );

  res.json(
    GetTaxReportResponse.parse({
      year,
      salesTaxCollected: round2(salesTaxCollected),
      salesTaxBalance: round2(salesTaxBalance),
      grossReceipts: round2(grossReceipts),
      scheduleC,
      totalExpenses,
      netProfit: round2(grossReceipts - totalExpenses),
    }),
  );
});

// ---------------------------------------------------------------------------
// Bank reconciliation — match Plaid transactions to ledger cash lines
// ---------------------------------------------------------------------------

async function fetchBankTransactions(days: number): Promise<
  | { ok: true; truncated: boolean; txns: Array<{ transactionId: string; date: string; name: string; merchantName: string | null; category: string | null; amount: number; pending: boolean }> }
  | { ok: false; error: string; status: number }
> {
  const item = await getPlaidItem();
  if (!item) return { ok: false, error: "No bank connected", status: 409 };
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  const all: any[] = [];
  let offset = 0;
  let truncated = false;
  for (;;) {
    const result = await plaidPost("/transactions/get", {
      access_token: item.accessToken,
      start_date: fmt(start),
      end_date: fmt(end),
      options: { count: 100, offset, include_personal_finance_category: true },
    });
    if (!result.ok) {
      logger.warn({ data: result.data }, "Plaid reconcile fetch failed");
      return { ok: false, error: plaidErrorMessage(result.data), status: 502 };
    }
    const page = result.data.transactions ?? [];
    all.push(...page);
    const total = result.data.total_transactions ?? all.length;
    offset = all.length;
    if (all.length >= total || page.length === 0) break;
    if (all.length >= 2000) {
      truncated = true;
      break;
    }
  }
  return {
    ok: true,
    truncated,
    txns: all.map((t: any) => ({
      transactionId: String(t.transaction_id),
      date: String(t.date),
      name: String(t.name ?? ""),
      merchantName: t.merchant_name ?? null,
      category:
        t.personal_finance_category?.primary?.replaceAll("_", " ") ??
        t.category?.[0] ??
        null,
      amount: Number(t.amount) || 0,
      pending: !!t.pending,
    })),
  };
}

function dateDiffDays(a: string, b: string): number {
  return Math.abs(
    (new Date(a + "T00:00:00").getTime() - new Date(b + "T00:00:00").getTime()) /
      86400000,
  );
}

router.get("/accounting/bank/reconcile", async (req, res): Promise<void> => {
  const { days: daysRaw } = GetBankReconciliationQueryParams.parse(req.query);
  const days = Math.min(Math.max(daysRaw ?? 30, 1), 90);
  const bank = await fetchBankTransactions(days);
  if (!bank.ok) {
    res.status(bank.status).json({ error: bank.error });
    return;
  }
  const { accounts, entries, lines } = await loadLedger();
  const cash = accounts.find((a) => a.code === "1000");
  const entryById = new Map(entries.map((e) => [e.id, e]));
  // Cash ledger lines: debit = money in, credit = money out.
  const cashLines = lines
    .filter((l) => cash && l.accountId === cash.id)
    .map((l) => {
      const e = entryById.get(l.entryId)!;
      return {
        entryNo: e.entryNo,
        memo: e.memo,
        refType: e.refType,
        date: e.entryDate,
        in: l.debit,
        out: l.credit,
        used: false,
      };
    });
  let ledgerCash = 0;
  for (const l of cashLines) ledgerCash += l.in - l.out;

  const importedMemos = entries
    .filter((e) => e.refType === "bank_import")
    .map((e) => e.memo ?? "");
  const importedExpenses = await dbase
    .select({ source: expensesTable.source })
    .from(expensesTable);
  const importedIds = new Set(
    importedExpenses
      .map((e) => e.source ?? "")
      .filter((src) => src.startsWith("bank:"))
      .map((src) => src.slice(5)),
  );

  const transactions = bank.txns.map((t) => {
    // Plaid: positive amount = money out; negative = money in.
    const direction = t.amount < 0 ? "in" : "out";
    const amt = round2(Math.abs(t.amount));
    if (
      importedIds.has(t.transactionId) ||
      importedMemos.some((m) => m.includes(t.transactionId))
    ) {
      return { ...t, amount: amt, direction, status: "imported", matchedEntryNo: null, matchedMemo: null };
    }
    const candidate = cashLines.find(
      (l) =>
        !l.used &&
        Math.abs((direction === "in" ? l.in : l.out) - amt) < 0.01 &&
        dateDiffDays(l.date, t.date) <= 5,
    );
    if (candidate) {
      candidate.used = true;
      return {
        ...t,
        amount: amt,
        direction,
        status: "matched",
        matchedEntryNo: candidate.entryNo,
        matchedMemo: candidate.memo,
      };
    }
    return { ...t, amount: amt, direction, status: "unmatched", matchedEntryNo: null, matchedMemo: null };
  });

  res.json(
    GetBankReconciliationResponse.parse({
      transactions,
      matchedCount: transactions.filter((t) => t.status === "matched").length,
      unmatchedCount: transactions.filter((t) => t.status === "unmatched").length,
      ledgerCash: round2(ledgerCash),
      truncated: bank.truncated,
    }),
  );
});

router.post("/accounting/bank/import", async (req, res): Promise<void> => {
  const body = ImportBankTransactionBody.parse(req.body);
  if (!(body.amount > 0)) {
    res.status(400).json({ error: "Amount must be positive" });
    return;
  }
  // Serialize per bank transaction so concurrent imports can't both pass the
  // duplicate check.
  await withRefLock(`bank-import:${body.transactionId}`, async () => {
  // Skip duplicates: inflows tag the journal memo, outflows the expense source.
  const { entries } = await loadLedger();
  const dupJournal = entries.some(
    (e) => e.refType === "bank_import" && (e.memo ?? "").includes(body.transactionId),
  );
  const dupExpense = await dbase
    .select({ id: expensesTable.id })
    .from(expensesTable)
    .where(eq(expensesTable.source, `bank:${body.transactionId}`));
  if (dupJournal || dupExpense.length > 0) {
    res.json({ ok: true, message: "Already imported" });
    return;
  }
  if (body.direction === "out") {
    // Money out → a real expense; source tags the bank txn id for dedup.
    const [row] = await dbase
      .insert(expensesTable)
      .values({
        vendor: body.name,
        category: body.category ?? null,
        amount: round2(body.amount),
        source: `bank:${body.transactionId}`,
        spentOn: new Date(body.date + "T12:00:00"),
      })
      .returning();
    await syncExpenseLedger(row.id);
    res.json({ ok: true, message: `Logged expense — ${body.name}` });
    return;
  }
  // Money in → cash deposit posted straight to the books.
  await postJournal({
    entryDate: body.date,
    memo: `Bank import ${body.transactionId}: ${body.name}`,
    refType: "bank_import",
    refId: null,
    source: "manual",
    lines: [
      { accountCode: "1000", debit: round2(body.amount) },
      { accountCode: "4000", credit: round2(body.amount) },
    ],
  });
  res.json({ ok: true, message: `Recorded deposit — ${body.name}` });
  });
});

export default router;
