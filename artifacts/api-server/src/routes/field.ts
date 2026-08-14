/**
 * Field Presence / Earpiece / Morning Watch.
 * Transcribe uses the existing OpenAI Whisper path (same as Walk hold-to-talk).
 * No OpenAPI regen — clients fetch these like GPS / SMS.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, notInArray } from "drizzle-orm";
import { openai, toFile } from "@workspace/integrations-openai-ai-server";
import {
  db,
  propertiesTable,
  jobsTable,
  invoicesTable,
  autopilotActionsTable,
  crewsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { limits } from "../lib/rateLimit";
import { localYmd } from "../lib/jarvisOpsCore";
import {
  ackForIntent,
  buildMorningWatch,
  buildPresenceBrief,
  detectEarpieceIntent,
  type FieldCrewSnap,
  type FieldJobSnap,
} from "../lib/fieldOpsCore";
import { ensurePropertiesGeocoded } from "../lib/geocode";

const router: IRouter = Router();
const MATCH_M = 250;

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

router.post("/field/transcribe", limits.walkWrite, async (req, res): Promise<void> => {
  const audioBase64 = typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
  const mimeType = typeof req.body?.mimeType === "string" ? req.body.mimeType : "audio/webm";
  if (audioBase64.length > 8 * 1024 * 1024) {
    res.status(422).json({ error: "Clip too long" });
    return;
  }
  let audio: Buffer;
  try {
    audio = Buffer.from(audioBase64, "base64");
  } catch {
    res.status(422).json({ error: "Could not read audio" });
    return;
  }
  if (audio.length < 800) {
    res.json({ transcript: "", intent: detectEarpieceIntent(""), ack: null });
    return;
  }
  const ext = mimeType.includes("mp4") || mimeType.includes("m4a")
    ? "m4a"
    : mimeType.includes("mpeg") || mimeType.includes("mp3")
      ? "mp3"
      : mimeType.includes("ogg")
        ? "ogg"
        : mimeType.includes("wav")
          ? "wav"
          : "webm";
  let transcript = "";
  try {
    const result = await openai.audio.transcriptions.create({
      file: await toFile(audio, `earpiece.${ext}`, { type: mimeType }),
      model: "gpt-4o-mini-transcribe",
    });
    transcript = (result.text ?? "").trim();
  } catch (err) {
    logger.warn({ err }, "field.transcribe failed");
    res.status(422).json({ error: "Couldn't hear that" });
    return;
  }
  const intent = detectEarpieceIntent(transcript);
  res.json({ transcript, intent, ack: ackForIntent(intent.kind) });
});

router.get("/field/presence", async (req, res): Promise<void> => {
  const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : "";
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  void ensurePropertiesGeocoded().catch((err) => logger.warn({ err }, "field presence geocode"));

  const props = await db.select().from(propertiesTable).where(eq(propertiesTable.status, "active"));
  let best: { id: string; name: string; distance: number } | null = null;
  if (propertyId) {
    const p = props.find((row) => row.id === propertyId);
    if (p) best = { id: p.id, name: p.name, distance: 0 };
  } else if (Number.isFinite(lat) && Number.isFinite(lng)) {
    for (const p of props) {
      if (p.latitude == null || p.longitude == null) continue;
      const d = haversineMeters(lat, lng, p.latitude, p.longitude);
      if (d <= MATCH_M && (!best || d < best.distance)) best = { id: p.id, name: p.name, distance: d };
    }
  }

  if (!best) {
    res.json({
      match: false,
      spoken: "No HALO site within 250 meters. Pin GPS on Pulse, or say a property name.",
      prompt: null,
      nextLine: null,
    });
    return;
  }

  const liveJobs = await db
    .select({
      jobNo: jobsTable.jobNo,
      unitNo: jobsTable.unitNo,
      category: jobsTable.category,
      status: jobsTable.status,
      crewLeaderId: jobsTable.crewLeaderId,
      crewName: crewsTable.name,
    })
    .from(jobsTable)
    .leftJoin(crewsTable, eq(jobsTable.crewLeaderId, crewsTable.id))
    .where(
      and(
        eq(jobsTable.propertyId, best.id),
        notInArray(jobsTable.status, ["complete", "paid", "cancelled", "cleared"]),
      ),
    )
    .orderBy(desc(jobsTable.createdAt))
    .limit(8);

  const unpaid = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(
      and(
        eq(invoicesTable.propertyId, best.id),
        notInArray(invoicesTable.status, ["paid", "draft", "cancelled"]),
      ),
    )
    .limit(10);

  const jobs: FieldJobSnap[] = liveJobs.map((j) => ({
    jobNo: j.jobNo,
    unitNo: j.unitNo,
    category: j.category,
    crewLeaderName: j.crewName,
    status: j.status,
  }));
  const onSiteNames = [...new Set(jobs.map((j) => j.crewLeaderName).filter((n): n is string => !!n?.trim()))];
  const crews: FieldCrewSnap[] = onSiteNames.slice(0, 4).map((name) => ({ name, todayStatus: "site" }));
  const brief = buildPresenceBrief({
    propertyName: best.name,
    jobs,
    crewsOnSite: crews,
    overdueInvoices: unpaid.length,
  });
  res.json({
    match: true,
    propertyId: best.id,
    propertyName: best.name,
    distanceMeters: Math.round(best.distance),
    ...brief,
  });
});

router.get("/field/watch", async (_req, res): Promise<void> => {
  const now = new Date();
  const today = localYmd(now);
  const rows = await db
    .select()
    .from(autopilotActionsTable)
    .orderBy(desc(autopilotActionsTable.createdAt))
    .limit(40);
  const pending = rows.filter((r) => r.status === "pending").map((r) => r.title);
  const done = rows
    .filter((r) => r.status === "executed" || r.status === "done")
    .filter((r) => {
      const at = r.executedAt ?? r.createdAt;
      return at && localYmd(new Date(at)) === today;
    })
    .map((r) => r.title);
  const brief = buildMorningWatch({ hour: now.getHours(), pendingTitles: pending, doneTitles: done });
  res.json(brief ?? { spoken: null, prompt: null });
});

export default router;
