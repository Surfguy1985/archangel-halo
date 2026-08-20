import { Router } from "express";
import { buildOpsStatus } from "../lib/opsStatus";

export const opsRouter = Router();

opsRouter.get("/ops/status", async (_req, res) => {
  try {
    const status = await buildOpsStatus();
    res.status(status.ok ? 200 : 503).json(status);
  } catch (err: any) {
    res.status(503).json({ ok: false, status: "error", error: err.message });
  }
});

opsRouter.get("/ops/health", (_req, res) => {
  res.json({ ok: true, service: "ops", version: 1 });
});

export default opsRouter;
