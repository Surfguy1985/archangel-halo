import { isUuid } from "../lib/crewJobAccess";
import { Router } from "express";
import { logger } from "../lib/logger";
import {
  scanDispatchForReview, openFieldReview, submitFieldReview, botFinalizeReview,
  completeReviewToInvoice, listReviews, getReview, getOpenFieldReviewForJob,
  runReviewAutopilot, buildMarginReport, listReportCards, getReportCard,
} from "../lib/workReviewPipeline";

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
