import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
export const workLoggedRouter = Router();
function requireToken(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.WORK_RECONCILIATION_TOKEN?.trim();
  if (!expected) return next();
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) return res.status(401).json({ error: "Unauthorized" });
  next();
}
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
