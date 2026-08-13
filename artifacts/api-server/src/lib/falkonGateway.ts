/**
 * Falkon Ops — S2S Gateway Client.
 *
 * Signs every outbound request to the Falkon gateway with HALO's Ed25519
 * private key using Falkon's canonical enterprise signing contract:
 *
 *   signingString = clientId + "\n" + timestampMs + "\n" + nonce + "\n" + sha256hex(rawBody)
 *   X-Falkon-Signature: base64url-no-padding Ed25519 signature
 *
 * Empty-body requests (GET, DELETE with no body) use sha256hex("") as the
 * body hash. Timestamp is Unix epoch in MILLISECONDS (not seconds).
 *
 * Legacy HALO-* signing headers are removed. Never log the private key.
 */

import { createHash, sign as edSign, randomUUID } from "node:crypto";
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
// Canonical Ed25519 signing — Falkon enterprise contract
// ---------------------------------------------------------------------------

/**
 * base64url without padding (RFC 4648 §5, no '=').
 * This is what Falkon's canonical contract requires for X-Falkon-Signature.
 */
function base64urlNopad(buf: Buffer): string {
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Build an X-Falkon-Signature for a request.
 *
 * Contract:
 *   signingString = clientId + "\n" + timestampMs + "\n" + nonce + "\n" + sha256hex(rawBody)
 *   signature     = Ed25519(privateKey, signingString)   [base64url, no padding]
 *
 * Returns null when the private key is unavailable (e.g. identity not yet
 * initialised). Callers still send the request without the header — the
 * gateway will reject it with 401, which is the correct behaviour.
 *
 * SECURITY: never log signingString or privateKey values.
 */
function buildOutboundSignature(
  timestampMs: number,
  nonce: string,
  bodyHash: string,
): string | null {
  const key = getSigningKey();
  if (!key) return null;
  const signingString = `${CLIENT_ID}\n${timestampMs}\n${nonce}\n${bodyHash}`;
  try {
    const sigBuf = edSign(null, Buffer.from(signingString, "utf8"), key);
    return base64urlNopad(sigBuf);
  } catch {
    // Signing failures must not propagate — return null so the request is
    // sent without a signature, giving the gateway a 401 to reject cleanly.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Core signed fetch
// ---------------------------------------------------------------------------

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
  // Use empty string for no-body requests — sha256("") is the canonical body hash.
  const rawBody = options.body !== undefined ? JSON.stringify(options.body) : "";
  const bodyHash = sha256hex(rawBody);

  // Timestamp in MILLISECONDS (Falkon canonical contract)
  const timestampMs = Date.now();
  // Fresh nonce per request for replay prevention
  const nonce = randomUUID();
  const signature = buildOutboundSignature(timestampMs, nonce, bodyHash);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Falkon-Client-Id": CLIENT_ID,
    "X-Falkon-Timestamp": String(timestampMs),
    "X-Falkon-Nonce": nonce,
    "X-Falkon-Mode": options.mode,
  };
  if (signature) {
    headers["X-Falkon-Signature"] = signature;
  }

  try {
    const resp = await fetch(`${GATEWAY_ORIGIN}${path}`, {
      method,
      headers,
      body: rawBody || undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });

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

    const data = (await resp.json().catch(() => ({ ok: true }))) as T;
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
    /* silent — meter failures must never break gateway calls */
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
  if (path.includes("/trust")) return "system";
  if (path.includes("/events/ingest")) return "system";
  return "system";
}

// ---------------------------------------------------------------------------
// Public gateway methods
// ---------------------------------------------------------------------------

export async function gatewayHealth(): Promise<GatewayHealthResult> {
  const mode = await getEffectiveMode();
  // Gateway health endpoint is /healthz (not /health — /health returns 404)
  const { data, error } = await gatewayFetch<GatewayHealthResult>("/healthz", {
    mode,
    timeoutMs: 5_000,
  });
  if (error) {
    logger.warn({ err: error }, "falkon: gateway health check failed");
    return { ok: false, status: error.message };
  }
  // Normalize: gateway returns {"status":"ok"} without an explicit ok boolean.
  // Treat status === "ok" or status === "healthy" as ok:true.
  const raw = data ?? { ok: true, status: "ok" };
  if (!raw.ok && (raw.status === "ok" || raw.status === "healthy")) {
    return { ...raw, ok: true };
  }
  return raw;
}

export async function submitTrustBinding(trustDocUrl: string, publicKeyPem: string): Promise<{
  ok: boolean;
  falkonPublicKeyPem?: string;
  body?: unknown;
}> {
  const mode = await getEffectiveMode();
  const { data, error } = await gatewayFetch<{
    ok: boolean;
    falkonPublicKeyPem?: string;
  }>(`/partners/${CLIENT_ID}/trust`, {
    method: "PUT",
    body: {
      clientId: CLIENT_ID,
      partnerId: PARTNER_ID,
      trustDocUrl,
      publicKeyPem,
      spec: "falkon-trust/v1",
    },
    mode,
    timeoutMs: 15_000,
  });
  if (error) {
    return { ok: false };
  }
  return { ok: data?.ok ?? false, falkonPublicKeyPem: data?.falkonPublicKeyPem, body: data };
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
      mode: "SHADOW", // always SHADOW for test executions
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
  const callbackBase = process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]!.trim()}`
    : "";
  const { data, error } = await gatewayFetch<GatewayPingResult>(
    `/partners/${CLIENT_ID}/ping`,
    {
      method: "POST",
      body: {
        partnerId: PARTNER_ID,
        ts: t0,
        ...(nonce
          ? {
              nonce,
              callbackUrl: `${callbackBase}/api/falkon/webhook`,
              eventType: "partner.verify.ping",
            }
          : {}),
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

/**
 * Deliver a single event to Falkon's event-ingestion endpoint.
 * Falls back to webhookUrl if eventIngestUrl is not configured.
 * Signs with Ed25519 canonical scheme.
 * Returns whether delivery succeeded.
 */
export async function ingestEvent(
  ingestUrl: string,
  eventBody: Record<string, unknown>,
): Promise<boolean> {
  const rawBody = JSON.stringify(eventBody);
  const bodyHash = sha256hex(rawBody);
  const timestampMs = Date.now();
  const nonce = randomUUID();
  const signature = buildOutboundSignature(timestampMs, nonce, bodyHash);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Falkon-Client-Id": CLIENT_ID,
    "X-Falkon-Timestamp": String(timestampMs),
    "X-Falkon-Nonce": nonce,
  };
  if (signature) headers["X-Falkon-Signature"] = signature;

  try {
    const resp = await fetch(ingestUrl, {
      method: "POST",
      headers,
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getEffectiveMode(): Promise<string> {
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
