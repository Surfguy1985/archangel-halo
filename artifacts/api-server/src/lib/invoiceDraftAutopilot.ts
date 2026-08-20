/**
 * Invoice Draft Autopilot
 * Multipoint checks → green / yellow / red drafts
 * Bot writes the invoice; human only approves exceptions.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db, jobsTable, workReviewsTable, invoicesTable, invoiceLineItemsTable,
  masterPriceListTable, crewPayoutMasterTable,
} from "@workspace/db";
import { logger } from "./logger";
import { buildWorkVerification } from "./workVerification";
import { buildMarginReport, completeReviewToInvoice, saveReportCard, listReviews } from "./workReviewPipeline";
import { normalizeServiceCode } from "./financialReconciliationCore";
import { ensureWorkReviewsSchema } from "./ensureWorkReviewsSchema";
import { sql } from "drizzle-orm";

export type DraftBucket = "green" | "yellow" | "red";

export type MultipointCheck = {
  id: string;
  label: string;
  pass: boolean;
  severity: "info" | "warn" | "fail";
  detail: string;
};

export type InvoiceDraftLine = {
  serviceCode: string;
  label: string;
  qty: number;
  unitPriceCents: number;
  amountCents: number;
  source: "master" | "field" | "invoice" | "missing";
  crewCents: number;
};

export type InvoiceDraft = {
  id: string;
  jobId: string;
  reviewId: string | null;
  jobNo: string | null;
  unitNo: string | null;
  bucket: DraftBucket;
  checks: MultipointCheck[];
  lines: InvoiceDraftLine[];
  invoiceTotalCents: number;
  crewTotalCents: number;
  marginCents: number;
  marginPct: number | null;
  summary: string;
  createdAt: string;
};

let draftsEnsured = false;
async function ensureDraftsTable() {
  if (draftsEnsured) return;
  await ensureWorkReviewsSchema();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoice_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id uuid NOT NULL,
      review_id uuid,
      job_no text,
      unit_no text,
      bucket text NOT NULL DEFAULT 'yellow',
      checks jsonb NOT NULL DEFAULT '[]',
      lines jsonb NOT NULL DEFAULT '[]',
      invoice_total_cents integer NOT NULL DEFAULT 0,
      crew_total_cents integer NOT NULL DEFAULT 0,
      margin_cents integer NOT NULL DEFAULT 0,
      margin_pct double precision,
      summary text,
      status text NOT NULL DEFAULT 'draft',
      payload jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS invoice_drafts_job_idx ON invoice_drafts (job_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS invoice_drafts_bucket_idx ON invoice_drafts (bucket)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS invoice_drafts_status_idx ON invoice_drafts (status)`);
  draftsEnsured = true;
}

async function masterInvoice(code: string) {
  const rows = await db.select().from(masterPriceListTable).where(eq(masterPriceListTable.serviceCode, code));
  return rows.find((r) => r.unitType === "2br") || rows.find((r) => r.unitType === "flat") || rows[0] || null;
}
async function masterCrew(code: string) {
  const rows = await db.select().from(crewPayoutMasterTable).where(eq(crewPayoutMasterTable.serviceCode, code));
  return rows.find((r) => r.unitType === "2br") || rows.find((r) => r.unitType === "flat") || rows[0] || null;
}

/** Multipoint integrity checks — the difference PMs feel in 30 seconds */
export function runMultipointChecks(input: {
  hasJob: boolean;
  boardStatus?: string | null;
  invoicePresent: boolean;
  lineCount: number;
  invoiceTotalCents: number;
  missingServiceCount: number;
  highSuggestionCount: number;
  crewIssueCount: number;
  marginPct: number | null;
  allLinesPriced: boolean;
  varianceLineCount: number;
}): MultipointCheck[] {
  const c: MultipointCheck[] = [];
  c.push({
    id: "job",
    label: "Job exists",
    pass: input.hasJob,
    severity: input.hasJob ? "info" : "fail",
    detail: input.hasJob ? "Linked to dispatch job" : "No job record",
  });
  const done = ["completed", "complete", "billing", "done"].includes((input.boardStatus || "").toLowerCase());
  c.push({
    id: "complete",
    label: "Work complete",
    pass: done,
    severity: done ? "info" : "fail",
    detail: done ? `Status: ${input.boardStatus}` : `Still ${input.boardStatus || "unknown"}`,
  });
  c.push({
    id: "lines",
    label: "Service lines",
    pass: input.lineCount > 0,
    severity: input.lineCount > 0 ? "info" : "fail",
    detail: input.lineCount > 0 ? `${input.lineCount} line(s)` : "No billable services",
  });
  c.push({
    id: "priced",
    label: "All lines priced",
    pass: input.allLinesPriced && input.invoiceTotalCents > 0,
    severity: input.allLinesPriced && input.invoiceTotalCents > 0 ? "info" : "fail",
    detail: input.invoiceTotalCents > 0 ? `$${(input.invoiceTotalCents / 100).toFixed(2)}` : "Missing $",
  });
  c.push({
    id: "master",
    label: "Matches master rates",
    pass: input.varianceLineCount === 0,
    severity: input.varianceLineCount === 0 ? "info" : "warn",
    detail: input.varianceLineCount === 0 ? "Aligned to rate sheet" : `${input.varianceLineCount} variance(s)`,
  });
  c.push({
    id: "services",
    label: "No missing services",
    pass: input.missingServiceCount === 0,
    severity: input.missingServiceCount === 0 ? "info" : "warn",
    detail: input.missingServiceCount === 0 ? "Complete scope" : `${input.missingServiceCount} missing`,
  });
  c.push({
    id: "crew",
    label: "Crew assignment OK",
    pass: input.crewIssueCount === 0,
    severity: input.crewIssueCount === 0 ? "info" : "warn",
    detail: input.crewIssueCount === 0 ? "Crew mapped" : `${input.crewIssueCount} issue(s)`,
  });
  c.push({
    id: "flags",
    label: "No critical flags",
    pass: input.highSuggestionCount === 0,
    severity: input.highSuggestionCount === 0 ? "info" : "fail",
    detail: input.highSuggestionCount === 0 ? "Clean" : `${input.highSuggestionCount} high severity`,
  });
  const marginOk = input.marginPct == null || (input.marginPct >= 0.15 && input.marginPct <= 0.85);
  c.push({
    id: "margin",
    label: "Margin in range",
    pass: marginOk,
    severity: marginOk ? "info" : "warn",
    detail: input.marginPct == null ? "—" : `${(input.marginPct * 100).toFixed(0)}%`,
  });
  return c;
}

function bucketFromChecks(checks: MultipointCheck[]): DraftBucket {
  if (checks.some((c) => !c.pass && c.severity === "fail")) return "red";
  if (checks.some((c) => !c.pass && c.severity === "warn")) return "yellow";
  return "green";
}

export async function buildInvoiceDraftForJob(jobId: string, reviewId?: string | null): Promise<InvoiceDraft | null> {
  await ensureDraftsTable();
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) return null;

  const verification = await buildWorkVerification(jobId);
  const margin = await buildMarginReport(jobId);
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.jobId, jobId));
  const invoice = invoices[0];
  const invLines = invoice
    ? await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id))
    : [];

  const lines: InvoiceDraftLine[] = [];
  let varianceLineCount = 0;

  // Prefer verification lines + master pricing
  const vLines = verification?.lines || [];
  if (vLines.length > 0) {
    for (const l of vLines) {
      const code = normalizeServiceCode(l.serviceCode || l.label || "");
      const mi = await masterInvoice(code);
      const mc = await masterCrew(code);
      const masterCents = mi?.rateCents ?? null;
      const actual = l.actualInvoiceCents ?? null;
      const expected = l.expectedInvoiceCents ?? masterCents;
      let unit = expected ?? actual ?? 0;
      let source: InvoiceDraftLine["source"] = expected != null ? "master" : actual != null ? "field" : "missing";
      if (actual != null && expected != null && actual !== expected) {
        varianceLineCount++;
        unit = expected; // draft prefers master
        source = "master";
      }
      if (unit === 0 && masterCents) {
        unit = masterCents;
        source = "master";
      }
      lines.push({
        serviceCode: code,
        label: l.label || code,
        qty: 1,
        unitPriceCents: unit,
        amountCents: unit,
        source,
        crewCents: mc?.rateCents ?? 0,
      });
    }
  } else if (invLines.length > 0) {
    for (const line of invLines) {
      const code = normalizeServiceCode(line.typeOfWork || line.description || "");
      const mi = await masterInvoice(code);
      const mc = await masterCrew(code);
      const actual = Math.round((Number(line.unitPrice) || 0) * 100);
      const masterCents = mi?.rateCents ?? null;
      if (masterCents != null && actual !== masterCents && actual > 0) varianceLineCount++;
      const unit = masterCents && (actual === 0 || actual !== masterCents) ? masterCents : actual;
      lines.push({
        serviceCode: code,
        label: line.typeOfWork || line.description || code,
        qty: line.qty || 1,
        unitPriceCents: unit,
        amountCents: unit * (line.qty || 1),
        source: masterCents != null ? "master" : actual > 0 ? "invoice" : "missing",
        crewCents: mc?.rateCents ?? 0,
      });
    }
  }

  // margin lines as fallback enrichment
  if (lines.length === 0 && margin.lines.length > 0) {
    for (const l of margin.lines) {
      lines.push({
        serviceCode: l.serviceCode,
        label: l.label,
        qty: 1,
        unitPriceCents: l.invoiceCents,
        amountCents: l.invoiceCents,
        source: l.invoiceCents > 0 ? "master" : "missing",
        crewCents: l.crewCents,
      });
    }
  }

  const invoiceTotalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const crewTotalCents = lines.reduce((s, l) => s + l.crewCents, 0);
  const marginCents = invoiceTotalCents - crewTotalCents;
  const marginPct = invoiceTotalCents > 0 ? marginCents / invoiceTotalCents : null;
  const allLinesPriced = lines.length > 0 && lines.every((l) => l.amountCents > 0);

  const highSuggestionCount = (verification?.suggestions || []).filter(
    (s) => s.severity === "high" || s.severity === "critical",
  ).length;
  const missingServiceCount = verification?.missingServices?.length || 0;
  const crewIssueCount = verification?.crewAssignmentIssues?.length || 0;

  const checks = runMultipointChecks({
    hasJob: true,
    boardStatus: job.boardStatus || job.status,
    invoicePresent: !!invoice,
    lineCount: lines.length,
    invoiceTotalCents,
    missingServiceCount,
    highSuggestionCount,
    crewIssueCount,
    marginPct,
    allLinesPriced,
    varianceLineCount,
  });
  const bucket = bucketFromChecks(checks);
  const failN = checks.filter((c) => !c.pass && c.severity === "fail").length;
  const warnN = checks.filter((c) => !c.pass && c.severity === "warn").length;

  const summary =
    bucket === "green"
      ? "Ready to approve — all checks passed"
      : bucket === "yellow"
        ? `${warnN} item(s) to confirm before approve`
        : `${failN} blocker(s) — cannot bill yet`;

  return {
    id: `draft-${jobId.slice(0, 8)}`,
    jobId,
    reviewId: reviewId || null,
    jobNo: job.jobNo || verification?.jobNo || null,
    unitNo: job.unitNo || verification?.unitNo || null,
    bucket,
    checks,
    lines,
    invoiceTotalCents,
    crewTotalCents,
    marginCents,
    marginPct,
    summary,
    createdAt: new Date().toISOString(),
  };
}

export async function persistDraft(draft: InvoiceDraft) {
  await ensureDraftsTable();
  // upsert by job_id for open drafts
  await db.execute(sql`
    DELETE FROM invoice_drafts WHERE job_id = ${draft.jobId}::uuid AND status = 'draft'
  `);
  const reviewIdParam = draft.reviewId || null;
  await db.execute(sql`
    INSERT INTO invoice_drafts (
      job_id, review_id, job_no, unit_no, bucket, checks, lines,
      invoice_total_cents, crew_total_cents, margin_cents, margin_pct, summary, status, payload
    ) VALUES (
      ${draft.jobId}::uuid,
      ${reviewIdParam},
      ${draft.jobNo},
      ${draft.unitNo},
      ${draft.bucket},
      ${JSON.stringify(draft.checks)}::jsonb,
      ${JSON.stringify(draft.lines)}::jsonb,
      ${draft.invoiceTotalCents},
      ${draft.crewTotalCents},
      ${draft.marginCents},
      ${draft.marginPct},
      ${draft.summary},
      'draft',
      ${JSON.stringify(draft)}::jsonb
    )
  `);
}

export async function runInvoiceDraftAutopilot(opts?: { limit?: number }) {
  await ensureDraftsTable();
  const limit = opts?.limit ?? 50;
  // Prefer margin_ready (dispatch approved); also scan recent completed
  const ready = await listReviews("margin_ready");
  const jobIds = new Set(ready.map((r) => r.jobId));
  const jobs = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(inArray(jobsTable.boardStatus, ["completed", "complete", "billing", "done"]))
    .orderBy(desc(jobsTable.createdAt))
    .limit(limit);

  for (const j of jobs) jobIds.add(j.id);

  const drafts: InvoiceDraft[] = [];
  let green = 0, yellow = 0, red = 0;

  for (const jobId of [...jobIds].slice(0, limit)) {
    const rev = ready.find((r) => r.jobId === jobId);
    const draft = await buildInvoiceDraftForJob(jobId, rev?.id || null);
    if (!draft) continue;
    await persistDraft(draft);
    await saveReportCard({
      reviewId: draft.reviewId,
      jobId: draft.jobId,
      jobNo: draft.jobNo,
      unitNo: draft.unitNo,
      stage: "invoice_draft",
      title: `Invoice draft · ${draft.bucket.toUpperCase()} · ${draft.jobNo || jobId.slice(0, 8)}`,
      summary: draft.summary,
      actor: "invoice_autopilot",
      marginReport: {
        lines: draft.lines.map((l) => ({
          serviceCode: l.serviceCode,
          label: l.label,
          invoiceCents: l.amountCents,
          crewCents: l.crewCents,
          marginCents: l.amountCents - l.crewCents,
          marginPct: l.amountCents > 0 ? (l.amountCents - l.crewCents) / l.amountCents : null,
        })),
        invoiceTotalCents: draft.invoiceTotalCents,
        crewTotalCents: draft.crewTotalCents,
        marginTotalCents: draft.marginCents,
        marginPct: draft.marginPct,
        currency: "USD",
        generatedAt: draft.createdAt,
      },
      card: { version: 1, stage: "invoice_draft", ...draft },
    }).catch(() => null);
    drafts.push(draft);
    if (draft.bucket === "green") green++;
    else if (draft.bucket === "yellow") yellow++;
    else red++;
  }

  const result = {
    ok: true as const,
    ranAt: new Date().toISOString(),
    count: drafts.length,
    green,
    yellow,
    red,
    drafts: drafts.sort((a, b) => {
      const o = { green: 0, yellow: 1, red: 2 };
      return o[a.bucket] - o[b.bucket];
    }),
  };
  logger.info({ green, yellow, red, count: drafts.length }, "Invoice Draft Autopilot complete");
  return result;
}

export async function listInvoiceDrafts(bucket?: DraftBucket) {
  await ensureDraftsTable();
  if (bucket) {
    const rows = await db.execute(sql`
      SELECT id, job_id, review_id, job_no, unit_no, bucket, checks, lines,
             invoice_total_cents, crew_total_cents, margin_cents, margin_pct, summary, status, created_at
      FROM invoice_drafts WHERE status = 'draft' AND bucket = ${bucket}
      ORDER BY created_at DESC LIMIT 100
    `);
    return (rows as any).rows || rows;
  }
  const rows = await db.execute(sql`
    SELECT id, job_id, review_id, job_no, unit_no, bucket, checks, lines,
           invoice_total_cents, crew_total_cents, margin_cents, margin_pct, summary, status, created_at
    FROM invoice_drafts WHERE status = 'draft'
    ORDER BY CASE bucket WHEN 'green' THEN 0 WHEN 'yellow' THEN 1 ELSE 2 END, created_at DESC
    LIMIT 100
  `);
  return (rows as any).rows || rows;
}

export async function getDraftSummary() {
  await ensureDraftsTable();
  const rows = await db.execute(sql`
    SELECT bucket, COUNT(*)::int AS n FROM invoice_drafts WHERE status = 'draft' GROUP BY bucket
  `);
  const list = ((rows as any).rows || rows) as Array<{ bucket: string; n: number }>;
  const green = list.find((r) => r.bucket === "green")?.n || 0;
  const yellow = list.find((r) => r.bucket === "yellow")?.n || 0;
  const red = list.find((r) => r.bucket === "red")?.n || 0;
  return {
    green,
    yellow,
    red,
    total: green + yellow + red,
    headline:
      green + yellow + red === 0
        ? "No drafts yet — run autopilot"
        : green > 0 && yellow === 0 && red === 0
          ? `${green} ready · Approve all`
          : `${green} ready · ${yellow} review · ${red} blocked`,
  };
}

/** Approve green draft → complete review to invoice queue when possible */
export async function approveDraft(draftId: string, actor = "office") {
  await ensureDraftsTable();
  const rows = await db.execute(sql`
    SELECT id, job_id, review_id, bucket, payload FROM invoice_drafts WHERE id = ${draftId}::uuid LIMIT 1
  `);
  const row = ((rows as any).rows || rows)[0] as any;
  if (!row) return { ok: false as const, error: "Draft not found" };
  if (row.bucket === "red") return { ok: false as const, error: "Red drafts cannot be approved" };

  if (row.review_id) {
    try {
      await completeReviewToInvoice(row.review_id, actor);
    } catch {
      /* review may not be margin_ready */
    }
  }

  await db.execute(sql`
    UPDATE invoice_drafts SET status = 'approved', updated_at = now() WHERE id = ${draftId}::uuid
  `);
  await saveReportCard({
    reviewId: row.review_id,
    jobId: row.job_id,
    stage: "invoice_draft_approved",
    title: `Invoice approved · ${row.job_id.slice(0, 8)}`,
    summary: `Approved by ${actor}`,
    actor,
    card: { version: 1, stage: "invoice_draft_approved", draftId, actor },
  }).catch(() => null);

  return { ok: true as const, draftId, jobId: row.job_id, status: "approved" };
}

export async function approveAllGreen(actor = "office") {
  await ensureDraftsTable();
  const rows = await db.execute(sql`
    SELECT id FROM invoice_drafts WHERE status = 'draft' AND bucket = 'green'
  `);
  const list = ((rows as any).rows || rows) as Array<{ id: string }>;
  let approved = 0;
  for (const r of list) {
    const res = await approveDraft(r.id, actor);
    if (res.ok) approved++;
  }
  return { ok: true as const, approved, total: list.length };
}
