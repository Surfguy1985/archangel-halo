/**
 * estimate.from_evidence — draft lines from text or a completed walk. Not an invoice.
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  walkCapturesTable,
  walksTable,
  propertiesTable,
  haloEstimateDraftsTable,
} from "@workspace/db";
import { loadCatalogCandidates } from "../lib/catalogLookup";
import {
  draftEstimateFromLines,
  estimateHeadline,
  heuristicExtractLines,
  linesFromWalkCaptures,
} from "../lib/estimateFromEvidenceCore";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/estimates/from-evidence", async (req, res): Promise<void> => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 40_000) : "";
    const propertyId = typeof req.body?.propertyId === "string" ? req.body.propertyId : null;
    const walkId = typeof req.body?.walkId === "string" ? req.body.walkId : null;

    let source = "text";
    let lines = heuristicExtractLines(text);
    let resolvedPropertyId = propertyId;

    if (walkId) {
      const [walk] = await db.select().from(walksTable).where(eq(walksTable.id, walkId));
      if (!walk) {
        res.status(404).json({ error: "Walk not found" });
        return;
      }
      resolvedPropertyId = walk.propertyId;
      const captures = await db
        .select({
          service: walkCapturesTable.service,
          qty: walkCapturesTable.qty,
          unitPrice: walkCapturesTable.unitPrice,
          note: walkCapturesTable.note,
        })
        .from(walkCapturesTable)
        .where(eq(walkCapturesTable.walkId, walkId));
      const fromWalk = linesFromWalkCaptures(captures);
      lines = text.trim() ? [...lines, ...fromWalk] : fromWalk;
      source = text.trim() ? "text+walk" : "walk";
    }

    const catalog = await loadCatalogCandidates(resolvedPropertyId);
    const draft = draftEstimateFromLines(lines, catalog);
    const headline = estimateHeadline(draft);

    const [saved] = await db
      .insert(haloEstimateDraftsTable)
      .values({
        propertyId: resolvedPropertyId,
        walkId,
        source,
        headline,
        lines: draft,
      })
      .returning({ id: haloEstimateDraftsTable.id });

    let propertyName: string | null = null;
    if (resolvedPropertyId) {
      const [prop] = await db
        .select({ name: propertiesTable.name })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, resolvedPropertyId));
      propertyName = prop?.name ?? null;
    }

    res.json({
      ok: true,
      capability: "estimate.from_evidence",
      invoice: false,
      draftId: saved!.id,
      headline,
      propertyName,
      lines: draft,
    });
  } catch (err) {
    logger.error({ err }, "estimate.from_evidence failed");
    res.status(500).json({ error: "Estimate draft failed" });
  }
});

export default router;
