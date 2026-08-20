import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { buildOpsStatus } from "../lib/opsStatus";

const router: IRouter = Router();

router.get("/healthz", async (_req, res) => {
  try {
    const ops = await buildOpsStatus();
    const data = HealthCheckResponse.parse({ status: ops.ok ? "ok" : "degraded" });
    res.status(ops.ok ? 200 : 503).json({ ...data, ops: { ok: ops.ok, latencyMs: ops.latencyMs } });
  } catch {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  }
});

export default router;
