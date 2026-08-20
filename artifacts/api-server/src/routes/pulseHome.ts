import { Router } from "express";
import { isUuid } from "../lib/crewJobAccess";
import { buildPulseHome } from "../lib/pulseHome";

export const pulseHomeRouter = Router();

pulseHomeRouter.get("/pulse/home", async (req, res) => {
  try {
    const propertyId = typeof req.query.propertyId === "string" ? req.query.propertyId : undefined;
    if (propertyId && !isUuid(propertyId)) return res.status(400).json({ error: "Invalid propertyId" });
    const limit = req.query.limit ? Number(req.query.limit) : 40;
    const payload = await buildPulseHome({ propertyId, limit });
    // Hard strip — never attach money keys
    return res.json(payload);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

pulseHomeRouter.get("/pulse/health", (_req, res) => {
  res.json({ ok: true, service: "pulse-home", version: 1, money: false });
});

export default pulseHomeRouter;
