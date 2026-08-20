/**
 * Halo Operator — physically operates Dispatch via the same mutations the UI uses.
 *
 * Actions: move_job, lock_dispatch, send_to_invoice, flag_exception, apply_master_price, nudge_field
 * Policy: clean → lock on Dispatch; exceptions → flag only; Invoice only if AUTO_SEND_TO_INVOICE=true
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { db, jobsTable, workReviewsTable } from "@workspace/db";
import { logger } from "./logger";
import { buildWorkVerification } from "./workVerification";
import {
  buildMarginReport, openFieldReview, botFinalizeReview, completeReviewToInvoice, saveReportCard, listReviews,
} from "./workReviewPipeline";
import { runMoneyLock, classifyJobForMoneyLock } from "./moneyLock";
import { pushPricingAlertToBase44 } from "./base44Write";

export type OperatorActionType =
  | "move_job"
  | "lock_dispatch"
  | "send_to_invoice"
  | "flag_exception"
  | "apply_master_price"
  | "nudge_field"
  | "money_lock_pass";

export type OperatorActionResult = {
  ok: boolean;
  action: OperatorActionType;
  jobId?: string;
  reviewId?: string;
  detail: string;
  at: string;
};

const recentActions: OperatorActionResult[] = [];
let lastOperatorRunAt = 0;
let lastOperatorSummary: Record<string, unknown> = {};

function pushAction(a: OperatorActionResult) {
  recentActions.unshift(a);
  if (recentActions.length > 100) recentActions.length = 100;
}

export function getOperatorStatus() {
  return {
    ok: true,
    service: "halo-operator",
    lastRunAt: lastOperatorRunAt ? new Date(lastOperatorRunAt).toISOString() : null,
    lastSummary: lastOperatorSummary,
    recentActions: recentActions.slice(0, 25),
    policy: {
      autoLockDispatch: true,
      autoSendToInvoice: process.env.AUTO_SEND_TO_INVOICE === "true",
      autoMoveToBilling: true,
      nudgeFieldOnException: true,
    },
  };
}

export function getRecentOperatorActions(limit = 25) {
  return recentActions.slice(0, limit);
}

/** Move job board column (same as dragging on Dispatch board). */
export async function actionMoveJob(jobId: string, boardStatus: string, actor = "halo_operator") {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) {
    const r = { ok: false, action: "move_job" as const, jobId, detail: "Job not found", at: new Date().toISOString() };
    pushAction(r);
    return r;
  }
  const prev = job.boardStatus;
  await db.update(jobsTable).set({ boardStatus }).where(eq(jobsTable.id, jobId));
  await saveReportCard({
    jobId, jobNo: job.jobNo, unitNo: job.unitNo, stage: "operator_move_job",
    title: `Operator moved · ${job.jobNo || jobId.slice(0, 8)}`,
    summary: `${prev || "?"} → ${boardStatus}`,
    actor,
    card: { version: 1, action: "move_job", jobId, from: prev, to: boardStatus, actor },
  }).catch(() => null);
  const r = { ok: true, action: "move_job" as const, jobId, detail: `${prev} → ${boardStatus}`, at: new Date().toISOString() };
  pushAction(r);
  return r;
}

/** Lock clean job on Dispatch (margin_ready) — does NOT invoice. */
export async function actionLockDispatch(jobId: string, actor = "halo_operator") {
  const opened = await openFieldReview(jobId, "operator_lock");
  await db.update(workReviewsTable).set({
    status: "field_submitted",
    fieldEdits: { confirmAccurate: true, operatorAuto: true },
    fieldSubmittedAt: new Date(),
    fieldSubmittedBy: actor,
    updatedAt: new Date(),
  }).where(eq(workReviewsTable.id, opened.reviewId));

  const final = await botFinalizeReview(opened.reviewId);
  if (!final.ok || final.decision !== "margin_ready") {
    const r = {
      ok: false, action: "lock_dispatch" as const, jobId, reviewId: opened.reviewId,
      detail: final.ok ? final.notes : (final as any).error || "finalize held",
      at: new Date().toISOString(),
    };
    pushAction(r);
    return r;
  }

  try {
    await db.update(jobsTable).set({ boardStatus: "billing" }).where(eq(jobsTable.id, jobId));
  } catch { /* */ }

  await saveReportCard({
    reviewId: opened.reviewId, jobId, stage: "operator_lock_dispatch",
    title: `Operator locked Dispatch · ${jobId.slice(0, 8)}`,
    summary: "Margin locked on Dispatch. Invoice not sent.",
    actor, marginReport: final.marginReport as any,
    card: { version: 1, action: "lock_dispatch", jobId, reviewId: opened.reviewId, marginReport: final.marginReport, actor },
  }).catch(() => null);

  const r = {
    ok: true, action: "lock_dispatch" as const, jobId, reviewId: opened.reviewId,
    detail: "margin_ready on Dispatch", at: new Date().toISOString(),
  };
  pushAction(r);
  return r;
}

/** Explicit handoff Dispatch → Invoice (policy-gated in run loop). */
export async function actionSendToInvoice(reviewId: string, actor = "halo_operator") {
  const done = await completeReviewToInvoice(reviewId, actor);
  const r = {
    ok: done.ok,
    action: "send_to_invoice" as const,
    reviewId,
    jobId: done.ok ? done.jobId : undefined,
    detail: done.ok ? "sent_to_invoice" : (done as any).error || "failed",
    at: new Date().toISOString(),
  };
  pushAction(r);
  if (done.ok) {
    await saveReportCard({
      reviewId, jobId: done.jobId, stage: "operator_send_to_invoice",
      title: `Operator sent to invoice · ${done.jobId.slice(0, 8)}`,
      summary: "Explicit operator handoff Dispatch → Invoice",
      actor, marginReport: done.marginReport as any,
      card: { version: 1, action: "send_to_invoice", reviewId, jobId: done.jobId, actor },
    }).catch(() => null);
  }
  return r;
}

/** Flag exception on Dispatch triage. */
export async function actionFlagException(jobId: string, reason: string, actor = "halo_operator") {
  const opened = await openFieldReview(jobId, "operator_flag");
  await db.update(workReviewsTable).set({
    status: "needs_fix",
    botNotes: `Operator flag: ${reason}`,
    updatedAt: new Date(),
  }).where(eq(workReviewsTable.id, opened.reviewId));

  await saveReportCard({
    reviewId: opened.reviewId, jobId, stage: "operator_flag_exception",
    title: `Operator exception · ${jobId.slice(0, 8)}`,
    summary: reason, actor,
    card: { version: 1, action: "flag_exception", jobId, reviewId: opened.reviewId, reason, actor },
  }).catch(() => null);

  const r = {
    ok: true, action: "flag_exception" as const, jobId, reviewId: opened.reviewId,
    detail: reason, at: new Date().toISOString(),
  };
  pushAction(r);
  return r;
}

/** Apply master list prices onto verification lines via field edits + finalize. */
export async function actionApplyMasterPrice(jobId: string, actor = "halo_operator") {
  const verification = await buildWorkVerification(jobId);
  if (!verification) {
    const r = { ok: false, action: "apply_master_price" as const, jobId, detail: "Job not found", at: new Date().toISOString() };
    pushAction(r);
    return r;
  }
  const linePrices = (verification.lines || [])
    .filter((l) => l.expectedInvoiceCents != null && l.expectedInvoiceCents > 0)
    .map((l) => ({ serviceCode: l.serviceCode, invoiceCents: l.expectedInvoiceCents as number }));

  if (linePrices.length === 0) {
    const r = { ok: false, action: "apply_master_price" as const, jobId, detail: "No master prices to apply", at: new Date().toISOString() };
    pushAction(r);
    return r;
  }

  const opened = await openFieldReview(jobId, "operator_master_price");
  await db.update(workReviewsTable).set({
    status: "field_submitted",
    fieldEdits: { confirmAccurate: true, linePrices, operatorMasterPrice: true },
    fieldSubmittedAt: new Date(),
    fieldSubmittedBy: actor,
    updatedAt: new Date(),
  }).where(eq(workReviewsTable.id, opened.reviewId));

  const final = await botFinalizeReview(opened.reviewId);
  const r = {
    ok: final.ok,
    action: "apply_master_price" as const,
    jobId,
    reviewId: opened.reviewId,
    detail: final.ok ? `Applied ${linePrices.length} master line(s) → ${final.decision}` : (final as any).error || "failed",
    at: new Date().toISOString(),
  };
  pushAction(r);
  await saveReportCard({
    reviewId: opened.reviewId, jobId, stage: "operator_apply_master_price",
    title: `Operator applied master prices · ${jobId.slice(0, 8)}`,
    summary: r.detail, actor, marginReport: final.ok ? (final.marginReport as any) : null,
    card: { version: 1, action: "apply_master_price", jobId, linePrices, result: final.ok ? final.decision : "error", actor },
  }).catch(() => null);
  return r;
}

/** Re-push field accuracy card to Base44. */
export async function actionNudgeField(jobId: string) {
  const verification = await buildWorkVerification(jobId);
  if (!verification) {
    const r = { ok: false, action: "nudge_field" as const, jobId, detail: "Job not found", at: new Date().toISOString() };
    pushAction(r);
    return r;
  }
  const opened = await openFieldReview(jobId, "operator_nudge");
  const push = await pushPricingAlertToBase44({
    jobId,
    jobNo: verification.jobNo,
    unitNo: verification.unitNo,
    verification: { ...verification, reviewId: opened.reviewId, requiresFieldAck: true } as any,
  }).catch((e) => ({ ok: false, error: String(e) }));

  const r = {
    ok: !!(push as any).ok,
    action: "nudge_field" as const,
    jobId,
    reviewId: opened.reviewId,
    detail: (push as any).ok ? "pricing_alert pushed to Base44" : (push as any).error || "push failed",
    at: new Date().toISOString(),
  };
  pushAction(r);
  return r;
}

/**
 * One full operator cycle:
 * 1) Money Lock pass (classify)
 * 2) Act on clean / exception / margin_ready per policy
 */
export async function runHaloOperator(opts?: { limit?: number; dryRun?: boolean }) {
  const limit = opts?.limit ?? 40;
  const dryRun = !!opts?.dryRun;
  const autoInvoice = process.env.AUTO_SEND_TO_INVOICE === "true";
  const actions: OperatorActionResult[] = [];

  // 1) Money Lock classification pass
  const lock = await runMoneyLock({ limit, dryRun });
  actions.push({
    ok: true,
    action: "money_lock_pass",
    detail: `scanned=${lock.scanned} auto=${lock.autoApproved} ex=${lock.exceptions} blocked=${lock.blocked} dryRun=${dryRun}`,
    at: new Date().toISOString(),
  });
  pushAction(actions[0]);

  if (!dryRun) {
    // 2) Exceptions → nudge field (Base44 card) for top N
    const exceptions = lock.items.filter((i) => i.bucket === "exception").slice(0, 10);
    for (const item of exceptions) {
      if (item.invoiceTotalCents === 0) {
        // Try master price apply first when lines exist with expected $
        const applied = await actionApplyMasterPrice(item.jobId);
        actions.push(applied);
        if (!applied.ok) {
          actions.push(await actionFlagException(item.jobId, item.reason));
          actions.push(await actionNudgeField(item.jobId));
        }
      } else {
        actions.push(await actionFlagException(item.jobId, item.reason));
        actions.push(await actionNudgeField(item.jobId));
      }
    }

    // 3) Optional: margin_ready → send to invoice if policy on
    if (autoInvoice) {
      const ready = await listReviews("margin_ready");
      for (const rev of ready.slice(0, 15)) {
        actions.push(await actionSendToInvoice(rev.id, "halo_operator_policy"));
      }
    }
  }

  const summary = {
    dryRun,
    moneyLock: {
      scanned: lock.scanned,
      autoApproved: lock.autoApproved,
      exceptions: lock.exceptions,
      blocked: lock.blocked,
    },
    actionsRun: actions.length,
    autoSendToInvoice: autoInvoice,
    at: new Date().toISOString(),
  };

  lastOperatorRunAt = Date.now();
  lastOperatorSummary = summary;
  logger.info(summary, "Halo Operator cycle complete");
  return { ok: true as const, summary, actions: actions.slice(0, 50), moneyLock: lock };
}

/** Manual single action from API */
export async function executeOperatorAction(input: {
  action: OperatorActionType;
  jobId?: string;
  reviewId?: string;
  boardStatus?: string;
}) {
  switch (input.action) {
    case "move_job":
      if (!input.jobId || !input.boardStatus) return { ok: false, error: "jobId and boardStatus required" };
      return actionMoveJob(input.jobId, input.boardStatus);
    case "lock_dispatch":
      if (!input.jobId) return { ok: false, error: "jobId required" };
      return actionLockDispatch(input.jobId);
    case "send_to_invoice":
      if (!input.reviewId) return { ok: false, error: "reviewId required" };
      return actionSendToInvoice(input.reviewId);
    case "flag_exception":
      if (!input.jobId) return { ok: false, error: "jobId required" };
      return actionFlagException(input.jobId, "Manual operator flag");
    case "apply_master_price":
      if (!input.jobId) return { ok: false, error: "jobId required" };
      return actionApplyMasterPrice(input.jobId);
    case "nudge_field":
      if (!input.jobId) return { ok: false, error: "jobId required" };
      return actionNudgeField(input.jobId);
    case "money_lock_pass":
      return runHaloOperator({ dryRun: false });
    default:
      return { ok: false, error: `Unknown action: ${input.action}` };
  }
}
