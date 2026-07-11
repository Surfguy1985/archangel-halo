import { Router, type IRouter } from "express";
import { asc, desc, eq } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLineItemsTable,
  paymentsTable,
  expensesTable,
  jobsTable,
  propertiesTable,
  contactsTable,
} from "@workspace/db";
import {
  GetMoneySummaryResponse,
  ListInvoicesResponse,
  ListInvoicesQueryParams,
  CreateInvoiceBody,
  CreateInvoiceResponse,
  GetInvoiceParams,
  GetInvoiceResponse,
  UpdateInvoiceParams,
  UpdateInvoiceBody,
  UpdateInvoiceResponse,
  DeleteInvoiceParams,
  SendInvoiceParams,
  SendInvoiceBody,
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
import { generateInvoicePdf, type InvoicePdfCompany } from "../lib/invoicePdf";
import { getBusinessSettings } from "../lib/businessSettings";
import { getBankMtdCashflow } from "../lib/plaidClient";

type Settings = Awaited<ReturnType<typeof getBusinessSettings>>;

function pdfCompany(settings: Settings): InvoicePdfCompany {
  return {
    name: settings.companyName,
    tagline: settings.tagline,
    street: settings.street,
    city: settings.city,
    attn: settings.attn,
    phone: settings.phone || null,
    email: settings.email,
  };
}

function invoicePdfData(
  inv: typeof invoicesTable.$inferSelect,
  items: (typeof invoiceLineItemsTable.$inferSelect)[],
  settings: Settings,
) {
  return {
    invoiceNo: inv.invoiceNo,
    company: pdfCompany(settings),
    paymentInstructions:
      inv.paymentInstructions?.trim() || settings.paymentInstructions || null,
    poNumber: inv.poNumber,
    terms: inv.terms,
    issuedOn: inv.issuedOn,
    dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
    billToName: inv.billToName,
    propertyAddress: inv.propertyAddress,
    notes: inv.notes,
    amount: inv.amount,
    lineItems: items,
  };
}

const router: IRouter = Router();
const DAY = 1000 * 60 * 60 * 24;

type LineItemInput = {
  dateOfWork?: string;
  unitNo?: string;
  typeOfWork: string;
  description?: string;
  qty?: number;
  unitPrice?: number;
};

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

async function lineItemsFor(invoiceId: string) {
  return db
    .select()
    .from(invoiceLineItemsTable)
    .where(eq(invoiceLineItemsTable.invoiceId, invoiceId))
    .orderBy(asc(invoiceLineItemsTable.sortOrder));
}

async function invoiceDetail(
  inv: typeof invoicesTable.$inferSelect,
  names: Map<string, string>,
) {
  const items = await lineItemsFor(inv.id);
  return {
    ...decorateInvoice(inv, names),
    recipientEmail: await recipientEmail(inv.propertyId),
    lineItems: items.map((it) => ser(it)),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normalize a line-item input into stored row values (amount = qty*price). */
function normalizeItems(items: LineItemInput[] | undefined) {
  return (items ?? []).map((it, idx) => {
    const qty = it.qty ?? 1;
    const unitPrice = it.unitPrice ?? 0;
    return {
      dateOfWork: it.dateOfWork || null,
      unitNo: it.unitNo || null,
      typeOfWork: it.typeOfWork,
      description: it.description || null,
      qty,
      unitPrice,
      amount: Math.round(qty * unitPrice * 100) / 100,
      sortOrder: idx,
    };
  });
}

function computeDueAt(input: {
  dueOn?: string;
  dueInDays?: number;
}): Date {
  if (input.dueOn) return new Date(`${input.dueOn}T12:00:00Z`);
  return new Date(Date.now() + (input.dueInDays ?? 30) * DAY);
}

async function defaultBillTo(propertyId: string): Promise<{
  billToName: string | null;
  propertyAddress: string | null;
}> {
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (!prop) return { billToName: null, propertyAddress: null };
  return {
    billToName: prop.pmcName ?? prop.name,
    propertyAddress: [prop.name, prop.city].filter(Boolean).join(", ") || null,
  };
}

async function recipientEmail(propertyId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.propertyId, propertyId));
  const withEmail = rows.find((r) => r.email);
  return withEmail?.email ?? null;
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

  // Prefer real bank data (Plaid) for cash figures when a bank is connected.
  const bank = await getBankMtdCashflow();

  let mtd: number;
  let marginPct: number;
  let spentMtd: number | null = null;
  let bankCollectedMtd: number | null = null;

  if (bank) {
    mtd = bank.inflows;
    bankCollectedMtd = bank.inflows;
    spentMtd = bank.outflows;
    marginPct =
      bank.inflows > 0
        ? Math.round(((bank.inflows - bank.outflows) / bank.inflows) * 1000) /
          10
        : 0;
  } else {
    const jobs = await db.select().from(jobsTable);
    const mtdJobs = jobs.filter(
      (j) =>
        j.completedAt &&
        j.completedAt.getMonth() === now.getMonth() &&
        j.completedAt.getFullYear() === now.getFullYear(),
    );
    mtd = mtdJobs.reduce((s, j) => s + (j.grossProfit ?? 0), 0);
    const withMargin = jobs.filter((j) => j.marginPct != null);
    marginPct =
      withMargin.length > 0
        ? Math.round(
            (withMargin.reduce((s, j) => s + (j.marginPct ?? 0), 0) /
              withMargin.length) *
              1000,
          ) / 10
        : 0;
  }

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
      collectedMtd: bankCollectedMtd ?? collectedMtd,
      spentMtd,
      bankConnected: !!bank,
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
  const dueAt = computeDueAt(body);
  const items = normalizeItems(body.lineItems);
  const total =
    items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
      : (body.amount ?? 0);
  const defaults = await defaultBillTo(body.propertyId);
  const issuedOn = body.issuedOn ?? new Date().toISOString().slice(0, 10);

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(invoicesTable)
      .values({
        invoiceNo: await nextInvoiceNo(),
        propertyId: body.propertyId,
        jobId: body.jobId,
        amount: total,
        dueAt,
        issuedOn,
        poNumber: body.poNumber ?? null,
        terms: body.terms ?? "Net 30",
        billToName: body.billToName ?? defaults.billToName,
        propertyAddress: body.propertyAddress ?? defaults.propertyAddress,
        notes: body.notes ?? null,
        paymentInstructions: body.paymentInstructions ?? null,
        status: "draft",
      })
      .returning();
    if (items.length > 0) {
      await tx
        .insert(invoiceLineItemsTable)
        .values(items.map((it) => ({ ...it, invoiceId: created.id })));
    }
    return created;
  });

  const names = await propertyNames();
  res.status(201).json(CreateInvoiceResponse.parse(decorateInvoice(row, names)));
});

router.get("/invoices/:id", async (req, res): Promise<void> => {
  const { id } = GetInvoiceParams.parse(req.params);
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const names = await propertyNames();
  res.json(GetInvoiceResponse.parse(await invoiceDetail(inv, names)));
});

router.patch("/invoices/:id", async (req, res): Promise<void> => {
  const { id } = UpdateInvoiceParams.parse(req.params);
  const body = UpdateInvoiceBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const items = normalizeItems(body.lineItems);
  const total =
    items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
      : (body.amount ?? existing.amount);
  const dueAt =
    body.dueOn || body.dueInDays != null ? computeDueAt(body) : existing.dueAt;

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(invoicesTable)
      .set({
        propertyId: body.propertyId,
        jobId: body.jobId ?? null,
        amount: total,
        dueAt,
        issuedOn: body.issuedOn ?? existing.issuedOn,
        poNumber: body.poNumber ?? null,
        terms: body.terms ?? existing.terms,
        billToName: body.billToName ?? existing.billToName,
        propertyAddress: body.propertyAddress ?? existing.propertyAddress,
        notes: body.notes ?? null,
        paymentInstructions: body.paymentInstructions ?? null,
      })
      .where(eq(invoicesTable.id, id))
      .returning();
    await tx
      .delete(invoiceLineItemsTable)
      .where(eq(invoiceLineItemsTable.invoiceId, id));
    if (items.length > 0) {
      await tx
        .insert(invoiceLineItemsTable)
        .values(items.map((it) => ({ ...it, invoiceId: id })));
    }
    return updated;
  });

  const names = await propertyNames();
  res.json(UpdateInvoiceResponse.parse(await invoiceDetail(row, names)));
});

router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const { id } = DeleteInvoiceParams.parse(req.params);
  await db.transaction(async (tx) => {
    await tx
      .delete(invoiceLineItemsTable)
      .where(eq(invoiceLineItemsTable.invoiceId, id));
    await tx.delete(paymentsTable).where(eq(paymentsTable.invoiceId, id));
    await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
  });
  res.status(204).end();
});

router.get("/invoices/:id/pdf", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const items = await lineItemsFor(inv.id);
  const settings = await getBusinessSettings();
  const bytes = await generateInvoicePdf(invoicePdfData(inv, items, settings));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${inv.invoiceNo}.pdf"`,
  );
  res.end(Buffer.from(bytes));
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function invoiceEmailHtml(
  inv: typeof invoicesTable.$inferSelect,
  items: (typeof invoiceLineItemsTable.$inferSelect)[],
  settings: Settings,
  message?: string,
): Promise<string> {
  const money = (n: number) =>
    `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const rows = items
    .map(
      (it) =>
        `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${it.unitNo ? `${escapeHtml(it.unitNo)} · ` : ""}${escapeHtml(it.typeOfWork)}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${money(it.amount)}</td></tr>`,
    )
    .join("");
  return `
  <div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17181c">
    <div style="height:6px;background:#B98A2F"></div>
    <div style="padding:24px 8px">
      <div style="font-size:20px;font-weight:700">${escapeHtml(settings.companyName)}</div>
      <div style="font-size:12px;color:#8f6a1f;letter-spacing:2px;text-transform:uppercase">Invoice ${inv.invoiceNo}</div>
      <p style="font-size:14px;line-height:1.5;color:#42424a;white-space:pre-line">${
        message?.trim()
          ? escapeHtml(message.trim())
          : `${inv.billToName ? `Hello ${escapeHtml(inv.billToName)},\n` : ""}Please find attached invoice ${inv.invoiceNo}${inv.propertyAddress ? ` for work at ${escapeHtml(inv.propertyAddress)}` : ""}.`
      }</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">
        ${rows}
        <tr><td style="padding:10px 8px;font-weight:700">Total Due</td><td style="padding:10px 8px;text-align:right;font-weight:700;color:#8f6a1f">${money(inv.amount)}</td></tr>
      </table>
      <p style="font-size:13px;color:#42424a">Terms: <strong>${inv.terms ?? "Net 30"}</strong>${inv.dueAt ? ` · Due ${inv.dueAt.toLocaleDateString("en-US")}` : ""}.</p>
      <p style="font-size:13px;color:#42424a;white-space:pre-line">${escapeHtml(inv.paymentInstructions?.trim() || settings.paymentInstructions || "Payment by check or ACH/bank transfer to the remittance information on file.")}</p>
      <p style="font-size:11px;color:#9a9a9c;border-top:1px solid #eee;padding-top:10px">${escapeHtml(settings.companyName)} · ${escapeHtml(settings.attn)} · ${escapeHtml(settings.email)}</p>
    </div>
  </div>`;
}

router.post("/invoices/:id/send", async (req, res): Promise<void> => {
  const { id } = SendInvoiceParams.parse(req.params);
  const body = SendInvoiceBody.parse(req.body ?? {});
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const override = body.recipientEmail?.trim();
  if (override && !EMAIL_RE.test(override)) {
    res.status(422).json({ error: "That doesn't look like a valid email address" });
    return;
  }
  const to = override || (await recipientEmail(inv.propertyId));
  if (!to) {
    res.status(422).json({ error: "No billing contact email on file for this property" });
    return;
  }
  const items = await lineItemsFor(inv.id);
  const settings = await getBusinessSettings();
  const pdf = await generateInvoicePdf(invoicePdfData(inv, items, settings));
  const sent = await sendEmail({
    to,
    subject:
      body.subject?.trim() ||
      `Invoice ${inv.invoiceNo} — ${inv.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    html: await invoiceEmailHtml(inv, items, settings, body.message),
    attachments: [
      {
        filename: `${inv.invoiceNo}.pdf`,
        content: Buffer.from(pdf).toString("base64"),
      },
    ],
  });
  if (!sent.ok) {
    res.status(502).json({ error: sent.error ?? "Failed to send invoice email" });
    return;
  }
  const names = await propertyNames();
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
  const to = await recipientEmail(inv.propertyId);
  if (!to) {
    res.status(422).json({ error: "No billing contact email on file for this property" });
    return;
  }
  const items = await lineItemsFor(inv.id);
  const settings = await getBusinessSettings();
  const pdf = await generateInvoicePdf(invoicePdfData(inv, items, settings));
  const names = await propertyNames();
  const sent = await sendEmail({
    to,
    subject: `Reminder: Invoice ${inv.invoiceNo} is ${daysLate(inv)} days past due`,
    html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#17181c"><div style="height:6px;background:#B98A2F"></div><div style="padding:24px 8px"><p style="font-size:14px;line-height:1.5">A friendly reminder that invoice <strong>${inv.invoiceNo}</strong> for ${inv.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })} is now <strong>${daysLate(inv)} days past due</strong>. The invoice is attached again for your convenience — we'd appreciate prompt payment.</p><p style="font-size:11px;color:#9a9a9c;border-top:1px solid #eee;padding-top:10px">${escapeHtml(settings.companyName)} · ${escapeHtml(settings.attn)} · ${escapeHtml(settings.email)}</p></div></div>`,
    attachments: [
      {
        filename: `${inv.invoiceNo}.pdf`,
        content: Buffer.from(pdf).toString("base64"),
      },
    ],
  });
  if (!sent.ok) {
    res.status(502).json({ error: sent.error ?? "Failed to send reminder email" });
    return;
  }
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
