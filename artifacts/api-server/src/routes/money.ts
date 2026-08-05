import { Router, type IRouter } from "express";
import { asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLineItemsTable,
  paymentsTable,
  expensesTable,
  jobsTable,
  propertiesTable,
  contactsTable,
  activitiesTable,
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
  ScanCheckBody,
  ScanCheckResponse,
  SetInvoiceStatusParams,
  SetInvoiceStatusBody,
  SetInvoiceStatusResponse,
  ListExpensesResponse,
  ListExpensesQueryParams,
  CreateExpenseBody,
  PayExpenseBillParams,
  PayExpenseBillResponse,
  CreateExpenseResponse,
  ApproveExpenseParams,
  ApproveExpenseResponse,
  RejectExpenseParams,
  RejectExpenseResponse,
  GetBusinessReportResponse,
  GenerateReportInsightsResponse,
} from "@workspace/api-zod";
import { computeBusinessReport } from "../lib/businessReport";
import { recomputeJobFinancials } from "../lib/jobFinance";
import { syncInvoiceLedger, syncExpenseLedger, removeEntriesForRef } from "../lib/ledger";
import { generateBusinessReportPdf } from "../lib/reportPdf";
import { completeJson, completeJsonWithImage } from "../lib/ai";
import { ser } from "../lib/serialize";
import { sendEmail } from "../lib/email";
import { generateInvoicePdf, type InvoicePdfCompany } from "../lib/invoicePdf";
import { applySopToInvoice, getSopRule } from "./sop";
import { getBusinessSettings } from "../lib/businessSettings";
import { getBankMtdCashflow } from "../lib/plaidClient";
import { raiseClientCard, completeClientCard } from "../lib/clientBoard";
import { buildInvoiceModule } from "../lib/cardModules";

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

/**
 * Explicit taxAmount wins; otherwise apply the business tax rate (tax-inclusive
 * total: tax = total * r / (1 + r)) when one is configured.
 */
export async function resolveTaxAmount(
  explicit: number | undefined,
  total: number,
): Promise<number> {
  if (explicit != null)
    return Math.min(Math.max(Math.round(explicit * 100) / 100, 0), total);
  const settings = await getBusinessSettings();
  const r = (settings.taxRatePct ?? 0) / 100;
  if (r <= 0) return 0;
  return Math.round(((total * r) / (1 + r)) * 100) / 100;
}
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

router.get("/money/report", async (_req, res): Promise<void> => {
  const report = await computeBusinessReport();
  res.json(GetBusinessReportResponse.parse(report));
});

type Insights = {
  summary: string;
  suggestions: { propertyName?: string | null; title: string; detail: string }[];
};

async function reportInsights(): Promise<Insights> {
  const report = await computeBusinessReport();
  const raw = await completeJson<Insights>(
    [
      "You are a sharp business advisor for ArchAngel Contractors, a make-ready / restoration contractor serving apartment properties.",
      "You get their business report as JSON. All marginPct values are fractions (0.25 = 25%). Healthy margin target is 25%+.",
      "Return JSON: { \"summary\": string, \"suggestions\": [{ \"propertyName\": string|null, \"title\": string, \"detail\": string }] }.",
      "summary: 2-3 plain-language sentences on overall business health for a non-technical owner.",
      "suggestions: 3-6 concrete, specific actions to improve margins or scale — reference actual properties and numbers from the data (weak jobs, high supply spend categories, unpaid invoices, properties with thin margins, concentration risk if one property dominates revenue). propertyName is the property a suggestion is about, or null for business-wide advice.",
      "Be direct and practical. No fluff, no generic advice that ignores the numbers.",
    ].join("\n"),
    JSON.stringify(report),
    2048,
  );
  return {
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    suggestions: Array.isArray(raw?.suggestions)
      ? raw.suggestions
          .filter((s) => s && typeof s.title === "string" && typeof s.detail === "string")
          .map((s) => ({
            propertyName:
              typeof s.propertyName === "string" ? s.propertyName : null,
            title: s.title,
            detail: s.detail,
          }))
      : [],
  };
}

router.post("/money/report/insights", async (_req, res): Promise<void> => {
  try {
    const insights = await reportInsights();
    res.json(GenerateReportInsightsResponse.parse(insights));
  } catch (err) {
    console.error("report insights failed:", err);
    res.status(502).json({
      error: "Couldn't generate suggestions right now. Try again in a moment.",
    });
  }
});

router.get("/money/report/pdf", async (_req, res): Promise<void> => {
  const report = await computeBusinessReport();
  let insights: Insights | null = null;
  try {
    insights = await reportInsights();
  } catch {
    // PDF still ships without the AI section if the model call fails.
  }
  const pdf = await generateBusinessReportPdf(report, insights);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="archangel-business-report-${new Date().toISOString().slice(0, 10)}.pdf"`,
  );
  res.send(Buffer.from(pdf));
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

/**
 * Every invoice must belong to a job card — no free-floating invoices.
 * Returns an error string when the link is missing or invalid, else null.
 */
async function validateInvoiceJobLink(
  jobId: string | null | undefined,
  propertyId: string,
): Promise<string | null> {
  if (!jobId) return "Pick the job this invoice belongs to — every invoice must be tied to a job card.";
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return "That job no longer exists — pick the job this invoice belongs to.";
  if (job.propertyId !== propertyId)
    return "That job belongs to a different property — pick a job at this property.";
  return null;
}

router.post("/invoices", async (req, res): Promise<void> => {
  const body = CreateInvoiceBody.parse(req.body);
  const jobLinkError = await validateInvoiceJobLink(body.jobId, body.propertyId);
  if (jobLinkError) {
    res.status(400).json({ error: jobLinkError });
    return;
  }
  const items = normalizeItems(body.lineItems);
  const total =
    items.length > 0
      ? Math.round(items.reduce((s, i) => s + i.amount, 0) * 100) / 100
      : (body.amount ?? 0);
  const defaults = await defaultBillTo(body.propertyId);
  const issuedOn = body.issuedOn ?? new Date().toISOString().slice(0, 10);

  // SOP rule enforcement — when the property has a rule, every invoice
  // must follow it: PO requirement, number format, terms, due date, etc.
  const sop = await applySopToInvoice(body.propertyId, {
    issuedOn,
    poNumber: body.poNumber,
    terms: body.terms,
    dueProvided: !!body.dueOn || body.dueInDays != null,
    billToName: body.billToName,
    propertyAddress: body.propertyAddress,
    paymentInstructions: body.paymentInstructions,
    notes: body.notes,
    taxAmount: body.taxAmount,
    total,
  });
  if (sop && !sop.ok) {
    res.status(400).json({ error: sop.error });
    return;
  }
  const applied = sop && sop.ok ? sop : null;
  const dueAt = applied?.dueAt ?? computeDueAt(body);

  const row = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(invoicesTable)
      .values({
        invoiceNo: applied?.invoiceNo ?? (await nextInvoiceNo()),
        propertyId: body.propertyId,
        jobId: body.jobId,
        amount: total,
        dueAt,
        issuedOn,
        poNumber: body.poNumber ?? null,
        terms: body.terms ?? applied?.terms ?? "Net 30",
        billToName:
          body.billToName ?? applied?.billToName ?? defaults.billToName,
        propertyAddress:
          body.propertyAddress ??
          applied?.propertyAddress ??
          defaults.propertyAddress,
        notes: body.notes ?? applied?.notes ?? null,
        paymentInstructions:
          body.paymentInstructions ?? applied?.paymentInstructions ?? null,
        taxAmount:
          applied?.taxAmount ?? (await resolveTaxAmount(body.taxAmount, total)),
        attachmentPath: body.attachmentPath ?? null,
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

  if (row.jobId) await recomputeJobFinancials(row.jobId);
  await syncInvoiceLedger(row.id);
  // Invoice tied to a job card → surface it on the client's board right away
  // (flashing green = job complete, invoice ready to review and pay).
  if (row.jobId) {
    const invTotal = row.amount + (row.taxAmount ?? 0);
    await raiseClientCard({
      propertyId: row.propertyId,
      kind: "invoice",
      title: `Invoice ${row.invoiceNo} — ${invTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
      body: row.notes || `Job complete — Invoice ${row.invoiceNo} is ready to review.`,
      actionLabel: "Review & pay",
      amount: invTotal,
      dueDate: row.dueAt
        ? `${row.dueAt.getFullYear()}-${String(row.dueAt.getMonth() + 1).padStart(2, "0")}-${String(row.dueAt.getDate()).padStart(2, "0")}`
        : null,
      links: [{ label: `Invoice ${row.invoiceNo} (PDF)`, url: `/api/invoices/${row.id}/pdf`, kind: "pdf" }],
      sourceType: "invoice",
      sourceId: row.id,
      jobId: row.jobId,
      module: await buildInvoiceModule(row.propertyId, row.id),
    });
  }
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
  const taxAmount = await resolveTaxAmount(body.taxAmount, total);

  // Every invoice stays tied to a job card — an edit can move the link to
  // another job at the property, but never clear it.
  const nextJobId = body.jobId ?? existing.jobId;
  const jobLinkError = await validateInvoiceJobLink(nextJobId, body.propertyId);
  if (jobLinkError) {
    res.status(400).json({ error: jobLinkError });
    return;
  }

  // SOP rule enforcement — an edit cannot strip a PO the SOP requires.
  const editRule = await getSopRule(body.propertyId);
  if (editRule?.format?.po_required && !body.poNumber) {
    res.status(400).json({
      error:
        "This property's SOP requires a PO number on every invoice. Add the PO number and try again.",
    });
    return;
  }

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(invoicesTable)
      .set({
        propertyId: body.propertyId,
        jobId: nextJobId,
        amount: total,
        dueAt,
        issuedOn: body.issuedOn ?? existing.issuedOn,
        poNumber: body.poNumber ?? null,
        terms: body.terms ?? existing.terms,
        billToName: body.billToName ?? existing.billToName,
        propertyAddress: body.propertyAddress ?? existing.propertyAddress,
        notes: body.notes ?? null,
        paymentInstructions: body.paymentInstructions ?? null,
        taxAmount,
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

  await recomputeJobFinancials(
    [existing.jobId, row.jobId].filter((x): x is string => !!x),
  );
  await syncInvoiceLedger(row.id);
  const names = await propertyNames();
  res.json(UpdateInvoiceResponse.parse(await invoiceDetail(row, names)));
});

router.delete("/invoices/:id", async (req, res): Promise<void> => {
  const { id } = DeleteInvoiceParams.parse(req.params);
  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id));
  await db.transaction(async (tx) => {
    await tx
      .delete(invoiceLineItemsTable)
      .where(eq(invoiceLineItemsTable.invoiceId, id));
    await tx.delete(paymentsTable).where(eq(paymentsTable.invoiceId, id));
    await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
  });
  if (existing?.jobId) await recomputeJobFinancials(existing.jobId);
  await removeEntriesForRef(["invoice", "invoice_payment"], id);
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

// SOP-compliant CSV export. Mirrors the PDF's data but formatted per the
// property's SOP billing rule (date format, remit-to, client company), so the
// file can be dropped straight into the client's AP import.
router.get("/invoices/:id/csv", async (req, res): Promise<void> => {
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
  const rule = await getSopRule(inv.propertyId);
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, inv.propertyId));
  const [job] = inv.jobId
    ? await db.select().from(jobsTable).where(eq(jobsTable.id, inv.jobId))
    : [undefined];
  const invPayments = await db
    .select()
    .from(paymentsTable)
    .where(eq(paymentsTable.invoiceId, inv.id));
  const amountPaid =
    Math.round(invPayments.reduce((s, p) => s + p.amount, 0) * 100) / 100;

  // Format a YYYY-MM-DD / Date value per the SOP's date_format (default ISO).
  const fmt = (rule?.format?.date_format ?? "").toUpperCase();
  const fmtDate = (v: string | Date | null): string => {
    if (!v) return "";
    // Date values use LOCAL calendar parts — never toISOString, or the day
    // can shift across the UTC boundary (see local date handling rule).
    const iso =
      v instanceof Date
        ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`
        : String(v).slice(0, 10);
    const [y, m, d] = iso.split("-");
    if (!y || !m || !d) return iso;
    if (fmt.startsWith("MM/DD")) return `${m}/${d}/${y}`;
    if (fmt.startsWith("DD/MM")) return `${d}/${m}/${y}`;
    if (fmt.startsWith("MM-DD")) return `${m}-${d}-${y}`;
    if (fmt.startsWith("DD-MM")) return `${d}-${m}-${y}`;
    return iso;
  };
  const esc = (v: unknown): string => {
    let s = v == null ? "" : String(v);
    // Neutralize spreadsheet formula injection (=, +, -, @, tab/CR prefixes).
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const money = (n: number) => n.toFixed(2);

  const subtotal = items.reduce((s, li) => s + li.amount, 0);
  const currency = rule?.format?.currency || "USD";
  const lines: string[] = [];
  const kv = (k: string, v: unknown) => lines.push(`${esc(k)},${esc(v)}`);
  kv("Invoice Number", inv.invoiceNo);
  kv("Invoice Date", fmtDate(inv.issuedOn));
  kv("Due Date", fmtDate(inv.dueAt));
  kv("Terms", inv.terms || rule?.format?.payment_terms || "");
  kv("PO Number", inv.poNumber ?? "");
  kv("Job Number", job?.jobNo ?? "");
  kv("Job", job ? [job.category, job.description].filter(Boolean).join(" — ") : "");
  if (job?.unitNo) kv("Job Unit", job.unitNo);
  kv("Bill To", inv.billToName || rule?.property?.client_company || "");
  kv("Property", prop?.name ?? "");
  kv(
    "Property Address",
    inv.propertyAddress || rule?.property?.billing_address || "",
  );
  kv("Vendor", settings.companyName ?? "");
  kv(
    "Remit To",
    rule?.format?.remit_to ||
      inv.paymentInstructions ||
      settings.paymentInstructions ||
      "",
  );
  kv("Currency", currency);
  kv("Status", inv.status);
  lines.push("");
  lines.push(
    "Date of Work,Unit,Type of Work,Description,Qty,Rate,Cost",
  );
  for (const li of items) {
    lines.push(
      [
        fmtDate(li.dateOfWork),
        esc(li.unitNo),
        esc(li.typeOfWork),
        esc(li.description),
        String(li.qty),
        money(li.unitPrice),
        money(li.amount),
      ].join(","),
    );
  }
  lines.push("");
  lines.push(`Subtotal,,,,,,${money(subtotal - inv.taxAmount)}`);
  if (inv.taxAmount > 0) lines.push(`Tax,,,,,,${money(inv.taxAmount)}`);
  lines.push(`Total,,,,,,${money(inv.amount)}`);
  lines.push(`Amount Paid,,,,,,${money(amountPaid)}`);
  lines.push(
    `Balance Due,,,,,,${money(Math.max(0, Math.round((inv.amount - amountPaid) * 100) / 100))}`,
  );
  if (inv.notes?.trim()) {
    lines.push("");
    kv("Notes", inv.notes.trim());
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${inv.invoiceNo}.csv"`,
  );
  res.end(lines.join("\r\n") + "\r\n");
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
  if (row.jobId) await recomputeJobFinancials(row.jobId);
  await syncInvoiceLedger(row.id);
  // Mirror the send onto the client's board — card lands prepopulated with
  // the invoice PDF and everything they need to pay it.
  const invTotal = row.amount + (row.taxAmount ?? 0);
  await raiseClientCard({
    propertyId: row.propertyId,
    kind: "invoice",
    title: `Invoice ${row.invoiceNo} — ${invTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    body: row.notes || `Invoice ${row.invoiceNo} from Archangel Contractors.`,
    actionLabel: "Review & pay",
    amount: invTotal,
    dueDate: row.dueAt
      ? `${row.dueAt.getFullYear()}-${String(row.dueAt.getMonth() + 1).padStart(2, "0")}-${String(row.dueAt.getDate()).padStart(2, "0")}`
      : null,
    links: [{ label: `Invoice ${row.invoiceNo} (PDF)`, url: `/api/invoices/${row.id}/pdf`, kind: "pdf" }],
    sourceType: "invoice",
    sourceId: row.id,
    jobId: row.jobId ?? null,
    module: await buildInvoiceModule(row.propertyId, row.id),
  });
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

router.post("/invoices/:id/status", async (req, res): Promise<void> => {
  const { id } = SetInvoiceStatusParams.parse(req.params);
  const body = SetInvoiceStatusBody.parse(req.body);
  const [row] = await db
    .update(invoicesTable)
    .set(
      body.status === "paid"
        ? { status: "paid", paidAt: new Date() }
        : { status: "sent", paidAt: null },
    )
    .where(eq(invoicesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (row.jobId) await recomputeJobFinancials(row.jobId);
  await syncInvoiceLedger(row.id);
  // Board mirror: manual paid flips complete the card too.
  if (body.status === "paid") {
    await completeClientCard("invoice", row.id, "Paid — thank you");
  }
  const names = await propertyNames();
  res.json(SetInvoiceStatusResponse.parse(decorateInvoice(row, names)));
});

// Virtual check filing cabinet: every check payment (scanned or manually
// recorded) with its invoice, property and job context so the office can
// search files by property, job, date, amount, payer or check number.
router.get("/checks", async (_req, res): Promise<void> => {
  const payments = await db
    .select()
    .from(paymentsTable)
    .orderBy(desc(paymentsTable.receivedAt));
  const checks = payments.filter((p) => p.method === "check" || p.checkImagePath);
  const invoiceIds = [...new Set(checks.map((p) => p.invoiceId).filter((v): v is string => !!v))];
  const invoices = invoiceIds.length
    ? await db.select().from(invoicesTable).where(inArray(invoicesTable.id, invoiceIds))
    : [];
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const propIds = [...new Set(invoices.map((i) => i.propertyId))];
  const jobIds = [...new Set(invoices.map((i) => i.jobId).filter((v): v is string => !!v))];
  const [props, jobs] = await Promise.all([
    propIds.length ? db.select().from(propertiesTable).where(inArray(propertiesTable.id, propIds)) : [],
    jobIds.length ? db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds)) : [],
  ]);
  const propById = new Map(props.map((p) => [p.id, p]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  res.json(
    checks.map((p) => {
      const inv = p.invoiceId ? invById.get(p.invoiceId) : undefined;
      const prop = inv ? propById.get(inv.propertyId) : undefined;
      const job = inv?.jobId ? jobById.get(inv.jobId) : undefined;
      return {
        id: p.id,
        invoiceId: p.invoiceId ?? null,
        invoiceNo: inv?.invoiceNo ?? null,
        invoiceStatus: inv?.status ?? null,
        propertyId: inv?.propertyId ?? null,
        propertyName: prop?.name ?? null,
        jobId: inv?.jobId ?? null,
        jobLabel: job ? `Job ${job.jobNo}` : null,
        amount: p.amount,
        method: p.method ?? null,
        payerName: p.payerName ?? null,
        checkNumber: p.checkNumber ?? null,
        checkImagePath: p.checkImagePath ?? null,
        receivedAt: p.receivedAt ? p.receivedAt.toISOString() : null,
      };
    }),
  );
});

router.post("/checks/scan", async (req, res): Promise<void> => {
  const body = ScanCheckBody.parse(req.body);
  let extracted: {
    found: boolean;
    amount: number | null;
    payerName: string | null;
    checkNumber: string | null;
    checkDate: string | null;
    memo: string | null;
    bankName: string | null;
  };
  try {
    extracted = await completeJsonWithImage(
      `You are an expert reader of photographed paper checks (US bank checks) for a property-maintenance business.
Read carefully even if the photo is rotated, skewed, dim, or blurry — mentally deskew it first. Transcribe names and numbers EXACTLY as printed; never guess a digit.
Return STRICT JSON: {"found": boolean, "amount": number|null, "payerName": string|null, "checkNumber": string|null, "checkDate": "YYYY-MM-DD"|null, "memo": string|null, "bankName": string|null}.
- found=false if the image is not a check or is unreadable.
- amount: the numeric courtesy-box amount — ALWAYS cross-check it against the written (legal) amount line; if they disagree, trust the written line. Use null if you cannot read it confidently.
- payerName: the printed account holder / company name at the top left.
- checkNumber: the check number (top right, also in the MICR line).
- memo: the memo/for line if written.`,
      "Read this check and extract the fields.",
      body.image,
      body.mediaType,
    );
  } catch {
    res.json(ScanCheckResponse.parse({ found: false }));
    return;
  }
  if (!extracted.found) {
    res.json(ScanCheckResponse.parse({ found: false }));
    return;
  }

  // Suggest the invoice this check most likely pays: match on amount
  // first, then payer-name tokens against property / contact names.
  // All statuses are candidates (draft/paid included) — unpaid ones get a
  // small boost so open invoices win ties.
  const openInvoices = await db.select().from(invoicesTable);
  const props = await db.select().from(propertiesTable);
  const contacts = await db.select().from(contactsTable);
  const propName = (id: string | null) => props.find((p) => p.id === id)?.name ?? "";
  const tokens = (s: string) =>
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  const payerTokens = tokens(
    [extracted.payerName ?? "", extracted.memo ?? ""].join(" "),
  );
  let best: { inv: (typeof openInvoices)[number]; score: number } | null = null;
  for (const inv of openInvoices) {
    let score = 0;
    if (extracted.amount != null && Math.abs(inv.amount - extracted.amount) < 0.005) score += 5;
    const propContacts = contacts.filter((c) => c.propertyId === inv.propertyId);
    const nameTokens = tokens(
      [propName(inv.propertyId), ...propContacts.map((c) => c.name ?? "")].join(" "),
    );
    for (const t of payerTokens) if (nameTokens.includes(t)) score += 2;
    // "past_due" is virtual (stored as "sent"), so "sent" alone covers all open invoices.
    if (score > 0 && inv.status === "sent") score += 1;
    if (score > (best?.score ?? 0)) best = { inv, score };
  }
  const suggestion = best && best.score >= 2 ? best.inv : null;

  res.json(
    ScanCheckResponse.parse({
      found: true,
      amount: extracted.amount ?? null,
      payerName: extracted.payerName ?? null,
      checkNumber: extracted.checkNumber ?? null,
      checkDate: extracted.checkDate ?? null,
      memo: extracted.memo ?? null,
      bankName: extracted.bankName ?? null,
      suggestedInvoiceId: suggestion?.id ?? null,
      suggestedPropertyId: suggestion?.propertyId ?? null,
      suggestedJobId: suggestion?.jobId ?? null,
      summary: suggestion
        ? `Looks like a $${extracted.amount?.toFixed(2) ?? "?"} check from ${extracted.payerName ?? "an unknown payer"} — likely for invoice ${suggestion.invoiceNo}. Confirm the property and job below.`
        : `Read a $${extracted.amount?.toFixed(2) ?? "?"} check from ${extracted.payerName ?? "an unknown payer"}. Pick the property and job it pays below.`,
    }),
  );
});

router.post("/payments", async (req, res): Promise<void> => {
  const body = RecordPaymentBody.parse(req.body);
  const [row] = await db.insert(paymentsTable).values(body).returning();
  const [inv] = await db
    .update(invoicesTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(invoicesTable.id, body.invoiceId))
    .returning();
  if (inv?.jobId) await recomputeJobFinancials(inv.jobId);
  if (inv) await syncInvoiceLedger(inv.id);
  // The board mirrors reality: a paid invoice's card completes itself.
  if (inv) await completeClientCard("invoice", inv.id, "Paid — thank you");
  if (inv && (body.checkNumber || body.checkImagePath)) {
    const names = await propertyNames();
    await db.insert(activitiesTable).values({
      kind: "payment",
      body: `Check payment recorded — $${body.amount.toFixed(2)} for ${inv.invoiceNo}${inv.propertyId ? ` (${names.get(inv.propertyId) ?? "property"})` : ""}${body.checkNumber ? `, check #${body.checkNumber}` : ""}`,
      entityType: "invoice",
      entityId: inv.id,
      storagePath: body.checkImagePath ?? undefined,
    });
  }
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
  // Attach the linked job's unit number so expense lists can group by unit.
  const jobIds = [...new Set(rows.map((r) => r.jobId).filter(Boolean))] as string[];
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const unitByJob = new Map(jobs.map((j) => [j.id, j.unitNo ?? null]));
  res.json(
    ListExpensesResponse.parse(
      rows.map((r) => ({ ...ser(r), unitNo: r.jobId ? (unitByJob.get(r.jobId) ?? null) : null })),
    ),
  );
});

router.post("/expenses", async (req, res): Promise<void> => {
  const body = CreateExpenseBody.parse(req.body);
  if (body.jobId) {
    const [job] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, body.jobId));
    if (!job) {
      res.status(400).json({ error: "Job not found" });
      return;
    }
    if (body.propertyId && job.propertyId && job.propertyId !== body.propertyId) {
      res.status(400).json({ error: "Job does not belong to this property" });
      return;
    }
  }
  // Approval workflow: expenses at/above the configured threshold start as
  // pending and stay off the books until approved.
  const settings = await getBusinessSettings();
  const threshold = settings.expenseApprovalThreshold ?? 0;
  const needsApproval = threshold > 0 && body.amount >= threshold;
  // spentOn arrives as YYYY-MM-DD; anchor at local noon so the day never
  // shifts across timezones.
  const { spentOn: spentOnStr, ...rest } = body;
  const spentOn =
    spentOnStr && /^\d{4}-\d{2}-\d{2}$/.test(spentOnStr)
      ? new Date(`${spentOnStr}T12:00:00`)
      : undefined;
  const [row] = await db
    .insert(expensesTable)
    .values({
      ...rest,
      ...(spentOn ? { spentOn } : {}),
      approvalStatus: needsApproval ? "pending" : "approved",
    })
    .returning();
  if (row.jobId) await recomputeJobFinancials(row.jobId);
  await syncExpenseLedger(row.id);
  res.status(201).json(CreateExpenseResponse.parse(ser(row)));
});

router.post("/expenses/:id/approve", async (req, res): Promise<void> => {
  const { id } = ApproveExpenseParams.parse(req.params);
  const [exp] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!exp) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  if (exp.approvalStatus === "approved") {
    res.json(ApproveExpenseResponse.parse(ser(exp)));
    return;
  }
  const [updated] = await db
    .update(expensesTable)
    .set({ approvalStatus: "approved", approvedAt: new Date() })
    .where(eq(expensesTable.id, id))
    .returning();
  if (updated.jobId) await recomputeJobFinancials(updated.jobId);
  await syncExpenseLedger(updated.id);
  await db.insert(activitiesTable).values({
    entityType: "expense",
    entityId: updated.id,
    kind: "note",
    body: `Approved expense of $${updated.amount.toFixed(2)}${updated.vendor ? ` at ${updated.vendor}` : ""}`,
  });
  res.json(ApproveExpenseResponse.parse(ser(updated)));
});

router.post("/expenses/:id/reject", async (req, res): Promise<void> => {
  const { id } = RejectExpenseParams.parse(req.params);
  const [exp] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!exp) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  const [updated] = await db
    .update(expensesTable)
    .set({ approvalStatus: "rejected", approvedAt: null })
    .where(eq(expensesTable.id, id))
    .returning();
  if (updated.jobId) await recomputeJobFinancials(updated.jobId);
  await syncExpenseLedger(updated.id);
  await db.insert(activitiesTable).values({
    entityType: "expense",
    entityId: updated.id,
    kind: "note",
    body: `Rejected expense of $${updated.amount.toFixed(2)}${updated.vendor ? ` at ${updated.vendor}` : ""}`,
  });
  res.json(RejectExpenseResponse.parse(ser(updated)));
});

router.post("/expenses/:id/pay", async (req, res): Promise<void> => {
  const { id } = PayExpenseBillParams.parse(req.params);
  const [exp] = await db.select().from(expensesTable).where(eq(expensesTable.id, id));
  if (!exp) {
    res.status(404).json({ error: "Expense not found" });
    return;
  }
  if (exp.paymentStatus === "paid") {
    res.json(PayExpenseBillResponse.parse(ser(exp)));
    return;
  }
  const [updated] = await db
    .update(expensesTable)
    .set({ paymentStatus: "paid", paidAt: new Date() })
    .where(eq(expensesTable.id, id))
    .returning();
  await syncExpenseLedger(updated.id);
  res.json(PayExpenseBillResponse.parse(ser(updated)));
});

export default router;
