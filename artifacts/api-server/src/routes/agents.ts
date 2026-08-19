import { Router } from "express";
import { getLatestSuggestions, runContinuousAgents, getAgentsMeta } from "../lib/haloCommandAgents";
import { logger } from "../lib/logger";
export const agentsRouter = Router();
agentsRouter.get("/api/command/suggestions", async (_req, res) => {
  try { return res.json({ suggestions: getLatestSuggestions(), meta: getAgentsMeta() }); }
  catch (err) { logger.error({ err }, "GET suggestions failed"); return res.status(500).json({ error: "Internal error" }); }
});
agentsRouter.post("/api/command/agents/run", async (_req, res) => {
  try { const suggestions = await runContinuousAgents("manual"); return res.json({ ok: true, suggestions, meta: getAgentsMeta() }); }
  catch (err: any) { return res.status(500).json({ error: err.message || "Internal error" }); }
});
export default agentsRouter;
