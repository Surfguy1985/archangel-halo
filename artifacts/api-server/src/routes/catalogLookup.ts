/**
 * catalog.lookup — office-gated, read-only.
 */

import { Router, type IRouter } from "express";
import { matchCatalogTop } from "../lib/catalogMatchCore";
import { loadCatalogCandidates } from "../lib/catalogLookup";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/catalog/lookup", async (req, res): Promise<void> => {
  try {
    const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
    const propertyId = typeof req.body?.propertyId === "string" ? req.body.propertyId : null;
    if (!query || query.length > 400) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    const catalog = await loadCatalogCandidates(propertyId);
    const matches = matchCatalogTop(query, catalog);
    res.json({
      ok: true,
      capability: "catalog.lookup",
      writes: false,
      query,
      matches,
    });
  } catch (err) {
    logger.error({ err }, "catalog.lookup failed");
    res.status(500).json({ error: "Catalog lookup failed" });
  }
});

export default router;
