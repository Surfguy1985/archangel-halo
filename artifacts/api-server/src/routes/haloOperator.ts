import { Router } from "express";
import { logger } from "../lib/logger";
import { isUuid } from "../lib/crewJobAccess";
import {
  runHaloOperator,
  getOperatorStatus,
  getRecentOperatorActions,
  executeOperatorAction,
  actionMoveJob,
  actionLockDispatch,
  actionSendToInvoice,
  actionFlagException,
  actionApplyMasterPrice,
  actionNudgeField,
} from "../lib/haloOperator";

export const haloOperatorRouter = Router();

haloOperatorRouter.get("/halo-operator/health", (_req, res) => {
  res.json({ ok: true, service: "halo-operator", version: 1 });
});

haloOperatorRouter.get("/halo-operator/status", (_req, res) => {
  res.json(getOperatorStatus());
});

haloOperatorRouter.get("/halo-operator/actions", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 25;
  res.json({ actions: getRecentOperatorActions(limit) });
});

haloOperatorRouter.post("/halo-operator/run", async (req, res) => {
  try {
    const dryRun = !!(req.body?.dryRun);
    const limit = req.body?.limit ? Number(req.body.limit) : 40;
    const result = await runHaloOperator({ dryRun, limit });
    return res.json(result);
  } catch (err: any) {
    logger.error({ err }, "halo-operator run failed");
    return res.status(500).json({ error: err.message });
  }
});

haloOperatorRouter.post("/halo-operator/action", async (req, res) => {
  try {
    const action = String(req.body?.action || "");
    const jobId = req.body?.jobId ? String(req.body.jobId) : undefined;
    const reviewId = req.body?.reviewId ? String(req.body.reviewId) : undefined;
    if (jobId && !isUuid(jobId)) return res.status(400).json({ error: "Invalid jobId" });
    if (reviewId && !isUuid(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });
    const result = await executeOperatorAction({
      action: action as any,
      jobId,
      reviewId,
      boardStatus: req.body?.boardStatus ? String(req.body.boardStatus) : undefined,
    });
    if ((result as any).ok === false && (result as any).error) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err: any) {
    logger.error({ err }, "halo-operator action failed");
    return res.status(500).json({ error: err.message });
  }
});

// Convenience verbs
haloOperatorRouter.post("/halo-operator/move-job", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    const boardStatus = String(req.body?.boardStatus || "");
    if (!isUuid(jobId) || !boardStatus) return res.status(400).json({ error: "jobId + boardStatus required" });
    return res.json(await actionMoveJob(jobId, boardStatus));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

haloOperatorRouter.post("/halo-operator/lock-dispatch", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid jobId" });
    return res.json(await actionLockDispatch(jobId));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

haloOperatorRouter.post("/halo-operator/send-to-invoice", async (req, res) => {
  try {
    const reviewId = String(req.body?.reviewId || "");
    if (!isUuid(reviewId)) return res.status(400).json({ error: "Invalid reviewId" });
    return res.json(await actionSendToInvoice(reviewId));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

haloOperatorRouter.post("/halo-operator/flag-exception", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid jobId" });
    return res.json(await actionFlagException(jobId, String(req.body?.reason || "Operator flag")));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

haloOperatorRouter.post("/halo-operator/apply-master-price", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid jobId" });
    return res.json(await actionApplyMasterPrice(jobId));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

haloOperatorRouter.post("/halo-operator/nudge-field", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!isUuid(jobId)) return res.status(400).json({ error: "Invalid jobId" });
    return res.json(await actionNudgeField(jobId));
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default haloOperatorRouter;
