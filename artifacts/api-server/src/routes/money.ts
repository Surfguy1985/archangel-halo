import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  invoicesTable,
  paymentsTable,
  expensesTable,
  jobsTable,
  propertiesTable,
} from "@workspace/db";
import {
  GetMoneySummaryResponse,
  ListInvoicesResponse,
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  CreateInvoiceResponse,
  SendInvoiceParams,
  SendInvoiceResponse,
  RemindInvoiceParams,
  RemindInvoiceResponse,
  RecordPaymentBody,
  RecordPaymentResponse,
  ListExpensesResponse,
  ListExpensesQueryParams,
  CreateExpenseBody,
  CreateExpenseResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { sendEmail } from "../lib/email";

const router: IRouter = Router();
const DAY = 1000 * 60 * 60 * 24;

function daysLate(inv: { dueAt: Date | null; paidAt: Date | null }): number {
  if (inv.paidAt || !inv.dueAt) return 0;
  const diff = Math.floor((Date.now() - inv.dueAt.getTime()) / DAY);
  return diff > 0 ? diff : 0;
}

async function propertyNames(): Promise<Map<string, string>> {
  const rows = await db.select().from(propertiesTable);
  return new Map(rows.map((r) => [r.id, r.name]));
}

function decorateInvoice(
  inv: typeof invoicesTable.$inferSelect,
  names: Map<string, string>,
) {
  const late = daysLate(inv);
  return {
    ...ser(inv),
    propertyName: names.get(inv.propertyId) ?? null,
    status: late > 0 && inv.status === "sent" ? "past_due" : inv.status,
    daysLate: late,
  };
}

async function nextInvoiceNo(): Promise<string> {
  const rows = await db.select().from(invoicesTable);
  return `INV-${String(5000 + rows.length + 1)}`;
}

router.get("/money/summary", async (_req, res): Promise<void> => {
  const invoices = await db.select().from(invoicesTable);
  const now = new Date();

  const outstanding = invoices.filter(
    (i) => i.status !== "paid" && i.status !== "draft",
  );
  const landing = outstanding.reduce((s, i) => s + i.amount, 0);
  const atRisk = outstanding
    .filter((i) => daysLate(i) > 0)
    .reduce((s, i) => s + i.amount, 0);
  const collectedMtd = invoices
    .filter(
      (i) =>
        i.paidAt &&
        i.paidAt.getMonth() === now.getMonth() &&
        i.paidAt.getFullYear() === now.getFullYear(),
    )
    .reduce((s, i) => s + i.amount, 0);

  const jobs = await db.select().from(jobsTable);
  const mtdJobs = jobs.filter(
    (j) =>
      j.completedAt &&
      j.completedAt.getMonth() === now.getMonth() &&
      j.completedAt.getFullYear() === now.getFullYear(),
  );
  const mtd = mtdJobs.reduce((s, j) => s + (j.grossProfit ?? 0), 0);
  const withMargin = jobs.filter((j) => j.marginPct != null);
  const marginPct =
    withMargin.length > 0
      ? Math.round(
          (withMargin.reduce((s, j) => s + (j.marginPct ?? 0), 0) /
            withMargin.length) *
            1000,
        ) / 10
      : 0;

  const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const i of outstanding) {
    const late = daysLate(i);
    if (late <= 0) buckets.current += i.amount;
    else if (late <= 30) buckets.d30 += i.amount;
    else if (late <= 60) buckets.d60 += i.amount;
    else buckets.d90 += i.amount;
  }

  res.json(
    GetMoneySummaryResponse.parse({
      landing,
      atRisk,
      mtd,
      marginPct,
      collectedMtd,
      aging: [
        { label: "Current", value: buckets.current, color: "ink" },
        { label: "1–30", value: buckets.d30, color: "gold" },
        { label: "31–60", value: buckets.d60, color: "warn" },
        { label: "60+", value: buckets.d90, color: "danger" },
      ],
    }),
  );
});

router.get("/invoices", async (req, res): Promise<void> => {
  const { status } = ListInvoicesQueryParams.parse(req.query);
  const rows = await db
    .select()
    .from(invoicesTable)
    .orderBy(desc(invoicesTable.createdAt));
  const names = await propertyNames();
  let items = rows.map((r) => decorateInvoice(r, names));
  if (status) items = items.filter((i) => i.status === status);
  res.json(ListInvoicesResponse.parse(items));
});

router.post("/invoices", async (req, res): Promise<void> => {
  const body = CreateInvoiceBody.parse(req.body);
  const dueAt = new Date(Date.now() + (body.dueInDays ?? 30) * DAY);
  const [row] = await db
    .insert(invoicesTable)
    .values({
      invoiceNo: await nextInvoiceNo(),
      propertyId: body.propertyId,
      jobId: body.jobId,
      amount: body.amount,
      dueAt,
      status: "draft",
    })
    .returning();
  const names = await propertyNames();
  res.status(201).json(CreateInvoiceResponse.parse(decorateInvoice(row, names)));
});

router.post("/invoices/:id/send", async (req, res): Promise<void> => {
  const { id } = SendInvoiceParams.parse(req.params);
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const names = await propertyNames();
  await sendEmail({
    to: "billing@example.com",
    subject: `Invoice ${inv.invoiceNo} — $${inv.amount.toLocaleString()}`,
    html: `<p>Please find invoice <strong>${inv.invoiceNo}</strong> for $${inv.amount.toLocaleString()} from ArchAngel Contractors. Payment terms net-30.</p>`,
  });
  const [row] = await db
    .update(invoicesTable)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(invoicesTable.id, id))
    .returning();
  res.json(SendInvoiceResponse.parse(decorateInvoice(row, names)));
});

router.post("/invoices/:id/remind", async (req, res): Promise<void> => {
  const { id } = RemindInvoiceParams.parse(req.params);
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const names = await propertyNames();
  await sendEmail({
    to: "billing@example.com",
    subject: `Reminder: Invoice ${inv.invoiceNo} is ${daysLate(inv)} days past due`,
    html: `<p>A friendly reminder that invoice <strong>${inv.invoiceNo}</strong> for $${inv.amount.toLocaleString()} is now past due. We'd appreciate prompt payment.</p>`,
  });
  res.json(RemindInvoiceResponse.parse(decorateInvoice(inv, names)));
});

router.post("/payments", async (req, res): Promise<void> => {
  const body = RecordPaymentBody.parse(req.body);
  const [row] = await db.insert(paymentsTable).values(body).returning();
  await db
    .update(invoicesTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(invoicesTable.id, body.invoiceId));
  res.status(201).json(RecordPaymentResponse.parse(ser(row)));
});

router.get("/expenses", async (req, res): Promise<void> => {
  const { propertyId, jobId } = ListExpensesQueryParams.parse(req.query);
  let rows = await db
    .select()
    .from(expensesTable)
    .orderBy(desc(expensesTable.spentOn));
  if (propertyId) rows = rows.filter((r) => r.propertyId === propertyId);
  if (jobId) rows = rows.filter((r) => r.jobId === jobId);
  res.json(ListExpensesResponse.parse(rows.map((r) => ser(r))));
});

router.post("/expenses", async (req, res): Promise<void> => {
  const body = CreateExpenseBody.parse(req.body);
  const [row] = await db.insert(expensesTable).values(body).returning();
  res.status(201).json(CreateExpenseResponse.parse(ser(row)));
});

export default router;
