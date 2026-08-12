/**
 * Falkon Ops — S2S Gateway Client.
 *
 * Signs every outbound request to the Falkon gateway with HALO's Ed25519
 * private key and the canonical HALO-Signature scheme.  All methods are
 * SHADOW-safe: they include X-Falkon-Mode and never throw to callers.
 *
 * Signing scheme:
 *   signingString = "${clientId}.${unixSeconds}.${sha256hex(requestBody)}"
 *   HALO-Signature: <base64(ed25519_sign(privateKey, signingString))>
 */

import { createHash, sign as edSign } from "node:crypto";
import { db } from "@workspace/db";
import { falkonConnectionsTable } from "@workspace/db/schema";
import { getSigningKey } from "./falkonIdentity";
import { logger } from "./logger";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GATEWAY_ORIGIN = "https://building-blocks--austpryb1.replit.app/api";
export const CLIENT_ID = "fk_archangel_halo_prod";
export const TENANT = "archangel-halo-prod";
export const PARTNER_ID = "archangel-halo";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class FalkonGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = "FalkonGatewayError";
  }
}

// ---------------------------------------------------------------------------
// Typed response shapes
// ---------------------------------------------------------------------------

export interface GatewayHealthResult {
  ok: boolean;
  status: string;
  version?: string;
  ts?: number;
}

export interface GatewayCallbackResult {
  ok: boolean;
  callbackId?: string;
  reachable?: boolean;
}

export interface GatewayShadowExecutionResult {
  ok: boolean;
  executionId?: string;
  phase?: string;
  gatesEvaluated?: number;
  shadowResult?: Record<string, unknown>;
}

export interface GatewayPingResult {
  ok: boolean;
  echoed?: boolean;
  latencyMs?: number;
}

export interface GatewayTwinResult {
  ok: boolean;
  twinId?: string;
  action?: "created" | "updated" | "noop";
}

export interface GatewayCapabilitiesResult {
  ok: boolean;
  registered?: string[];
  entitlements?: string[];
}

// ---------------------------------------------------------------------------
// Core signing + fetch
// ---------------------------------------------------------------------------

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function buildSignature(timestampSec: number, bodyHash: string): string | null {
  const key = getSigningKey();
  if (!key) return null;
  const signingString = `${CLIENT_ID}.${timestampSec}.${bodyHash}`;
  const sigBuf = edSign(null, Buffer.from(signingString, "utf8"), key);
  return sigBuf.toString("base64");
}

async function gatewayFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    mode: string;
    timeoutMs?: number;
  },
): Promise<{ data: T | null; error: FalkonGatewayError | null }> {
  const method = options.method ?? "GET";
  const rawBody = options.body !== undefined ? JSON.stringify(options.body) : "";
  const ts = Math.floor(Date.now() / 1000);
  const bodyHash = sha256hex(rawBody);
  const signature = buildSignature(ts, bodyHash);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HALO-Client-Id": CLIENT_ID,
    "HALO-Tenant": TENANT,
    "HALO-Partner-Id": PARTNER_ID,
    "HALO-Timestamp": String(ts),
    "X-Falkon-Mode": options.mode,
  };
  if (signature) headers["HALO-Signature"] = signature;

  try {
    const resp = await fetch(`${GATEWAY_ORIGIN}${path}`, {
      method,
      headers,
      body: rawBody || undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

    // Track usage
    void trackUsageCall(path, options.mode, resp.ok ? 0 : 1).catch(() => {});

    if (!resp.ok) {
      const text = await resp.text().catch(() => String(resp.status));
      return {
        data: null,
        error: new FalkonGatewayError(
          `Gateway error ${resp.status}: ${text.slice(0, 200)}`,
          `HTTP_${resp.status}`,
          resp.status >= 500,
          resp.status,
        ),
      };
    }

    const data = await resp.json().catch(() => ({ ok: true })) as T;
    return { data, error: null };
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.code === "ABORT_ERR";
    return {
      data: null,
      error: new FalkonGatewayError(
        err?.message ?? String(err),
        isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
        true,
      ),
    };
  }
}

// ---------------------------------------------------------------------------
// Usage tracking
// ---------------------------------------------------------------------------

async function trackUsageCall(
  path: string,
  mode: string,
  errorCount: number,
): Promise<void> {
  try {
    const capability = pathToCapability(path);
    const today = new Date().toISOString().slice(0, 10);
    const isShadow = mode === "SHADOW" ? 1 : 0;
    await db.execute(
      sql`INSERT INTO falkon_usage_meters
            (id, capability, date, calls, shadow_calls, error_count, created_at, updated_at)
          VALUES
            (gen_random_uuid(), ${capability}, ${today}::date, 1, ${isShadow}, ${errorCount}, now(), now())
          ON CONFLICT (capability, date)
          DO UPDATE SET
            calls = falkon_usage_meters.calls + 1,
            shadow_calls = falkon_usage_meters.shadow_calls + ${isShadow},
            error_count = falkon_usage_meters.error_count + ${errorCount},
            updated_at = now()`,
    );
  } catch {
    /* silent — don't break gateway calls over meter failures */
  }
}

function pathToCapability(path: string): string {
  if (path.includes("/health")) return "system";
  if (path.includes("/callbacks")) return "notifications";
  if (path.includes("/shadow/execute")) return "make-ready";
  if (path.includes("/twins/properties")) return "property-registry";
  if (path.includes("/twins/units")) return "unit-registry";
  if (path.includes("/twins/vendors")) return "vendor-registry";
  if (path.includes("/capabilities")) return "system";
  if (path.includes("/ping")) return "system";
  return "system";
}

// ---------------------------------------------------------------------------
// Public gateway methods
// ---------------------------------------------------------------------------

export async function gatewayHealth(): Promise<GatewayHealthResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayHealthResult>("/health", {
    mode,
    timeoutMs: 5_000,
  });
  if (error) {
    logger.warn({ err: error }, "falkon: gateway health check failed");
    return { ok: false, status: error.message };
  }
  return data ?? { ok: true, status: "ok" };
}

export async function registerCallback(webhookUrl: string): Promise<GatewayCallbackResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayCallbackResult>(
    `/partners/${CLIENT_ID}/callbacks`,
    {
      method: "POST",
      body: {
        partnerId: PARTNER_ID,
        clientId: CLIENT_ID,
        tenant: TENANT,
        webhookUrl,
        events: ["*"],
        mode,
      },
      mode,
    },
  );
  if (error) {
    logger.warn({ err: error }, "falkon: registerCallback failed");
    return { ok: false };
  }
  return data ?? { ok: true };
}

export async function runShadowExecution(payload: {
  propertyId?: string;
  unitLabel?: string;
  jobId?: string;
}): Promise<GatewayShadowExecutionResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayShadowExecutionResult>(
    `/partners/${CLIENT_ID}/shadow/execute`,
    {
      method: "POST",
      body: {
        partnerId: PARTNER_ID,
        tenant: TENANT,
        pipeline: "make-ready",
        payload: { ...payload, _shadow: true },
      },
      mode: "SHADOW", // always SHADOW for test execution
    },
  );
  if (error) {
    logger.warn({ err: error }, "falkon: runShadowExecution failed");
    return { ok: false };
  }
  return data ?? { ok: true, phase: "needs_turn" };
}

export async function gatewayPing(nonce?: string): Promise<GatewayPingResult> {
  const mode = await getEffectiveMode();
  const t0 = Date.now();
  const { data, error } = await gatewayFetch<GatewayPingResult>(
    `/partners/${CLIENT_ID}/ping`,
    {
      method: "POST",
      body: {
        partnerId: PARTNER_ID,
        ts: t0,
        // Include nonce so Falkon echoes it back in the verify-ping callback.
        // The nonce is server-generated in step 5 to authenticate the round-trip
        // without requiring a pre-cached Ed25519 remote key.
        ...(nonce ? { nonce, callbackUrl: `${process.env.REPLIT_DOMAINS ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]!.trim()}` : ""}/api/falkon/webhook`, eventType: "partner.verify.ping" } : {}),
      },
      mode,
      timeoutMs: 5_000,
    },
  );
  if (error) return { ok: false };
  return { ok: true, echoed: true, latencyMs: Date.now() - t0, ...data };
}

export async function syncPropertyTwin(property: {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  units?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  falkonPropertyId?: string | null;
}): Promise<GatewayTwinResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayTwinResult>(
    `/partners/${CLIENT_ID}/twins/properties/${property.id}`,
    {
      method: "PUT",
      body: {
        partnerId: PARTNER_ID,
        tenant: TENANT,
        externalId: property.id,
        falkonPropertyId: property.falkonPropertyId,
        name: property.name,
        address: property.address,
        city: property.city,
        units: property.units,
        coordinates:
          property.latitude && property.longitude
            ? { lat: property.latitude, lng: property.longitude }
            : undefined,
      },
      mode,
    },
  );
  if (error) {
    logger.warn({ err: error, propertyId: property.id }, "falkon: syncPropertyTwin failed");
    return { ok: false };
  }
  return data ?? { ok: true };
}

export async function syncUnitTwin(unit: {
  id: string;
  propertyId: string;
  unitLabel: string;
  status: string;
  falkonUnitId?: string | null;
  currentJobId?: string | null;
}): Promise<GatewayTwinResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayTwinResult>(
    `/partners/${CLIENT_ID}/twins/units/${unit.id}`,
    {
      method: "PUT",
      body: {
        partnerId: PARTNER_ID,
        tenant: TENANT,
        externalId: unit.id,
        propertyId: unit.propertyId,
        unitLabel: unit.unitLabel,
        status: unit.status,
        falkonUnitId: unit.falkonUnitId,
        currentJobId: unit.currentJobId,
      },
      mode,
    },
  );
  if (error) {
    logger.warn({ err: error, unitId: unit.id }, "falkon: syncUnitTwin failed");
    return { ok: false };
  }
  return data ?? { ok: true };
}

export async function syncVendorTwin(vendor: {
  id: string;
  name: string;
  trade?: string | null;
  falkonVendorId?: string | null;
  falkonTier?: string | null;
  falkonComplianceStatus?: string | null;
}): Promise<GatewayTwinResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayTwinResult>(
    `/partners/${CLIENT_ID}/twins/vendors/${vendor.id}`,
    {
      method: "PUT",
      body: {
        partnerId: PARTNER_ID,
        tenant: TENANT,
        externalId: vendor.id,
        name: vendor.name,
        trade: vendor.trade,
        falkonVendorId: vendor.falkonVendorId,
        tier: vendor.falkonTier,
        complianceStatus: vendor.falkonComplianceStatus,
      },
      mode,
    },
  );
  if (error) {
    logger.warn({ err: error, vendorId: vendor.id }, "falkon: syncVendorTwin failed");
    return { ok: false };
  }
  return data ?? { ok: true };
}

export async function registerCapabilities(capabilities: {
  id: string;
  status: "mapped" | "stub" | "unmapped";
}[]): Promise<GatewayCapabilitiesResult> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<GatewayCapabilitiesResult>(
    `/partners/${CLIENT_ID}/capabilities`,
    {
      method: "PUT",
      body: {
        partnerId: PARTNER_ID,
        tenant: TENANT,
        capabilities,
      },
      mode,
    },
  );
  if (error) {
    logger.warn({ err: error }, "falkon: registerCapabilities failed");
    return { ok: false, registered: [] };
  }
  return data ?? { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getEffectiveMode(): Promise<string> {
  try {
    const rows = await db
      .select({ mode: falkonConnectionsTable.mode })
      .from(falkonConnectionsTable)
      .limit(1);
    return rows[0]?.mode ?? "SHADOW";
  } catch {
    return "SHADOW";
  }
}
