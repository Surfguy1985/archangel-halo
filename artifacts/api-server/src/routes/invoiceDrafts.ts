import { Router } from "express";
import { logger } from "../lib/logger";
import { isUuid } from "../lib/crewJobAccess";
import {
  runInvoiceDraftAutopilot,
  listInvoiceDrafts,
  getDraftSummary,
  approveDraft,
  approveAllGreen,
  buildInvoiceDraftForJob,
} from "../lib/invoiceDraftAutopilot";

export const invoiceDraftsRouter = Router();

invoiceDraftsRouter.get("/invoice-drafts/health", (_req, res) => {
  res.json({ ok: true, service: "invoice-drafts", version: 1 });
});

invoiceDraftsRouter.get("/invoice-drafts/summary", async (_req, res) => {
  try {
    return res.json(await getDraftSummary());
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

invoiceDraftsRouter.get("/invoice-drafts", async (req, res) => {
  try {
    const bucket = typeof req.query.bucket === "string" ? req.query.bucket : undefined;
    if (bucket && !["green", "yellow", "red"].includes(bucket)) {
      return res.status(400).json({ error: "bucket must be green|yellow|red" });
    }
    const drafts = await listInvoiceDrafts(bucket as any);
    return res.json({ drafts, count: (drafts as any[]).length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

invoiceDraftsRouter.post("/invoice-drafts/run", async (req, res) => {
  try {
    const limit = req.body?.limit ? Number(req.body.limit) : 50;
    const result = await runInvoiceDraftAutopilot({ limit });
    return res.json(result);
  } catch (err: any) {
    logger.error({ err }, "invoice draft autopilot failed");
    return res.status(500).json({ error: err.message });
  }
});

invoiceDraftsRouter.post("/invoice-drafts/approve-all-green", async (req, res) => {
  try {
    return res.json(await approveAllGreen(req.body?.actor || "office"));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

invoiceDraftsRouter.post("/invoice-drafts/:id/approve", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!isUuid(id)) return res.status(400).json({ error: "Invalid draft id" });
    const result = await approveDraft(id, req.body?.actor || "office");
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

invoiceDraftsRouter.get("/invoice-drafts/job/:jobId", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid job id" });
    const draft = await buildInvoiceDraftForJob(jobId);
    if (!draft) return res.status(404).json({ error: "Job not found" });
    return res.json({ draft });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default invoiceDraftsRouter;
