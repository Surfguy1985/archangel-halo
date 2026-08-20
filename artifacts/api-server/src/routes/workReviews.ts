import { isUuid } from "../lib/crewJobAccess";
import { Router } from "express";
import { logger } from "../lib/logger";
import {
  scanDispatchForReview, openFieldReview, submitFieldReview, botFinalizeReview,
  completeReviewToInvoice, listReviews, getReview, getOpenFieldReviewForJob,
  runReviewAutopilot, buildMarginReport, listReportCards, getReportCard,
} from "../lib/workReviewPipeline";
import {
  runMoneyLock, listMoneyLockExceptions, listInvoiceQueueForTab,
  reopenForCorrection, applyInvoiceCorrection, classifyJobForMoneyLock,
} from "../lib/moneyLock";

export const workReviewsRouter = Router();

// ── Static paths FIRST (never after /:id) ──────────────────────────────────

workReviewsRouter.get("/work-reviews/health", (_req, res) => {
  res.json({ ok: true, service: "work-reviews", version: 2 });
});

workReviewsRouter.post("/work-reviews/scan-dispatch", async (_req, res) => {
  try { return res.json({ ok: true, ...(await scanDispatchForReview(80)) }); }
  catch (err: any) { logger.error({ err }, "scan-dispatch"); return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.post("/work-reviews/autopilot", async (_req, res) => {
  try { return res.json({ ok: true, ...(await runReviewAutopilot()) }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.get("/work-reviews/history", async (req, res) => {
  try {
    const jobIdRaw = typeof req.query.jobId === "string" ? req.query.jobId : undefined;
    if (jobIdRaw && !isUuid(jobIdRaw)) return res.status(400).json({ error: "Invalid jobId query" });
    const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
    const cards = await listReportCards({ jobId: jobIdRaw, stage, limit: req.query.limit ? Number(req.query.limit) : 50 });
    return res.json({ reportCards: cards, count: cards.length });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.get("/work-reviews/history/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid report card id" });
    const card = await getReportCard(id);
    if (!card) return res.status(404).json({ error: "Report card not found" });
    return res.json({ reportCard: card });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.get("/work-reviews/invoice-queue", async (_req, res) => {
  try {
    return res.json({ queue: await listReviews("sent_to_invoice"), readyToComplete: await listReviews("margin_ready") });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.get("/work-reviews/job/:jobId/field-card", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid job id" });
    let review = await getOpenFieldReviewForJob(jobId);
    if (!review) { await openFieldReview(jobId, "field_pull"); review = await getOpenFieldReviewForJob(jobId); }
    return res.json({
      showModal: true,
      requiresFieldAck: review?.status !== "margin_ready",
      showMargin: review?.status === "margin_ready",
      review,
      verification: review?.verificationSnapshot || null,
      marginReport: review?.marginReport || null,
    });
  } catch (err: any) { logger.error({ err }, "field-card"); return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.post("/work-reviews/job/:jobId/open", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid job id" });
    return res.json({ ok: true, ...(await openFieldReview(jobId, String(req.body?.trigger || "manual"))), showModal: true });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.get("/work-reviews/job/:jobId/margin", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid job id" });
    return res.json({ marginReport: await buildMarginReport(jobId) });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.get("/work-reviews", async (req, res) => {
  try { return res.json({ reviews: await listReviews(typeof req.query.status === "string" ? req.query.status : undefined) }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});


// ── Money Lock
workReviewsRouter.post("/work-reviews/money-lock/run", async (req, res) => {
  try {
    const dryRun = !!(req.body?.dryRun);
    const limit = req.body?.limit ? Number(req.body.limit) : 80;
    return res.json(await runMoneyLock({ limit, dryRun }));
  } catch (err: any) {
    logger.error({ err }, "money-lock run failed");
    return res.status(500).json({ error: err.message });
  }
});
workReviewsRouter.get("/work-reviews/money-lock/exceptions", async (_req, res) => {
  try {
    const exceptions = await listMoneyLockExceptions();
    return res.json({ exceptions, count: exceptions.length });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/money-lock/summary", async (_req, res) => {
  try {
    const exceptions = await listMoneyLockExceptions();
    const queue = await listInvoiceQueueForTab();
    return res.json({
      exceptions: exceptions.length, invoiceQueue: queue.length,
      message: exceptions.length === 0 ? "All clear — no exceptions." : `${exceptions.length} need a look. Queue: ${queue.length}.`,
    });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/money-lock/classify/:jobId", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid job id" });
    return res.json({ item: await classifyJobForMoneyLock(jobId) });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.post("/work-reviews/:id/reopen-for-correction", async (req, res) => {
  try {
    const reviewId = String(req.params.id || "");
    if (!isUuid(reviewId)) return res.status(400).json({ error: "Invalid review id" });
    const result = await reopenForCorrection({ reviewId, reason: req.body?.reason, actor: req.body?.actor || "office", toStatus: req.body?.toStatus });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ...result, message: "Pulled back — fix then re-queue" });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.post("/work-reviews/:id/apply-correction", async (req, res) => {
  try {
    const reviewId = String(req.params.id || "");
    if (!isUuid(reviewId)) return res.status(400).json({ error: "Invalid review id" });
    const result = await applyInvoiceCorrection({ reviewId, actor: req.body?.actor || "office", edits: req.body?.edits, requeue: req.body?.requeue !== false });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ...result, message: result.status === "sent_to_invoice" ? "Corrected and re-queued" : "Correction applied" });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

// ── Param routes LAST ──────────────────────────────────────────────────────

workReviewsRouter.get("/work-reviews/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid review id (expected UUID)" });
    const row = await getReview(id);
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json({ review: row });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.post("/work-reviews/:id/field-submit", async (req, res) => {
  try {
    const reviewId = String(req.params.id || "");
    if (!isUuid(reviewId)) return res.status(400).json({ error: "Invalid review id" });
    const body = req.body || {};
    const result = await submitFieldReview({
      reviewId,
      submittedBy: body.submittedBy || "field",
      edits: body.edits || { confirmAccurate: true },
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({
      ok: true, next: result.decision, notes: result.notes, marginReport: result.marginReport,
      review: await getReview(result.reviewId), showMargin: result.decision === "margin_ready", historySaved: true,
      message: result.decision === "margin_ready" ? "Bot finished — review margin, then Complete." : result.notes,
    });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.post("/work-reviews/:id/bot-finalize", async (req, res) => {
  try {
    const reviewId = String(req.params.id || "");
    if (!isUuid(reviewId)) return res.status(400).json({ error: "Invalid review id" });
    const result = await botFinalizeReview(reviewId);
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, ...result, historySaved: true });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

workReviewsRouter.post("/work-reviews/:id/complete", async (req, res) => {
  try {
    const reviewId = String(req.params.id || "");
    if (!isUuid(reviewId)) return res.status(400).json({ error: "Invalid review id" });
    const result = await completeReviewToInvoice(reviewId, req.body?.actor || "office");
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, ...result, message: "Sent to invoicing — full report card saved to history", historySaved: true });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});

export default workReviewsRouter;
