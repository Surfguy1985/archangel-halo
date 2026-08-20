/**
 * Aggregate ops status for uptime monitors and go-live checks.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

export type OpsCheck = { id: string; ok: boolean; detail: string };

export async function buildOpsStatus() {
  const checks: OpsCheck[] = [];
  const started = Date.now();

  // DB
  try {
    await db.execute(sql`SELECT 1`);
    checks.push({ id: "database", ok: true, detail: "connected" });
  } catch (err: any) {
    checks.push({ id: "database", ok: false, detail: err?.message || "db error" });
  }

  // Env presence (do not leak secrets)
  const envKeys = [
    "DATABASE_URL",
    "PUBLIC_APP_URL",
    "WORK_RECONCILIATION_TOKEN",
    "HALO_WRITE_TOKEN",
    "HALO_READ_TOKEN",
    "BASE44_WRITE_URL",
  ];
  for (const key of envKeys) {
    const present = !!(process.env[key] && String(process.env[key]).trim());
    // DATABASE_URL is critical; tokens soft-warn
    const critical = key === "DATABASE_URL";
    checks.push({
      id: `env:${key}`,
      ok: critical ? present : true,
      detail: present ? "set" : critical ? "MISSING" : "optional/unset",
    });
  }

  // Feature flags / policy
  checks.push({
    id: "policy:auto_send_to_invoice",
    ok: true,
    detail: process.env.AUTO_SEND_TO_INVOICE === "true" ? "ON (aggressive)" : "OFF (safe default)",
  });

  const failed = checks.filter((c) => !c.ok);
  const status = failed.length === 0 ? "ok" : "degraded";

  return {
    ok: failed.length === 0,
    status,
    service: "archangel-halo",
    version: process.env.npm_package_version || "0.0.0",
    asOf: new Date().toISOString(),
    latencyMs: Date.now() - started,
    publicAppUrl: process.env.PUBLIC_APP_URL || null,
    checks,
    monitors: [
      "/healthz",
      "/api/ops/status",
      "/api/work-reviews/health",
      "/api/pulse/health",
      "/api/portfolio/health",
      "/api/invoice-drafts/health",
      "/api/halo-operator/health",
    ],
    base44: {
      workLoggedPath: "/api/internal/work-logged",
      note: "Set Base44 HALO_API_BASE + WORK_RECONCILIATION_URL to production replit.app",
    },
  };
}

export function logBootEnvWarnings() {
  const need = ["DATABASE_URL"];
  const warn = ["PUBLIC_APP_URL", "HALO_WRITE_TOKEN", "WORK_RECONCILIATION_TOKEN"];
  for (const k of need) {
    if (!process.env[k]) logger.error({ key: k }, "OPS: required env missing");
  }
  for (const k of warn) {
    if (!process.env[k]) logger.warn({ key: k }, "OPS: recommended env unset");
  }
}
