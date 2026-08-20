import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { pushPricingAlertToBase44 } from "../lib/base44Write";

export const workLoggedRouter = Router();

function requireToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.WORK_RECONCILIATION_TOKEN?.trim();
  if (!expected) { res.status(503).json({ error: "Endpoint not configured" }); return; }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) { res.status(401).json({ error: "Unauthorized" }); return; }
  next();
}

workLoggedRouter.post("/internal/work-logged", requireToken, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const jobId = body.jobId || body.job_id || body.id || body.haloJobId || null;
    const jobNo = body.jobNo || body.job_no || null;
    const unitNo = body.unitNo || body.unit_number || body.unit || null;
    const propertyName = body.propertyName || body.property || null;
    logger.info({ jobId, source: "base44" }, "work-logged received");

    let verification: any = null;
    let cards: any[] = [];
    let base44Push: { ok: boolean; error: string | null } = { ok: true, error: null };

    if (jobId) {
      try {
        const { verifyAfterLogWork } = await import("../lib/workVerification");
        const result = await verifyAfterLogWork(String(jobId));
        verification = result.verification;
        cards = result.cards || [];
        base44Push = await pushPricingAlertToBase44({
          jobId: String(jobId), jobNo: jobNo || verification?.jobNo, unitNo: unitNo || verification?.unitNo, propertyName,
          discrepancies: cards.map((c: any) => ({
            id: c.id, type: c.type, severity: c.severity, status: c.status, explanation: c.explanation,
            serviceCode: c.serviceCode, expectedCents: c.expectedCents, actualCents: c.actualCents, varianceCents: c.varianceCents,
          })),
          verification,
        });
      } catch (e) { logger.error({ e, jobId }, "verify after work-logged failed"); }
    }

    return res.json({
      ok: true, received: true, jobId, showModal: true, alwaysShow: true, verification,
      missingServices: verification?.missingServices || [],
      crewAssignmentIssues: verification?.crewAssignmentIssues || [],
      suggestions: verification?.suggestions || [],
      discrepanciesFound: cards.length, cards, base44Push,
      punchlistUrl: verification?.punchlistUrl || "https://archangel-halo.replit.app/punchlist",
    });
  } catch (err) {
    logger.error({ err }, "work-logged failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default workLoggedRouter;
