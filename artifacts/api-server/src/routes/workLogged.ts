import { Router, type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { pushPricingAlertToBase44 } from "../lib/base44Write";

export const workLoggedRouter = Router();

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

workLoggedRouter.post("/internal/work-logged", requireToken, async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const jobId = body.jobId || body.job_id || body.id || body.haloJobId || null;
    const jobNo = body.jobNo || body.job_no || null;
    const unitNo = body.unitNo || body.unit_number || body.unit || null;
    const propertyName = body.propertyName || body.property || null;
    logger.info({ jobId, source: "base44" }, "work-logged received");

    let found = 0;
    let cards: any[] = [];
    let base44Push: { ok: boolean; error: string | null } = { ok: true, error: null };

    if (jobId) {
      try {
        const { reconcileJobAndCards } = await import("../lib/financialReconciliation");
        const result = await reconcileJobAndCards(String(jobId));
        found = result.found;
        cards = result.cards;
        logger.info({ jobId, found, cardCount: cards.length }, "recon after work-logged");
        base44Push = await pushPricingAlertToBase44({
          jobId: String(jobId), jobNo, unitNo, propertyName,
          discrepancies: cards.map((c) => ({
            id: c.id, type: c.type, severity: c.severity, status: c.status, explanation: c.explanation,
            serviceCode: c.serviceCode, expectedCents: c.expectedCents, actualCents: c.actualCents, varianceCents: c.varianceCents,
          })),
        });
      } catch (e) {
        logger.error({ e, jobId }, "recon failed");
      }
    }

    return res.json({
      ok: true, received: true, jobId, discrepanciesFound: found,
      cards: cards.map((c) => ({
        id: c.id, type: c.type, severity: c.severity, status: c.status, explanation: c.explanation,
        serviceCode: c.serviceCode, expectedCents: c.expectedCents, actualCents: c.actualCents, varianceCents: c.varianceCents,
        title: c.type === "missing_invoice" ? "Missing invoice" : c.type === "zero_or_missing" ? "Price required ($0)" : c.type === "bid_needs_price" ? "Bid needs a price" : "Price variance",
      })),
      base44Push,
      punchlistUrl: `${process.env.PUBLIC_APP_URL || "https://archangel-halo.replit.app"}/punchlist`,
    });
  } catch (err) {
    logger.error({ err }, "work-logged failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default workLoggedRouter;
