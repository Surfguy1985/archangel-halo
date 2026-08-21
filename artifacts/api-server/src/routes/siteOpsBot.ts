/**
 * Grok Site Ops Bot — manage entire on-site operations via API / chat.
 */
import { Router } from "express";
import {
  runSiteOpsCycle,
  getSiteOpsBotStatus,
  configureSiteOpsBot,
  startSiteOpsBot,
  stopSiteOpsBot,
  getSiteOpsHistory,
  siteOpsChat,
  ensureDefaultProperty,
} from "../lib/siteOpsBot";
import { logger } from "../lib/logger";

const router = Router();

router.get("/site-ops-bot/health", (_req, res) => {
  res.json({ ok: true, service: "site-ops-bot", version: 1, role: "Grok on-site ops manager" });
});

router.get("/site-ops-bot/status", (_req, res) => {
  res.json(getSiteOpsBotStatus());
});

router.get("/site-ops-bot/history", (req, res) => {
  const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 10));
  res.json({ ok: true, history: getSiteOpsHistory(limit) });
});

router.post("/site-ops-bot/config", (req, res) => {
  const propertyId = req.body?.propertyId !== undefined ? String(req.body.propertyId || "") || null : undefined;
  const intervalMs = req.body?.intervalMs != null ? Number(req.body.intervalMs) : undefined;
  const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;
  res.json(configureSiteOpsBot({ propertyId, intervalMs, enabled }));
});

router.post("/site-ops-bot/start", async (req, res) => {
  try {
    if (req.body?.propertyId) {
      configureSiteOpsBot({ propertyId: String(req.body.propertyId) });
    } else {
      await ensureDefaultProperty();
    }
    res.json(startSiteOpsBot());
  } catch (err: any) {
    logger.error({ err }, "site-ops-bot start failed");
    res.status(500).json({ error: err.message || "start failed" });
  }
});

router.post("/site-ops-bot/stop", (_req, res) => {
  res.json(stopSiteOpsBot());
});

router.post("/site-ops-bot/run", async (req, res) => {
  try {
    if (req.body?.propertyId) {
      configureSiteOpsBot({ propertyId: String(req.body.propertyId) });
    } else {
      await ensureDefaultProperty();
    }
    const dryRun = req.body?.dryRun === true;
    const brief = await runSiteOpsCycle({
      propertyId: req.body?.propertyId ? String(req.body.propertyId) : undefined,
      dryRun,
      operatorLimit: req.body?.limit ? Number(req.body.limit) : 80,
    });
    res.json({ ok: true, brief });
  } catch (err: any) {
    logger.error({ err }, "site-ops-bot run failed");
    res.status(500).json({ error: err.message || "run failed" });
  }
});

/** Natural language — Grok / Command / Base44 can POST a message. */
router.post("/site-ops-bot/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || req.body?.text || "");
    const propertyId = req.body?.propertyId ? String(req.body.propertyId) : undefined;
    if (propertyId) configureSiteOpsBot({ propertyId });
    else await ensureDefaultProperty();
    const result = await siteOpsChat(message, propertyId);
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "site-ops-bot chat failed");
    res.status(500).json({ error: err.message || "chat failed" });
  }
});

export default router;
