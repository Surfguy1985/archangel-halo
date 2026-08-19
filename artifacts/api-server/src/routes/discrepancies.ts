import { Router, type Request, type Response } from "express";
import { desc, inArray } from "drizzle-orm";
import { db, discrepanciesTable } from "@workspace/db";
import { resolveDiscrepancy } from "../lib/financialReconciliation";
import { logger } from "../lib/logger";
export const discrepanciesRouter = Router();
discrepanciesRouter.get("/discrepancies/open", async (_req, res) => {
  try {
    const rows = await db.select().from(discrepanciesTable).where(inArray(discrepanciesTable.status, ["open", "pending_review"])).orderBy(desc(discrepanciesTable.createdAt)).limit(50);
    rows.sort((a, b) => ({ critical: 0, high: 1 }[a.severity as string] ?? 2) - ({ critical: 0, high: 1 }[b.severity as string] ?? 2));
    return res.json({ discrepancies: rows });
  } catch (err) { logger.error({ err }, "GET discrepancies failed"); return res.status(500).json({ error: "Internal error" }); }
});
discrepanciesRouter.post("/discrepancies/:id/resolve", async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const mode = body.status === "dismissed" ? "dismiss" : body.status === "pending_review" ? "pending" : "apply";
    if (mode !== "pending" && !String(body.adminReason || body.reason || "").trim()) return res.status(400).json({ error: "Reason is required" });
    const result = await resolveDiscrepancy({
      discrepancyId: String(req.params.id),
      newInvoiceCents: body.adminOverrideCents != null ? Number(body.adminOverrideCents) : null,
      newPayoutCents: body.crewOverrideCents != null ? Number(body.crewOverrideCents) : null,
      reason: body.adminReason || body.reason || "",
      // Actor is server-side only — a body-supplied userId would be an
      // unauthenticated caller naming themselves on a money change.
      resolvedBy: "office", mode,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    return res.json({ success: true });
  } catch (err: any) { logger.error({ err }, "resolve failed"); return res.status(500).json({ error: err.message || "Internal error" }); }
});
export default discrepanciesRouter;
