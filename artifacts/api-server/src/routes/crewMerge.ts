/**
 * Office crew de-duplication tools.
 *
 * GET  /crews/duplicates — near-duplicate report: fuzzy name pairs showing
 *   which row holds the phone and which row the jobs point at, plus crews
 *   with active jobs but no reachable phone.
 * POST /crews/merge { keepId, mergeId } — transactional merge: repoints
 *   jobs/schedules/invoices/etc. at the surviving row, preserves the phone,
 *   remaps the Base44 sync map, and records the losing name as an alias so
 *   the sync never re-creates the variant.
 */

import { Router, type IRouter } from "express";
import { findDuplicateCrews, mergeCrews } from "../lib/crewMerge";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/crews/duplicates", async (_req, res): Promise<void> => {
  try {
    const report = await findDuplicateCrews();
    res.json({ ok: true, ...report });
  } catch (err) {
    logger.warn({ err }, "crews/duplicates failed");
    res.status(500).json({ error: "Failed to build duplicate report" });
  }
});

router.post("/crews/merge", async (req, res): Promise<void> => {
  const keepId = typeof req.body?.keepId === "string" ? req.body.keepId : "";
  const mergeId = typeof req.body?.mergeId === "string" ? req.body.mergeId : "";
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(keepId) || !uuidRe.test(mergeId) || keepId === mergeId) {
    res.status(400).json({ error: "keepId and mergeId must be distinct crew UUIDs" });
    return;
  }
  try {
    const result = await mergeCrews(keepId, mergeId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "merge failed";
    if (msg.includes("not found")) {
      res.status(404).json({ error: msg });
      return;
    }
    logger.warn({ err, keepId, mergeId }, "crews/merge failed");
    res.status(500).json({ error: "Merge failed — no changes were applied" });
  }
});

export default router;
