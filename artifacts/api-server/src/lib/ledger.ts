import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  ledgerAccountsTable,
  journalEntriesTable,
  journalLinesTable,
  invoicesTable,
  expensesTable,
  jobsTable,
  type LedgerAccountRow,
  type Invoice,
  type Expense,
} from "@workspace/db";
import { localToday } from "./localDate";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// In-process per-key mutex: serializes remove+repost cycles for the same
// source document so concurrent syncs can't double-post (single-server app).
const refLocks = new Map<string, Promise<void>>();
export async function withRefLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = refLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  refLocks.set(key, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (refLocks.get(key) === gate) refLocks.delete(key);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const CHART_OF_ACCOUNTS: ReadonlyArray<{
  code: string;
  name: string;
  type: "asset" | "liability" | "equity" | "income" | "expense";
}> = [
  { code: "1000", name: "Cash", type: "asset" },
  { code: "1100", name: "Accounts Receivable", type: "asset" },
  { code: "2000", name: "Accounts Payable", type: "liability" },
  { code: "2100", name: "Sales Tax Payable", type: "liability" },
  { code: "3000", name: "Owner's Equity", type: "equity" },
  { code: "4000", name: "Service Revenue", type: "income" },
  { code: "5000", name: "Crew Labor", type: "expense" },
  { code: "5100", name: "Materials & Supplies", type: "expense" },
  { code: "5300", name: "Equipment & Tools", type: "expense" },
  { code: "5400", name: "Vehicle & Fuel", type: "expense" },
  { code: "5500", name: "Insurance & Licenses", type: "expense" },
  { code: "5900", name: "Other Expenses", type: "expense" },
];

/** Idempotently create the default chart of accounts. */
export async function ensureChartOfAccounts(): Promise<void> {
  const existing = await db.select().from(ledgerAccountsTable);
  const byCode = new Set(existing.map((a) => a.code));
  const missing = CHART_OF_ACCOUNTS.filter((a) => !byCode.has(a.code));
  if (missing.length > 0) {
    await db
      .insert(ledgerAccountsTable)
      .values(missing.map((a) => ({ ...a, isSystem: true })))
      .onConflictDoNothing();
  }
}

let accountCache: Map<string, LedgerAccountRow> | null = null;

export function invalidateAccountCache(): void {
  accountCache = null;
}

export async function accountsByCode(): Promise<Map<string, LedgerAccountRow>> {
  if (accountCache) return accountCache;
  await ensureChartOfAccounts();
  const rows = await db.select().from(ledgerAccountsTable);
  accountCache = new Map(rows.map((a) => [a.code, a]));
  return accountCache;
}

/** Map a free-form expense category to an expense account code. */
export function expenseAccountCode(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (/labor|crew|sub|payroll|wage/.test(c)) return "5000";
  if (/equip|tool|rental/.test(c)) return "5300";
  if (/vehicle|fuel|gas|truck|mileage/.test(c)) return "5400";
  if (/insur|license|permit|bond/.test(c)) return "5500";
  if (/material|supplie|supply|lumber|paint|parts|hardware/.test(c))
    return "5100";
  if (c) return "5900";
  return "5100";
}

export type JournalLineInput = {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string | null;
};

async function nextEntryNo(tx: Tx): Promise<string> {
  // Advisory lock serializes JE numbering across concurrent transactions.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('journal_entry_no'))`);
  const rows = await tx
    .select({ entryNo: journalEntriesTable.entryNo })
    .from(journalEntriesTable);
  let maxNo = 1000;
  for (const r of rows) {
    const m = /^JE-(\d+)$/.exec(r.entryNo);
    if (m) maxNo = Math.max(maxNo, Number(m[1]));
  }
  return `JE-${maxNo + 1}`;
}

/**
 * Post a balanced journal entry. Throws when the lines don't balance or an
 * account code is unknown. Returns the new entry id.
 */
export async function postJournal(input: {
  entryDate?: string;
  memo?: string | null;
  refType?: string;
  refId?: string | null;
  source?: string;
  lines: JournalLineInput[];
}): Promise<string> {
  const accounts = await accountsByCode();
  const lines = input.lines.filter(
    (l) => round2(l.debit ?? 0) !== 0 || round2(l.credit ?? 0) !== 0,
  );
  if (lines.length < 2) throw new Error("A journal entry needs at least two lines");
  let debits = 0;
  let credits = 0;
  for (const l of lines) {
    if (!accounts.has(l.accountCode))
      throw new Error(`Unknown account code ${l.accountCode}`);
    if ((l.debit ?? 0) < 0 || (l.credit ?? 0) < 0)
      throw new Error("Debits and credits must be positive");
    debits += l.debit ?? 0;
    credits += l.credit ?? 0;
  }
  if (Math.abs(round2(debits) - round2(credits)) > 0.005)
    throw new Error(
      `Entry is out of balance (debits ${round2(debits)} vs credits ${round2(credits)})`,
    );
  return db.transaction(async (tx) => {
    const entryNo = await nextEntryNo(tx);
    const [entry] = await tx
      .insert(journalEntriesTable)
      .values({
        entryNo,
        entryDate: input.entryDate ?? localToday(),
        memo: input.memo ?? null,
        refType: input.refType ?? "manual",
        refId: input.refId ?? null,
        source: input.source ?? "manual",
      })
      .returning();
    await tx.insert(journalLinesTable).values(
      lines.map((l, i) => ({
        entryId: entry.id,
        accountId: accounts.get(l.accountCode)!.id,
        debit: round2(l.debit ?? 0),
        credit: round2(l.credit ?? 0),
        description: l.description ?? null,
        sortOrder: i,
      })),
    );
    return entry.id;
  });
}

/** Delete all system entries for a given source-document reference. */
export async function removeEntriesForRef(
  refTypes: string[],
  refId: string,
): Promise<void> {
  const entries = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(
      and(
        inArray(journalEntriesTable.refType, refTypes),
        eq(journalEntriesTable.refId, refId),
      ),
    );
  if (entries.length === 0) return;
  const ids = entries.map((e) => e.id);
  await db.delete(journalLinesTable).where(inArray(journalLinesTable.entryId, ids));
  await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
}

function dateOnly(d: Date | string | null | undefined): string {
  if (!d) return localToday();
  if (typeof d === "string") return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Idempotently (re)post the ledger entries for an invoice: revenue when
 * non-draft, cash receipt when paid. Call after any invoice mutation;
 * pass the invoice id of a deleted invoice to clean its entries up.
 */
export async function syncInvoiceLedger(invoiceId: string): Promise<void> {
  await withRefLock(`invoice:${invoiceId}`, () => syncInvoiceLedgerInner(invoiceId));
}

async function syncInvoiceLedgerInner(invoiceId: string): Promise<void> {
  await removeEntriesForRef(["invoice", "invoice_payment"], invoiceId);
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));
  if (!inv || inv.status === "draft" || inv.amount <= 0) return;
  await postInvoiceEntries(inv);
}

async function postInvoiceEntries(inv: Invoice): Promise<void> {
  const tax = Math.min(Math.max(inv.taxAmount ?? 0, 0), inv.amount);
  const net = round2(inv.amount - tax);
  await postJournal({
    entryDate: dateOnly(inv.sentAt ?? inv.issuedOn),
    memo: `Invoice ${inv.invoiceNo} issued`,
    refType: "invoice",
    refId: inv.id,
    source: "system",
    lines: [
      { accountCode: "1100", debit: inv.amount, description: inv.invoiceNo },
      { accountCode: "4000", credit: net, description: inv.invoiceNo },
      ...(tax > 0
        ? [{ accountCode: "2100", credit: tax, description: `${inv.invoiceNo} sales tax` }]
        : []),
    ],
  });
  if (inv.status === "paid") {
    await postJournal({
      entryDate: dateOnly(inv.paidAt ?? inv.sentAt),
      memo: `Invoice ${inv.invoiceNo} paid`,
      refType: "invoice_payment",
      refId: inv.id,
      source: "system",
      lines: [
        { accountCode: "1000", debit: inv.amount, description: inv.invoiceNo },
        { accountCode: "1100", credit: inv.amount, description: inv.invoiceNo },
      ],
    });
  }
}

/** Idempotently (re)post the ledger entry for an expense (or clean up after delete). */
export async function syncExpenseLedger(expenseId: string): Promise<void> {
  await withRefLock(`expense:${expenseId}`, () => syncExpenseLedgerInner(expenseId));
}

async function syncExpenseLedgerInner(expenseId: string): Promise<void> {
  await removeEntriesForRef(["expense", "expense_payment"], expenseId);
  const [exp] = await db
    .select()
    .from(expensesTable)
    .where(eq(expensesTable.id, expenseId));
  if (!exp || exp.amount <= 0) return;
  // Pending/rejected expenses never touch the books; entries were already
  // removed above, so simply skip posting.
  if (exp.approvalStatus !== "approved") return;
  await postExpenseEntry(exp);
}

async function postExpenseEntry(exp: Expense): Promise<void> {
  // Pending/rejected expenses stay off the books — guard here so the
  // rebuild path matches the per-expense sync behavior.
  if (exp.approvalStatus !== "approved") return;
  const label = [exp.vendor, exp.category].filter(Boolean).join(" — ") || "Expense";
  const isBill = exp.paymentStatus === "open";
  // Expense is recognized when incurred; credit AP for unpaid bills, Cash otherwise.
  await postJournal({
    entryDate: dateOnly(exp.spentOn),
    memo: isBill ? `Bill: ${label}` : `Expense: ${label}`,
    refType: "expense",
    refId: exp.id,
    source: "system",
    lines: [
      { accountCode: expenseAccountCode(exp.category), debit: exp.amount, description: label },
      { accountCode: isBill || exp.paidAt ? "2000" : "1000", credit: exp.amount, description: label },
    ],
  });
  // A bill that has been paid clears AP with cash.
  if (exp.paymentStatus === "paid" && exp.paidAt) {
    await postJournal({
      entryDate: dateOnly(exp.paidAt),
      memo: `Bill paid: ${label}`,
      refType: "expense_payment",
      refId: exp.id,
      source: "system",
      lines: [
        { accountCode: "2000", debit: exp.amount, description: label },
        { accountCode: "1000", credit: exp.amount, description: label },
      ],
    });
  }
}

/**
 * Idempotently (re)post crew labor cost for a job — posted once the job is
 * complete and has a crew rate.
 */
export async function syncJobLaborLedger(jobId: string): Promise<void> {
  await withRefLock(`job:${jobId}`, () => syncJobLaborLedgerInner(jobId));
}

async function syncJobLaborLedgerInner(jobId: string): Promise<void> {
  await removeEntriesForRef(["job_labor"], jobId);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return;
  // Emergency bonus is a crew cost like the base rate — post them together.
  const labor = (job.crewRate ?? 0) + (job.emergencyBonus ?? 0);
  if (labor <= 0) return;
  const done = ["complete", "closed", "paid"].includes(job.status);
  if (!done) return;
  await postJobLaborEntry(job.id, job.jobNo, labor, job.completedAt);
}

async function postJobLaborEntry(
  jobId: string,
  jobNo: string,
  crewRate: number,
  completedAt: Date | null,
): Promise<void> {
  await postJournal({
    entryDate: dateOnly(completedAt),
    memo: `Crew labor for ${jobNo}`,
    refType: "job_labor",
    refId: jobId,
    source: "system",
    lines: [
      { accountCode: "5000", debit: crewRate, description: jobNo },
      { accountCode: "1000", credit: crewRate, description: jobNo },
    ],
  });
}

/**
 * Rebuild the entire system-generated ledger from source documents.
 * Manual/voice entries are preserved. Returns the number of entries posted.
 */
export async function rebuildLedger(): Promise<number> {
  return withRefLock("rebuild", rebuildLedgerInner);
}

async function rebuildLedgerInner(): Promise<number> {
  const system = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.source, "system"));
  if (system.length > 0) {
    const ids = system.map((e) => e.id);
    await db.delete(journalLinesTable).where(inArray(journalLinesTable.entryId, ids));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, ids));
  }
  const [invoices, expenses, jobs] = await Promise.all([
    db.select().from(invoicesTable),
    db.select().from(expensesTable),
    db.select().from(jobsTable),
  ]);
  let posted = 0;
  for (const inv of invoices) {
    if (inv.status === "draft" || inv.amount <= 0) continue;
    await postInvoiceEntries(inv);
    posted += inv.status === "paid" ? 2 : 1;
  }
  for (const exp of expenses) {
    if (exp.amount <= 0) continue;
    await postExpenseEntry(exp);
    posted += 1;
  }
  for (const job of jobs) {
    const labor = (job.crewRate ?? 0) + (job.emergencyBonus ?? 0);
    if (labor <= 0) continue;
    if (!["complete", "closed", "paid"].includes(job.status)) continue;
    await postJobLaborEntry(job.id, job.jobNo, labor, job.completedAt);
    posted += 1;
  }
  return posted;
}
