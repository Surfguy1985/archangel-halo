import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { buildOpsStatus } from "../lib/opsStatus";

const router: IRouter = Router();

/** Liveness for Replit/load balancers — always 200 if process is up. */
router.get("/healthz", async (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  try {
    const ops = await buildOpsStatus();
    res.status(200).json({ ...data, ops: { ok: ops.ok, status: ops.status, latencyMs: ops.latencyMs } });
  } catch {
    res.status(200).json(data);
  }
});

export default router;
