import { db, plaidItemsTable } from "@workspace/db";
import { logger } from "./logger";

const PLAID_BASE = "https://production.plaid.com";

export async function plaidPost(
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

export function plaidErrorMessage(data: any): string {
  return (
    data?.error_message ||
    data?.display_message ||
    data?.error_code ||
    "Plaid request failed"
  );
}

export async function getPlaidItem() {
  const [item] = await db.select().from(plaidItemsTable).limit(1);
  return item ?? null;
}

export async function getPlaidItems() {
  return db.select().from(plaidItemsTable).orderBy(plaidItemsTable.createdAt);
}

export interface BankMtdCashflow {
  inflows: number;
  outflows: number;
}

interface CashflowCache {
  at: number;
  monthKey: string;
  data: BankMtdCashflow;
}

let cashflowCache: CashflowCache | null = null;
const CASHFLOW_TTL_MS = 5 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function invalidateBankCashflowCache(): void {
  cashflowCache = null;
}

/**
 * Month-to-date cash in/out from the connected bank via Plaid.
 * Returns null when no bank is connected or Plaid can't be reached.
 * Plaid convention: positive amount = money leaving the account.
 */
export async function getBankMtdCashflow(): Promise<BankMtdCashflow | null> {
  const items = await getPlaidItems();
  if (items.length === 0) return null;

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  if (
    cashflowCache &&
    cashflowCache.monthKey === monthKey &&
    Date.now() - cashflowCache.at < CASHFLOW_TTL_MS
  ) {
    return cashflowCache.data;
  }

  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const MAX_ROWS = 500;
  const all: any[] = [];
  for (const item of items) {
    let offset = 0;
    const perItem: any[] = [];
    for (;;) {
      const result = await plaidPost("/transactions/get", {
        access_token: item.accessToken,
        start_date: localDateStr(start),
        end_date: localDateStr(now),
        options: { count: 100, offset },
      });
      if (!result.ok) {
        logger.warn({ data: result.data }, "Plaid MTD cashflow fetch failed");
        return null;
      }
      const page = result.data.transactions ?? [];
      perItem.push(...page);
      const total = result.data.total_transactions ?? perItem.length;
      offset = perItem.length;
      if (perItem.length >= total || page.length === 0 || perItem.length >= MAX_ROWS) {
        break;
      }
    }
    all.push(...perItem);
  }

  let inflows = 0;
  let outflows = 0;
  for (const t of all) {
    const amt = Number(t.amount) || 0;
    if (amt < 0) inflows += -amt;
    else outflows += amt;
  }
  const data = {
    inflows: Math.round(inflows * 100) / 100,
    outflows: Math.round(outflows * 100) / 100,
  };
  cashflowCache = { at: Date.now(), monthKey, data };
  return data;
}
