/**
 * Vapi AI field verify + confirm calls → dispatch updates
 */
import { Router } from "express";
import {
  startFieldVerifyCall,
  startFieldConfirmCall,
  handleVapiWebhook,
  listFieldCalls,
  getFieldCall,
  getVapiConfigStatus,
  applyFieldCorrection,
} from "../lib/vapiFieldVerify";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/vapi/health", (_req, res) => {
  res.json(getVapiConfigStatus());
});

router.get("/vapi/calls", (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 25));
  res.json({ ok: true, calls: listFieldCalls(limit) });
});

router.get("/vapi/calls/:id", (req, res) => {
  const c = getFieldCall(String(req.params.id));
  if (!c) {
    res.status(404).json({ error: "Call not found" });
    return;
  }
  res.json({ ok: true, call: c });
});

/** Start AI verification call to field after field-app inputs. */
router.post("/vapi/verify-call", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!UUID_RE.test(jobId)) {
      res.status(400).json({ error: "jobId UUID required" });
      return;
    }
    const result = await startFieldVerifyCall({
      jobId,
      reviewId: req.body?.reviewId || null,
      phone: req.body?.phone || null,
      crewId: req.body?.crewId || null,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "vapi verify-call failed");
    res.status(500).json({ error: err.message || "verify-call failed" });
  }
});

/** Explicit confirmation call after corrections. */
router.post("/vapi/confirm-call", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!UUID_RE.test(jobId)) {
      res.status(400).json({ error: "jobId UUID required" });
      return;
    }
    const result = await startFieldConfirmCall({
      jobId,
      reviewId: req.body?.reviewId || null,
      phone: req.body?.phone || null,
      summary: req.body?.summary || undefined,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "vapi confirm-call failed");
    res.status(500).json({ error: err.message || "confirm-call failed" });
  }
});

/** Full pipeline: verify now; confirm auto-fires after corrections via webhook. */
router.post("/vapi/verify-and-confirm", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!UUID_RE.test(jobId)) {
      res.status(400).json({ error: "jobId UUID required" });
      return;
    }
    const verify = await startFieldVerifyCall({
      jobId,
      reviewId: req.body?.reviewId || null,
      phone: req.body?.phone || null,
      crewId: req.body?.crewId || null,
    });
    res.json({
      ok: verify.ok,
      verify,
      note: "If crew applies corrections on the verify call, a confirm call is placed automatically when the call ends",
    });
  } catch (err: any) {
    logger.error({ err }, "vapi verify-and-confirm failed");
    res.status(500).json({ error: err.message || "failed" });
  }
});

/** Manual correction (dashboard / tests) without a live call. */
router.post("/vapi/apply-correction", async (req, res) => {
  try {
    const jobId = String(req.body?.jobId || "");
    if (!UUID_RE.test(jobId)) {
      res.status(400).json({ error: "jobId required" });
      return;
    }
    const result = await applyFieldCorrection({
      jobId,
      reviewId: req.body?.reviewId || null,
      correction: req.body?.correction || {
        correctionType: req.body?.correctionType || "other",
        detail: req.body?.detail || "",
      },
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Vapi Server URL — set to https://YOUR_HOST/api/vapi/webhook
 * Handles tool-calls (corrections) + end-of-call (auto confirm).
 */
router.post("/vapi/webhook", async (req, res) => {
  try {
    const out = await handleVapiWebhook(req.body);
    res.json(out);
  } catch (err: any) {
    logger.error({ err }, "vapi webhook failed");
    res.status(500).json({ error: err.message || "webhook failed" });
  }
});

export default router;
