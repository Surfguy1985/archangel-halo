/**
 * Money Lock — nightly / on-demand close of the work day.
 * Auto-approve CLEAN → invoice queue. Exceptions → triage. Blocked → parked.
 * Mistakes always correctable from invoicing tab via reopen + apply-correction.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, jobsTable, workReviewsTable } from "@workspace/db";
import { logger } from "./logger";
import { buildWorkVerification } from "./workVerification";
import {
  buildMarginReport, openFieldReview, botFinalizeReview, completeReviewToInvoice,
  saveReportCard, getReview, listReviews,
} from "./workReviewPipeline";

export type MoneyLockBucket = "auto_approved" | "exception" | "blocked";
export type MoneyLockItem = {
  jobId: string; jobNo: string | null; unitNo: string | null; reviewId: string | null;
  bucket: MoneyLockBucket; reason: string; marginPct: number | null;
  invoiceTotalCents: number; crewTotalCents: number; suggestions: string[];
};

function isCleanVerification(v: Awaited<ReturnType<typeof buildWorkVerification>>, marginInvoiceCents: number) {
  if (!v) return { clean: false, reason: "Job not found", suggestions: [] as string[] };
  const suggestions = (v.suggestions || []).filter((s) => s.action !== "confirm_clean").map((s) => s.title);
  const hard = (v.suggestions || []).filter((s) => s.action !== "confirm_clean" && (s.severity === "high" || s.severity === "critical"));
  if (marginInvoiceCents <= 0) return { clean: false, reason: "No invoice amount — create/price invoice lines", suggestions };
  if (hard.length > 0) return { clean: false, reason: hard.map((h) => h.title).join("; "), suggestions };
  if (v.status === "needs_attention" && suggestions.length > 0) {
    return { clean: false, reason: suggestions.join("; ") || v.summary, suggestions };
  }
  return { clean: true, reason: "Clean — master rates, crew, services OK", suggestions: [] as string[] };
}

export async function classifyJobForMoneyLock(jobId: string): Promise<MoneyLockItem> {
  const verification = await buildWorkVerification(jobId);
  const margin = await buildMarginReport(jobId);
  const { clean, reason, suggestions } = isCleanVerification(verification, margin.invoiceTotalCents);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  const board = (job?.boardStatus || job?.status || "").toLowerCase();
  const doneEnough = ["completed", "complete", "billing", "done"].includes(board);
  if (!doneEnough) {
    return {
      jobId, jobNo: verification?.jobNo || job?.jobNo || null, unitNo: verification?.unitNo || job?.unitNo || null,
      reviewId: null, bucket: "blocked",
      reason: `Not ready to bill (status: ${job?.boardStatus || job?.status || "unknown"})`,
      marginPct: margin.marginPct, invoiceTotalCents: margin.invoiceTotalCents, crewTotalCents: margin.crewTotalCents, suggestions,
    };
  }
  return {
    jobId, jobNo: verification?.jobNo || null, unitNo: verification?.unitNo || null, reviewId: null,
    bucket: clean ? "auto_approved" : "exception", reason, marginPct: margin.marginPct,
    invoiceTotalCents: margin.invoiceTotalCents, crewTotalCents: margin.crewTotalCents, suggestions,
  };
}

export async function runMoneyLock(opts?: { limit?: number; dryRun?: boolean }) {
  const limit = opts?.limit ?? 80;
  const dryRun = !!opts?.dryRun;
  const jobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(
    or(inArray(jobsTable.boardStatus, ["completed", "complete", "billing", "done"]), inArray(jobsTable.status, ["complete", "completed"])),
  ).orderBy(desc(jobsTable.createdAt)).limit(limit);

  const items: MoneyLockItem[] = [];
  let autoApproved = 0, exceptions = 0, blocked = 0;

  for (const j of jobs) {
    const already = await db.select().from(workReviewsTable).where(
      and(eq(workReviewsTable.jobId, j.id), eq(workReviewsTable.status, "sent_to_invoice")),
    ).orderBy(desc(workReviewsTable.updatedAt)).limit(1);
    if (already[0]) continue;

    const classified = await classifyJobForMoneyLock(j.id);

    if (classified.bucket === "blocked") {
      blocked++; items.push(classified);
      if (!dryRun) {
        await saveReportCard({
          jobId: j.id, jobNo: classified.jobNo, unitNo: classified.unitNo, stage: "money_lock_blocked",
          title: `Money Lock blocked · ${classified.jobNo || j.id.slice(0, 8)}`, summary: classified.reason,
          actor: "money_lock", card: { version: 1, stage: "money_lock_blocked", ...classified },
        }).catch(() => null);
      }
      continue;
    }

    if (classified.bucket === "exception") {
      exceptions++;
      let reviewId: string | null = null;
      if (!dryRun) {
        const opened = await openFieldReview(j.id, "money_lock");
        reviewId = opened.reviewId;
        await db.update(workReviewsTable).set({
          status: "needs_fix", botNotes: `Money Lock exception: ${classified.reason}`, updatedAt: new Date(),
        }).where(eq(workReviewsTable.id, opened.reviewId));
        await saveReportCard({
          reviewId: opened.reviewId, jobId: j.id, jobNo: classified.jobNo, unitNo: classified.unitNo,
          stage: "money_lock_exception", title: `Money Lock exception · ${classified.jobNo || j.id.slice(0, 8)}`,
          summary: classified.reason, actor: "money_lock",
          card: { version: 1, stage: "money_lock_exception", ...classified, reviewId },
        }).catch(() => null);
      }
      items.push({ ...classified, reviewId });
      continue;
    }

    autoApproved++;
    let reviewId: string | null = null;
    if (!dryRun) {
      const opened = await openFieldReview(j.id, "money_lock_auto");
      reviewId = opened.reviewId;
      await db.update(workReviewsTable).set({
        status: "field_submitted",
        fieldEdits: { confirmAccurate: true, moneyLockAuto: true },
        fieldSubmittedAt: new Date(), fieldSubmittedBy: "money_lock", updatedAt: new Date(),
      }).where(eq(workReviewsTable.id, opened.reviewId));
      const final = await botFinalizeReview(opened.reviewId);
      if (final.ok && final.decision === "margin_ready") {
        await completeReviewToInvoice(opened.reviewId, "money_lock");
        await saveReportCard({
          reviewId: opened.reviewId, jobId: j.id, jobNo: classified.jobNo, unitNo: classified.unitNo,
          stage: "money_lock_auto_approved", title: `Money Lock AUTO · ${classified.jobNo || j.id.slice(0, 8)}`,
          summary: classified.reason, actor: "money_lock", marginReport: final.marginReport as any,
          card: { version: 1, stage: "money_lock_auto_approved", ...classified, reviewId: opened.reviewId, marginReport: final.marginReport },
        }).catch(() => null);
      } else {
        autoApproved--; exceptions++;
        classified.bucket = "exception";
        classified.reason = final.ok ? final.notes : "Bot finalize held auto-approve";
        items.push({ ...classified, reviewId: opened.reviewId });
        continue;
      }
    }
    items.push({ ...classified, reviewId });
  }

  const result = { ok: true as const, ranAt: new Date().toISOString(), scanned: jobs.length, autoApproved, exceptions, blocked, items };
  logger.info({ autoApproved, exceptions, blocked, scanned: jobs.length, dryRun }, "Money Lock run complete");
  return result;
}

export async function listMoneyLockExceptions() {
  const rows = await listReviews("needs_fix");
  const pending = await listReviews("pending_field");
  const seen = new Set<string>();
  const out = [];
  for (const r of [...rows, ...pending]) {
    if (seen.has(r.jobId)) continue;
    seen.add(r.jobId);
    out.push(r);
  }
  return out;
}

export async function listInvoiceQueueForTab() {
  return listReviews("sent_to_invoice");
}

export async function reopenForCorrection(opts: {
  reviewId: string; reason?: string; actor?: string; toStatus?: "margin_ready" | "needs_fix" | "pending_field";
}) {
  const review = await getReview(opts.reviewId);
  if (!review) return { ok: false as const, error: "Review not found" };
  if (review.status !== "sent_to_invoice" && review.status !== "margin_ready") {
    return { ok: false as const, error: `Can only reopen from sent_to_invoice/margin_ready (is ${review.status})` };
  }
  const toStatus = opts.toStatus || "margin_ready";
  await db.update(workReviewsTable).set({
    status: toStatus,
    botNotes: `Reopened for correction: ${opts.reason || "office edit"}. Previous: ${review.botNotes || ""}`,
    updatedAt: new Date(),
  }).where(eq(workReviewsTable.id, opts.reviewId));
  await saveReportCard({
    reviewId: opts.reviewId, jobId: review.jobId, stage: "reopened_for_correction",
    title: `Reopened for correction · ${opts.reviewId.slice(0, 8)}`,
    summary: opts.reason || "Office correction from invoicing tab", actor: opts.actor || "office",
    marginReport: review.marginReport as any,
    card: { version: 1, stage: "reopened_for_correction", jobId: review.jobId, reviewId: opts.reviewId, previousStatus: review.status, reason: opts.reason || "office edit", actor: opts.actor || "office" },
  }).catch(() => null);
  return { ok: true as const, reviewId: opts.reviewId, status: toStatus, jobId: review.jobId };
}

export async function applyInvoiceCorrection(opts: {
  reviewId: string; actor?: string;
  edits?: { linePrices?: Array<{ serviceCode: string; invoiceCents: number }>; crewAssignments?: Array<{ serviceCode: string; crewId: string; crewName?: string }>; notes?: string };
  requeue?: boolean;
}) {
  const review = await getReview(opts.reviewId);
  if (!review) return { ok: false as const, error: "Review not found" };
  if (review.status === "sent_to_invoice") {
    const re = await reopenForCorrection({ reviewId: opts.reviewId, reason: "Correction before re-apply", actor: opts.actor || "office", toStatus: "margin_ready" });
    if (!re.ok) return re;
  }
  await db.update(workReviewsTable).set({
    status: "field_submitted",
    fieldEdits: { ...(typeof review.fieldEdits === "object" && review.fieldEdits ? review.fieldEdits : {}), ...opts.edits, confirmAccurate: true, correctedInInvoicingTab: true },
    fieldSubmittedAt: new Date(), fieldSubmittedBy: opts.actor || "office", updatedAt: new Date(),
  }).where(eq(workReviewsTable.id, opts.reviewId));
  const final = await botFinalizeReview(opts.reviewId);
  if (!final.ok) return { ok: false as const, error: final.error };
  if (opts.requeue !== false && final.decision === "margin_ready") {
    const done = await completeReviewToInvoice(opts.reviewId, opts.actor || "office");
    if (!done.ok) return { ok: false as const, error: done.error };
    await saveReportCard({
      reviewId: opts.reviewId, jobId: review.jobId, stage: "corrected_and_requeued",
      title: `Corrected in invoicing tab · ${review.jobId.slice(0, 8)}`,
      summary: opts.edits?.notes || "Prices/crew corrected and re-queued", actor: opts.actor || "office",
      marginReport: final.marginReport as any,
      card: { version: 1, stage: "corrected_and_requeued", jobId: review.jobId, reviewId: opts.reviewId, edits: opts.edits, marginReport: final.marginReport },
    }).catch(() => null);
    return { ok: true as const, status: "sent_to_invoice", marginReport: final.marginReport, notes: final.notes };
  }
  return { ok: true as const, status: final.decision, marginReport: final.marginReport, notes: final.notes };
}
