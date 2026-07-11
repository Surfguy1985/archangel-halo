import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, plaidItemsTable } from "@workspace/db";
import {
  ExchangePlaidPublicTokenBody,
  ExchangePlaidPublicTokenResponse,
  GetBankStatusResponse,
  ListBankAccountsResponse,
  ListBankTransactionsResponse,
  CreatePlaidLinkTokenResponse,
} from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const PLAID_BASE = "https://production.plaid.com";

async function plaidPost(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: any }> {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    return {
      ok: false,
      status: 500,
      data: { error_message: "Plaid credentials are not configured" },
    };
  }
  try {
    const res = await fetch(`${PLAID_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, secret, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    logger.warn({ err, path }, "Plaid request transport failure");
    return {
      ok: false,
      status: 502,
      data: { error_message: "Could not reach Plaid" },
    };
  }
}

function plaidErrorMessage(data: any): string {
  return (
    data?.error_message ||
    data?.display_message ||
    data?.error_code ||
    "Plaid request failed"
  );
}

async function getItem() {
  const [item] = await db.select().from(plaidItemsTable).limit(1);
  return item ?? null;
}

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
  }
  res.status(204).end();
});

export default router;
