import { isUuid } from "../lib/crewJobAccess";
import { Router } from "express";
import { logger } from "../lib/logger";
import {
  scanDispatchForReview, openFieldReview, submitFieldReview, botFinalizeReview,
  completeReviewToInvoice, listReviews, getReview, getOpenFieldReviewForJob,
  runReviewAutopilot, buildMarginReport, listReportCards, getReportCard,
} from "../lib/workReviewPipeline";

export const workReviewsRouter = Router();

workReviewsRouter.get("/work-reviews/health", (_req, res) => {
  res.json({ ok: true, service: "work-reviews", version: 1 });
});

workReviewsRouter.post("/work-reviews/scan-dispatch", async (_req, res) => {
  try { return res.json({ ok: true, ...(await scanDispatchForReview(80)) }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.post("/work-reviews/autopilot", async (_req, res) => {
  try { return res.json({ ok: true, ...(await runReviewAutopilot()) }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/history", async (req, res) => {
  try {
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : undefined;
    const stage = typeof req.query.stage === "string" ? req.query.stage : undefined;
    const cards = await listReportCards({ jobId, stage, limit: req.query.limit ? Number(req.query.limit) : 50 });
    return res.json({ reportCards: cards, count: cards.length });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/history/:id", async (req, res) => {
  try {
    const card = await getReportCard(String(req.params.id));
    if (!card) return res.status(404).json({ error: "Report card not found" });
    return res.json({ reportCard: card });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews", async (req, res) => {
  try { return res.json({ reviews: await listReviews(typeof req.query.status === "string" ? req.query.status : undefined) }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/invoice-queue", async (_req, res) => {
  try {
    return res.json({ queue: await listReviews("sent_to_invoice"), readyToComplete: await listReviews("margin_ready") });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/:id", async (req, res) => {
  try {
    const row = await getReview(String(req.params.id));
    if (!row) return res.status(404).json({ error: "Not found" });
    return res.json({ review: row });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/job/:jobId/field-card", async (req, res) => {
  try {
    const jobId = String(req.params.jobId);
    let review = await getOpenFieldReviewForJob(jobId);
    if (!review) { await openFieldReview(jobId, "field_pull"); review = await getOpenFieldReviewForJob(jobId); }
    return res.json({
      showModal: true, requiresFieldAck: review?.status !== "margin_ready", showMargin: review?.status === "margin_ready",
      review, verification: review?.verificationSnapshot || null, marginReport: review?.marginReport || null,
    });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.post("/work-reviews/job/:jobId/open", async (req, res) => {
  try { return res.json({ ok: true, ...(await openFieldReview(String(req.params.jobId), String(req.body?.trigger || "manual"))), showModal: true }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.post("/work-reviews/:id/field-submit", async (req, res) => {
  try {
    const body = req.body || {};
    const result = await submitFieldReview({ reviewId: String(req.params.id), submittedBy: body.submittedBy || "field", edits: body.edits || { confirmAccurate: true } });
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
    const result = await botFinalizeReview(String(req.params.id));
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, ...result, historySaved: true });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.post("/work-reviews/:id/complete", async (req, res) => {
  try {
    const result = await completeReviewToInvoice(String(req.params.id), req.body?.actor || "office");
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ ok: true, ...result, message: "Sent to invoicing — full report card saved to history", historySaved: true });
  } catch (err: any) { return res.status(500).json({ error: err.message }); }
});
workReviewsRouter.get("/work-reviews/job/:jobId/margin", async (req, res) => {
  try { return res.json({ marginReport: await buildMarginReport(String(req.params.jobId)) }); }
  catch (err: any) { return res.status(500).json({ error: err.message }); }
});
export default workReviewsRouter;
