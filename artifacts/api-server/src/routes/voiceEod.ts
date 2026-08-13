/**
 * field.voice_eod — office-initiated outbound Vapi. Falkon-gated. No auto-dial cron.
 */

import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, crewsTable, haloVoiceEodCallsTable } from "@workspace/db";
import { placeVoiceEodCall } from "../lib/voiceEod";
import { vapiOutboundConfig, voiceEodBatchAllowed } from "../lib/voiceEodCore";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/voice-eod/call", async (req, res): Promise<void> => {
  const cfg = vapiOutboundConfig(process.env);
  if (!cfg.ok) {
    res.status(503).json({ error: cfg.error });
    return;
  }
  const crewId = typeof req.body?.crewId === "string" ? req.body.crewId : "";
  if (!crewId) {
    res.status(400).json({ error: "crewId is required" });
    return;
  }
  const [crew] = await db
    .select({ id: crewsTable.id, name: crewsTable.name, phone: crewsTable.phone })
    .from(crewsTable)
    .where(eq(crewsTable.id, crewId));
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const result = await placeVoiceEodCall({
    crewId: crew.id,
    crewName: crew.name,
    phone: crew.phone ?? "",
  });
  if (!result.ok) {
    res.status(result.status).json({ ok: false, error: result.error });
    return;
  }
  res.json({ ok: true, capability: "field.voice_eod", callId: result.callId, vapiCallId: result.vapiCallId });
});

router.post("/voice-eod/batch", async (req, res): Promise<void> => {
  const cfg = vapiOutboundConfig(process.env);
  if (!cfg.ok) {
    res.status(503).json({ error: cfg.error });
    return;
  }
  const rawIds = Array.isArray(req.body?.crewIds) ? req.body.crewIds : [];
  const crewIds = rawIds.filter((id: unknown): id is string => typeof id === "string");
  if (!voiceEodBatchAllowed(crewIds.length)) {
    res.status(400).json({ error: "Provide 1–10 crewIds. Batches require Falkon approval." });
    return;
  }
  const crews = await db
    .select({ id: crewsTable.id, name: crewsTable.name, phone: crewsTable.phone })
    .from(crewsTable)
    .where(inArray(crewsTable.id, crewIds));
  const placed: string[] = [];
  const failures: { crewId: string; error: string }[] = [];
  for (const crew of crews) {
    const result = await placeVoiceEodCall({
      crewId: crew.id,
      crewName: crew.name,
      phone: crew.phone ?? "",
    });
    if (result.ok) placed.push(crew.id);
    else failures.push({ crewId: crew.id, error: result.error });
  }
  res.json({ ok: true, capability: "field.voice_eod", placed: placed.length, failures });
});

router.get("/voice-eod/recent", async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(haloVoiceEodCallsTable)
      .orderBy(desc(haloVoiceEodCallsTable.createdAt))
      .limit(50);
    res.json({ ok: true, calls: rows });
  } catch (err) {
    logger.error({ err }, "voice-eod.recent failed");
    res.status(500).json({ error: "Failed to list calls" });
  }
});

export default router;
