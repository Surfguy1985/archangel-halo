import path from "path";
import { fileURLToPath } from "url";
/**
 * Building-first site ops — no per-unit photo mapping.
 */
import { Router } from "express";
import { db, crewCheckinsTable } from "@workspace/db";
import { buildBuildingPins } from "../lib/buildingSiteOps";
import { getBuildingOpsPlate, qrForProperty } from "../lib/getBuildingOpsPlate";
import { wantsTwinDemo } from "../lib/twinCrewPresence";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


/** Live ops board (Leaflet) — money tint, radar, crew, shared selection. */
router.get("/building-ops-board", (_req, res) => {
  const fs = require("fs");
  const path = require("path");
  const candidates = [
    path.join(process.cwd(), "artifacts/api-server/public/building-ops.html"),
    path.join(process.cwd(), "public/building-ops.html"),
    path.join(__dirname, "../../public/building-ops.html"),
    path.join(__dirname, "../public/building-ops.html"),
  ];
  for (const f of candidates) {
    if (fs.existsSync(f)) {
      res.type("html").send(fs.readFileSync(f, "utf8"));
      return;
    }
  }
  res.status(404).send("building-ops.html missing");
});

router.get("/building-ops/health", (_req, res) => {
  res.json({ ok: true, service: "building-ops", version: 2 });
});

router.get("/properties/:id/building-ops", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  try {
    const plate = await getBuildingOpsPlate(id, { demo: wantsTwinDemo(req.query) });
    if (!plate) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    res.json(plate);
  } catch (err: any) {
    logger.error({ err }, "building-ops failed");
    res.status(500).json({ error: err.message || "building-ops failed" });
  }
});

/** SSE live stream — pushes plate every N seconds for Unity / web twin. */
router.get("/properties/:id/building-ops/stream", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const intervalMs = Math.min(15000, Math.max(2000, Number(req.query.ms) || 4000));
  const demo = wantsTwinDemo(req.query);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const tick = async () => {
    if (closed) return;
    try {
      const plate = await getBuildingOpsPlate(id, { demo: wantsTwinDemo(req.query) });
      res.write(`data: ${JSON.stringify(plate || { ok: false })}\n\n`);
    } catch (err: any) {
      res.write(`data: ${JSON.stringify({ ok: false, error: err.message })}\n\n`);
    }
  };
  await tick();
  const timer = setInterval(tick, intervalMs);
  req.on("close", () => clearInterval(timer));
});

router.get("/properties/:id/building-ops/qr", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  res.json(qrForProperty(id));
});

router.post("/properties/:id/building-ops/checkin", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const crewId = String(req.body?.crewId ?? "");
  const building = Number(req.body?.building ?? req.query.building);
  if (!UUID_RE.test(crewId) || !Number.isFinite(building) || building < 1 || building > 20) {
    res.status(400).json({ error: "crewId and building (1–20) required" });
    return;
  }
  const pins = buildBuildingPins();
  const pin = pins.find((b) => b.building === building);
  if (!pin) {
    res.status(404).json({ error: "Unknown building" });
    return;
  }
  const lat = typeof req.body?.lat === "number" ? req.body.lat : pin.lat;
  const lng = typeof req.body?.lng === "number" ? req.body.lng : pin.lng;

  await db.insert(crewCheckinsTable).values({
    crewId,
    kind: "building_qr",
    lat,
    lng,
    label: `Building ${building}`,
    note: `QR/NFC check-in Building ${building}`,
  });

  res.json({
    ok: true,
    building,
    label: pin.label,
    lat,
    lng,
    message: `Checked in at Building ${building}`,
  });
});

export default router;
