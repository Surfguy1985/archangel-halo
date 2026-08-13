/**
 * Falkon ops.eod_briefing — HALO snapshot of the day. Does not write Base44.
 */

import { Router, type IRouter } from "express";
import { latestEodBriefing, persistEodBriefing } from "../lib/eodBriefing";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/briefings/latest", async (_req, res): Promise<void> => {
  try {
    const row = await latestEodBriefing();
    if (!row) {
      res.status(404).json({ error: "No briefing yet" });
      return;
    }
    res.json({ ok: true, capability: "ops.eod_briefing", briefing: row });
  } catch (err) {
    logger.error({ err }, "briefings.latest failed");
    res.status(500).json({ error: "Failed to load briefing" });
  }
});

router.post("/briefings/run-now", async (_req, res): Promise<void> => {
  try {
    const saved = await persistEodBriefing();
    res.json({ ok: true, capability: "ops.eod_briefing", briefing: saved });
  } catch (err) {
    logger.error({ err }, "briefings.run-now failed");
    res.status(500).json({ error: "Failed to generate briefing" });
  }
});

export default router;
