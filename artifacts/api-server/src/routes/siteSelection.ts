/**
 * Shared selection — MapKit, Unity, web twin stay in sync.
 *
 * GET  /api/properties/:id/selection
 * POST /api/properties/:id/selection   { building?, unitNo?, jobId?, crewId?, source? }
 * GET  /api/properties/:id/selection/stream  SSE
 *
 * Deep link format:
 *   halo://site/{propertyId}?building=12&unit=1224
 *   https://archangel-halo.replit.app/site-twin/{propertyId}?building=12
 */
import { Router } from "express";
import { getSelection, setSelection, subscribeSelection } from "../lib/siteSelection";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/properties/:id/selection", (req, res) => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property id" });
    return;
  }
  res.json({
    ok: true,
    selection: getSelection(id),
    deepLink: {
      app: `halo://site/${id}`,
      web: `/site-twin/${id}`,
    },
  });
});

router.post("/properties/:id/selection", (req, res) => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property id" });
    return;
  }
  const body = req.body || {};
  const building = body.building != null ? Number(body.building) : null;
  const selection = setSelection(id, {
    building: Number.isFinite(building) ? building : null,
    unitNo: body.unitNo ? String(body.unitNo) : null,
    jobId: body.jobId ? String(body.jobId) : null,
    crewId: body.crewId ? String(body.crewId) : null,
    source: body.source ? String(body.source) : "api",
  });
  res.json({ ok: true, selection });
});

router.get("/properties/:id/selection/stream", (req, res) => {
  const id = String(req.params.id || "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property id" });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (s: any) => {
    try {
      res.write(`data: ${JSON.stringify({ ok: true, selection: s })}\n\n`);
    } catch {
      /* */
    }
  };
  send(getSelection(id));
  const unsub = subscribeSelection(id, send);
  const ping = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      /* */
    }
  }, 15000);
  req.on("close", () => {
    unsub();
    clearInterval(ping);
  });
});

export default router;
