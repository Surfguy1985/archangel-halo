import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db,
  jobsTable,
  propertiesTable,
  priceItemsTable,
  expensesTable,
  invoicesTable,
} from "@workspace/db";
import {
  BuildInvoiceJobDraftBody,
  BuildInvoiceJobDraftResponse,
} from "@workspace/api-zod";
import { completeComplexJson } from "../lib/ai";
import { getSopRule, applySopToInvoice, type SopRuleSet } from "./sop";
import { resolveTaxAmount } from "./money";

const router: IRouter = Router();

/* ----------------------------------------------------------------
   Invoice Wizard: build a fully SOP-compliant invoice draft from a
   job. Measure-twice pipeline:
     Pass 1 — drafting model breaks the job out into line items
              exactly as the property's SOP demands.
     Pass 2 — a separate audit call re-reads the SOP rule and the
              draft, flags violations, and returns corrections.
   The draft is then run through the same deterministic SOP engine
   (applySopToInvoice) used at create time, so what the office sees
   in the preview is what will be enforced when they hit Create.
   ---------------------------------------------------------------- */

type DraftLine = {
  dateOfWork?: string;
  unitNo?: string;
  typeOfWork: string;
  description?: string;
  qty?: number;
  unitPrice?: number;
};

function sanitizeLines(raw: unknown): DraftLine[] {
  if (!Array.isArray(raw)) return [];
  const out: DraftLine[] = [];
  for (const l of raw) {
    if (!l || typeof l !== "object") continue;
    const o = l as Record<string, unknown>;
    const typeOfWork = typeof o.typeOfWork === "string" ? o.typeOfWork.trim() : "";
    if (!typeOfWork) continue;
    // Bounds: qty capped at 999, unit price at $100k — anything wilder from
    // the model is a hallucination, not a make-ready line item.
    const num = (v: unknown, max: number): number | undefined =>
      typeof v === "number" && Number.isFinite(v) && v >= 0
        ? Math.min(Math.round(v * 100) / 100, max)
        : undefined;
    out.push({
      typeOfWork,
      description: typeof o.description === "string" && o.description.trim() ? o.description.trim() : undefined,
      dateOfWork:
        typeof o.dateOfWork === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.dateOfWork)
          ? o.dateOfWork
          : undefined,
      unitNo: typeof o.unitNo === "string" && o.unitNo.trim() ? o.unitNo.trim() : undefined,
      qty: num(o.qty, 999) ?? 1,
      unitPrice: num(o.unitPrice, 100_000) ?? 0,
    });
  }
  return out.slice(0, 25);
}

function lineTotal(lines: DraftLine[]): number {
  return (
    Math.round(
      lines.reduce((s, l) => s + (l.qty ?? 1) * (l.unitPrice ?? 0), 0) * 100,
    ) / 100
  );
}

function ruleSummary(rule: SopRuleSet): string {
  return JSON.stringify(rule);
}

router.post("/invoices/job-draft", async (req, res): Promise<void> => {
  const parsed = BuildInvoiceJobDraftBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { jobId, poNumber } = parsed.data;

  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId))
    .limit(1);
  if (!prop) {
    res.status(400).json({ error: "Job has no property" });
    return;
  }
  const rule = await getSopRule(job.propertyId);
  if (!rule) {
    res.status(400).json({
      error: `No SOP rule for ${prop.name} yet — upload the SOP document first so the wizard knows how to break this invoice out.`,
    });
    return;
  }

  // Facts the drafting model works from — only real data, never invented.
  const priceBook = await db
    .select()
    .from(priceItemsTable)
    .where(eq(priceItemsTable.propertyId, job.propertyId));
  const approvedExpenses = await db
    .select()
    .from(expensesTable)
    .where(
      and(eq(expensesTable.jobId, job.id), eq(expensesTable.approvalStatus, "approved")),
    );
  const priorInvoices = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.jobId, job.id));

  const workDate = job.completedAt
    ? job.completedAt.toISOString().slice(0, 10)
    : (job.scheduledOn ?? job.flexDueBy ?? null);
  const facts = {
    job: {
      jobNo: job.jobNo,
      workOrder: job.woNo,
      unitNo: job.unitNo,
      category: job.category,
      description: job.description,
      status: job.status,
      workDate,
      crewRate: job.crewRate,
    },
    property: { name: prop.name, pmc: prop.pmcName },
    priceBook: priceBook.map((p) => ({
      service: p.service,
      detail: p.detail,
      unit: p.unit,
      rate: p.rate,
    })),
    approvedJobExpenses: approvedExpenses.map((e) => ({
      label: [e.vendor, e.category].filter(Boolean).join(" — ") || "Expense",
      amount: e.amount,
    })),
    alreadyInvoicedTimes: priorInvoices.length,
  };

  const DRAFT_SYSTEM = [
    "You are the drafting stage of an invoice engine for a make-ready / restoration contractor.",
    "Given a JOB and the property's SOP BILLING RULE, produce the invoice line items exactly the way the SOP demands: its categories, its description style, its rates when the SOP fixes them, its date format is handled elsewhere (always output dates as YYYY-MM-DD).",
    "Pricing sources in priority order: (1) rates fixed by the SOP line_item_rules, (2) the property price book, (3) approved job expenses passed through when the SOP allows, (4) job.crewRate only as a labor-cost hint, never as the billed price on its own.",
    "Never invent work that isn't evidenced by the job facts. Keep it to what was actually done.",
    'Return JSON: {"lineItems":[{"dateOfWork":"YYYY-MM-DD","unitNo":"","typeOfWork":"","description":"","qty":1,"unitPrice":0}],"notes":"anything the SOP requires stated on the invoice, else empty"}',
  ].join("\n");

  let lines: DraftLine[] = [];
  let draftNotes = "";
  const compliance: { stage: string; status: string; detail: string }[] = [];
  try {
    const first = await completeComplexJson<{ lineItems?: unknown; notes?: unknown }>(
      DRAFT_SYSTEM,
      `SOP BILLING RULE:\n${ruleSummary(rule)}\n\nJOB FACTS:\n${JSON.stringify(facts)}`,
      3000,
    );
    lines = sanitizeLines(first.lineItems);
    draftNotes = typeof first.notes === "string" ? first.notes.trim() : "";
  } catch (err) {
    console.error("Invoice draft pass 1 failed:", err);
    res.status(502).json({ error: "Couldn't draft the invoice — try again in a moment." });
    return;
  }
  if (lines.length === 0) {
    res.status(502).json({
      error: "The wizard couldn't find billable work on this job. Add a description or price-book services, then retry.",
    });
    return;
  }
  compliance.push({
    stage: "First pass — invoice drafted from the SOP",
    status: "pass",
    detail: `${lines.length} line item${lines.length === 1 ? "" : "s"} broken out using the rule's categories and rates.`,
  });

  // Measure twice: an independent audit call re-checks the draft against the rule.
  const AUDIT_SYSTEM = [
    "You are the compliance auditor of an invoice engine. You did NOT write this draft.",
    "Re-read the SOP BILLING RULE, then audit the DRAFT line items against it: categories, description style, fixed rates, required breakouts, anything in special_instructions that affects line items.",
    "If the draft violates the rule, correct it. If it is compliant, say so.",
    'Return JSON: {"compliant":true,"violations":[{"rule":"","issue":"","fix":""}],"correctedLineItems":null} — correctedLineItems must be the FULL corrected array (same shape as the draft) when and only when you found violations, else null.',
  ].join("\n");
  try {
    const audit = await completeComplexJson<{
      compliant?: boolean;
      violations?: { rule?: string; issue?: string; fix?: string }[];
      correctedLineItems?: unknown;
    }>(
      AUDIT_SYSTEM,
      `SOP BILLING RULE:\n${ruleSummary(rule)}\n\nDRAFT LINE ITEMS:\n${JSON.stringify(lines)}\n\nJOB FACTS (for reference):\n${JSON.stringify(facts)}`,
      3000,
    );
    const corrected = sanitizeLines(audit.correctedLineItems);
    const violations = Array.isArray(audit.violations)
      ? audit.violations.filter((v) => v && (v.issue || v.rule))
      : [];
    if (violations.length > 0 && corrected.length > 0) {
      lines = corrected;
      compliance.push({
        stage: "Second pass — audited against the rule",
        status: "fixed",
        detail: violations
          .map((v) => `${v.rule ? `${v.rule}: ` : ""}${v.issue ?? ""}${v.fix ? ` → ${v.fix}` : ""}`)
          .join(" · "),
      });
    } else if (violations.length > 0) {
      compliance.push({
        stage: "Second pass — audited against the rule",
        status: "warn",
        detail: violations.map((v) => v.issue ?? v.rule ?? "").join(" · "),
      });
    } else {
      compliance.push({
        stage: "Second pass — audited against the rule",
        status: "pass",
        detail: "Independent audit found the breakout compliant with the SOP.",
      });
    }
  } catch (err) {
    console.error("Invoice draft audit pass failed:", err);
    compliance.push({
      stage: "Second pass — audited against the rule",
      status: "warn",
      detail: "Audit call failed — the deterministic SOP engine below still enforces the rule at create time.",
    });
  }

  // Deterministic enforcement preview — the exact engine that runs on create.
  const issuedOn = new Date().toISOString().slice(0, 10);
  const total = lineTotal(lines);
  const sop = await applySopToInvoice(job.propertyId, {
    issuedOn,
    poNumber: poNumber ?? null,
    terms: null,
    dueProvided: false,
    billToName: null,
    propertyAddress: null,
    paymentInstructions: null,
    notes: draftNotes || null,
    taxAmount: null,
    total,
  });
  if (sop && !sop.ok) {
    // Hard SOP block (e.g. PO required) — surface it instead of a draft.
    res.status(400).json({ error: sop.error });
    return;
  }
  const applied = sop && sop.ok ? sop : null;
  compliance.push({
    stage: "Rule engine — hard requirements verified",
    status: "pass",
    detail: [
      applied?.invoiceNo ? `Invoice # ${applied.invoiceNo} per SOP format` : null,
      applied?.dueAt ? `due ${applied.dueAt.toISOString().slice(0, 10)}` : null,
      applied?.taxAmount != null ? `tax $${applied.taxAmount.toFixed(2)} at the SOP rate` : null,
      rule.format?.po_required ? "PO requirement satisfied" : null,
    ]
      .filter(Boolean)
      .join(" · ") || "No additional hard requirements in the rule.",
  });

  res.json(
    BuildInvoiceJobDraftResponse.parse({
      jobId: job.id,
      jobLabel: `#${job.jobNo} — ${prop.name}${job.unitNo ? ` · Unit ${job.unitNo}` : ""}`,
      propertyId: job.propertyId,
      propertyName: prop.name,
      issuedOn,
      poNumber: poNumber ?? null,
      invoiceNoPreview: applied?.invoiceNo ?? null,
      dueOnPreview: applied?.dueAt ? applied.dueAt.toISOString().slice(0, 10) : null,
      terms: applied?.terms ?? rule.format?.payment_terms ?? null,
      billToName: applied?.billToName ?? rule.property?.client_company ?? null,
      propertyAddress: applied?.propertyAddress ?? rule.property?.billing_address ?? null,
      paymentInstructions: applied?.paymentInstructions ?? null,
      notes: draftNotes || applied?.notes || null,
      // Parity with create: when the SOP doesn't fix a tax rate, the create
      // path falls back to the business tax rate — preview must match.
      taxPreview: applied?.taxAmount ?? (await resolveTaxAmount(undefined, total)) ?? null,
      total,
      lineItems: lines,
      compliance,
    }),
  );
});

export default router;
