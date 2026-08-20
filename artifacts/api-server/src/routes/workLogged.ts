import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
export const workLoggedRouter = Router();
/**
 * Fails CLOSED. This endpoint is mounted on the public deployment, so an
 * unset token must mean "nobody can call it", never "everybody can call it" —
 * otherwise any anonymous caller can drive reconciliation against arbitrary
 * job ids. Set WORK_RECONCILIATION_TOKEN to enable the Base44 webhook.
 */
function requireToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.WORK_RECONCILIATION_TOKEN?.trim();
  if (!expected) {
    logger.warn("work-logged called but WORK_RECONCILIATION_TOKEN is not set — refusing");
    res.status(503).json({ error: "Endpoint not configured" });
    return;
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
// NOTE: this router is mounted under /api, so the public webhook URL is
// <origin>/api/internal/work-logged. Only /api/* is proxied to this server —
// a bare /internal/... URL hits the web app and returns its HTML shell.
// LIVE Base44 URL (must include /api — only /api/* proxies to this server):
//   https://archangel-halo.replit.app/api/internal/work-logged
workLoggedRouter.post("/internal/work-logged", requireToken, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const jobId = body.jobId || body.job_id || body.id || body.haloJobId || null;
    logger.info({ jobId, source: "base44" }, "work-logged received");
    if (jobId) {
      try {
        const { runReconciliationForJob } = await import("../lib/financialReconciliation");
        const found = await runReconciliationForJob(jobId);
        logger.info({ jobId, found }, "recon after work-logged");
      } catch (e) { logger.error({ e, jobId }, "recon failed"); }
    }
    return res.json({ ok: true, received: true, jobId });
  } catch (err) {
    logger.error({ err }, "work-logged failed");
    return res.status(500).json({ error: "Internal error" });
  }
});
export default workLoggedRouter;
