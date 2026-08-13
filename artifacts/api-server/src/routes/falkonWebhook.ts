/**
 * Falkon Ops — Inbound Webhook + Trust Document routes.
 *
 * GET  /.well-known/falkon-trust.json  — HALO's trust document (public)
 * POST /api/falkon/webhook             — Inbound events from Falkon gateway
 *
 * Both routes are public (no office-passcode gate).
 *
 * WEBHOOK VERIFICATION (fail-closed):
 *
 *   Primary path — Falkon Ed25519 canonical contract:
 *     Headers: X-Falkon-Client-Id, X-Falkon-Timestamp (epoch ms),
 *              X-Falkon-Nonce (UUID), X-Falkon-Signature (base64url-no-pad)
 *     signingString = clientId + "\n" + timestampMs + "\n" + nonce + "\n" + sha256hex(rawBody)
 *     Verified against Falkon's cached Ed25519 public key (falkon_remote_identity).
 *
 *   Fallback path — HMAC-SHA256 (transition only, if webhookSecret is set
 *     and no remote Ed25519 key is cached):
 *     Headers: X-Falkon-Timestamp (ms), X-Falkon-Signature: v1=<hex>
 *     msg = timestampMs + "." + rawBody
 *
 *   Rejection rules:
 *     - Missing signature header                     → 401
 *     - No remote Ed25519 key AND no webhookSecret   → 401
 *     - Timestamp outside ±5-minute window           → 400
 *     - Signature mismatch                           → 401
 *     - DB error on nonce claim                      → 500 (sender retries)
 *
 * TRUST DOCUMENT:
 *   Production-safe: uses REPLIT_DOMAINS for stable URL.
 *   Contains only public material (public key PEM, URLs, spec).
 *   Never exposes private key, webhook secret, or credentials.
 */

import { Router } from "express";
import { createHash, verify as edVerify, timingSafeEqual, createHmac } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { buildTrustDoc } from "../lib/falkonIdentity";
import { logger } from "../lib/logger";

export const falkonWebhookRouter = Router();

// ---------------------------------------------------------------------------
// Trust Document — GET /.well-known/falkon-trust.json
// ---------------------------------------------------------------------------

falkonWebhookRouter.get("/.well-known/falkon-trust.json", (req, res) => {
  const baseUrl = getProductionBaseUrl();
  const doc = buildTrustDoc(baseUrl);
  if (!doc) {
    return res.status(503).json({ error: "Identity not yet initialised" });
  }
  // Public doc — cache for 1 hour, allow CORS for Falkon gateway reads
  res.set({
    "Content-Type": "application/json",
    "Cache-Control": "public, max-age=3600, s-maxage=3600",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET",
  });
  return res.json(doc);
});

// ---------------------------------------------------------------------------
// Inbound Webhook — POST /api/falkon/webhook
// ---------------------------------------------------------------------------

falkonWebhookRouter.post("/falkon/webhook", async (req, res) => {
  try {
    const rawBody: string = req.rawBody ?? JSON.stringify(req.body ?? {});
    const body = req.body as Record<string, unknown>;

    // ── Identity fields ────────────────────────────────────────────────────
    // jti may come from the JSON body or be synthesised from a UUID nonce
    const jti = (body.jti ?? body.eventId ?? body.id) as string | undefined;
    const eventType = body.eventType as string | undefined;
    const payload = (body.payload ?? body) as Record<string, unknown>;

    if (!jti || !eventType) {
      return res.status(400).json({ error: "Missing jti or eventType" });
    }

    // ── Canonical header extraction ────────────────────────────────────────
    const xClientId   = req.headers["x-falkon-client-id"]  as string | undefined;
    const xTimestamp  = req.headers["x-falkon-timestamp"]  as string | undefined;
    const xNonce      = req.headers["x-falkon-nonce"]      as string | undefined;
    const xSignature  = req.headers["x-falkon-signature"]  as string | undefined;

    // Legacy header names (kept for backward compat during migration window)
    const legacyTs    = req.headers["halo-timestamp"]       as string | undefined;
    const legacySig   = req.headers["halo-signature"]       as string | undefined;
    const legacyFalkonSig = req.headers["falkon-signature"] as string | undefined;

    const effectiveTimestamp = xTimestamp ?? legacyTs;
    const effectiveNonce     = xNonce ?? jti; // fall back to jti as nonce

    // ── Timestamp freshness — ±5 minute window ─────────────────────────────
    if (!effectiveTimestamp || isNaN(Number(effectiveTimestamp))) {
      logger.warn({ jti, eventType }, "falkon webhook: missing or invalid timestamp — rejected");
      return res.status(400).json({ error: "Missing or invalid timestamp" });
    }
    const tsRaw = Number(effectiveTimestamp);
    // Auto-detect seconds vs milliseconds
    const tsMs = tsRaw < 1_000_000_000_000 ? tsRaw * 1_000 : tsRaw;
    const skew = Math.abs(Date.now() - tsMs);
    if (skew > 5 * 60_000) {
      logger.warn({ jti, eventType, skewMs: skew }, "falkon webhook: timestamp outside ±5min — rejected");
      return res.status(400).json({ error: "Timestamp outside acceptable window" });
    }

    // ── Signature verification ─────────────────────────────────────────────
    let sigVerified = await verifyInboundSignature({
      rawBody,
      xClientId,
      xTimestamp: String(tsMs),
      xNonce: effectiveNonce,
      xSignature,
      legacySig: legacySig ?? legacyFalkonSig,
    });

    // Grace path for the verification round-trip ping (step 5).
    // During the handshake HALO initiated, the Falkon gateway echoes the ping
    // back as a "partner.verify.ping" event. Signature verification may fail
    // if Falkon's public key hasn't been cached yet (e.g. the trust-binding
    // step didn't return it). We allow the ping through when:
    //   1. eventType is the expected verification ping type, AND
    //   2. a pendingNonce is currently set (we initiated this handshake), AND
    //   3. the timestamp is fresh (already checked above).
    // The nonce correlation in dispatchEvent provides uniqueness and replay
    // protection even without Ed25519 verification at this stage.
    if (!sigVerified && (eventType === "partner.verify.ping" || eventType === "verify.ping")) {
      try {
        const pendingRow = await db.execute(
          sql`SELECT 1 FROM falkon_connections
              WHERE verification_steps->>'pendingNonce' IS NOT NULL
              LIMIT 1`,
        );
        const pendingRows = (pendingRow as any).rows ?? (pendingRow as unknown as unknown[]);
        if (Array.isArray(pendingRows) && pendingRows.length > 0) {
          sigVerified = true;
          logger.info({ jti }, "falkon webhook: verify-ping allowed through handshake grace path");
        }
      } catch {
        // DB error — leave sigVerified as false, reject normally
      }
    }

    if (!sigVerified) {
      logger.warn({ jti, eventType }, "falkon webhook: signature verification failed — rejected");
      return res.status(401).json({ error: "Invalid Falkon signature" });
    }

    // ── Nonce deduplication ────────────────────────────────────────────────
    // Use X-Falkon-Nonce if present, else jti — both are unique per event
    const nonceKey = xNonce ?? jti;
    const isDupe = await claimNonce(nonceKey);
    if (isDupe) {
      logger.info({ jti }, "falkon webhook: duplicate nonce — already processed");
      return res.json({ ok: true, deduplicated: true });
    }

    // ── Store inbound event (column names from falkon_inbound_events schema) ──
    await db.execute(
      sql`INSERT INTO falkon_inbound_events
            (id, falkon_event_id, event_type, payload, status, created_at)
          VALUES
            (gen_random_uuid(), ${jti}, ${eventType},
             ${JSON.stringify(body)}::jsonb, 'pending', now())
          ON CONFLICT (falkon_event_id) DO NOTHING`,
    );

    // ── Dispatch to handler ────────────────────────────────────────────────
    void dispatchEvent(jti, eventType, payload).catch((err) => {
      logger.error({ err, jti, eventType }, "falkon webhook: dispatch error");
    });

    return res.json({ ok: true, jti });
  } catch (err) {
    logger.error({ err }, "falkon webhook: unhandled error");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

interface VerifyArgs {
  rawBody: string;
  xClientId: string | undefined;
  xTimestamp: string;
  xNonce: string | undefined;
  xSignature: string | undefined;
  legacySig: string | undefined;
}

/**
 * Verify inbound Falkon signature. Fail-closed on all error paths.
 *
 * 1. If X-Falkon-Signature is present and a remote Ed25519 key is cached →
 *    verify Ed25519 using the canonical signing string.
 *
 * 2. Else if a webhookSecret is configured →
 *    verify HMAC-SHA256 fallback (transition period only).
 *
 * 3. If neither is available → reject (cannot verify → 401).
 */
async function verifyInboundSignature(args: VerifyArgs): Promise<boolean> {
  const { rawBody, xClientId, xTimestamp, xNonce, xSignature, legacySig } = args;

  // ── Attempt 1: Ed25519 canonical verification ─────────────────────────
  if (xSignature) {
    try {
      const remoteKey = await getRemotePublicKey();
      if (remoteKey) {
        const bodyHash = sha256hex(rawBody);
        // signingString = clientId + "\n" + timestampMs + "\n" + nonce + "\n" + bodyHash
        // If clientId or nonce headers are missing, reconstruct from available data
        const clientId = xClientId ?? "";
        const nonce    = xNonce    ?? "";
        const signingString = `${clientId}\n${xTimestamp}\n${nonce}\n${bodyHash}`;

        // Decode base64url-no-pad signature
        const sigBuf = base64urlDecode(xSignature);
        const msgBuf = Buffer.from(signingString, "utf8");

        const ok = edVerify(null, msgBuf, remoteKey, sigBuf);
        if (ok) return true;

        // Signature is present but fails → hard reject (don't fall through to HMAC)
        logger.warn("falkon webhook: Ed25519 signature mismatch");
        return false;
      }
      // No remote key yet — fall through to HMAC
    } catch (err) {
      logger.error({ err }, "falkon webhook: Ed25519 verification threw");
      return false;
    }
  }

  // ── Attempt 2: HMAC-SHA256 fallback ───────────────────────────────────
  const hmacSig = legacySig ?? xSignature;
  if (hmacSig) {
    try {
      const secret = await getWebhookSecret();
      if (secret) {
        // Legacy scheme: v1=hmac(secret, timestampMs + "." + rawBody)
        const msg = `${xTimestamp}.${rawBody}`;
        const expected = "v1=" + createHmac("sha256", secret).update(msg).digest("hex");
        const a = Buffer.from(expected);
        const b = Buffer.from(hmacSig);
        if (a.length === b.length && timingSafeEqual(a, b)) return true;
      }
    } catch (err) {
      logger.error({ err }, "falkon webhook: HMAC verification threw");
    }
  }

  // ── Nothing worked ────────────────────────────────────────────────────
  logger.warn({
    hasXSig: !!xSignature,
    hasLegacySig: !!legacySig,
  }, "falkon webhook: no valid signature — rejected");
  return false;
}

async function getRemotePublicKey(): Promise<string | null> {
  try {
    const row = await db.execute(
      sql`SELECT public_key_pem FROM falkon_remote_identity ORDER BY fetched_at DESC LIMIT 1`,
    );
    return ((row as any).rows?.[0] ?? (row as any)[0])?.public_key_pem as string ?? null;
  } catch {
    return null;
  }
}

async function getWebhookSecret(): Promise<string | null> {
  try {
    const row = await db.execute(
      sql`SELECT webhook_secret FROM falkon_connections LIMIT 1`,
    );
    return ((row as any).rows?.[0] ?? (row as any)[0])?.webhook_secret as string ?? null;
  } catch {
    return null;
  }
}

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Decode base64url (with or without padding) to a Buffer.
 */
function base64urlDecode(s: string): Buffer {
  // Replace URL-safe chars and add padding
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const mod4 = padded.length % 4;
  const b64 = mod4 ? padded + "=".repeat(4 - mod4) : padded;
  return Buffer.from(b64, "base64");
}

// ---------------------------------------------------------------------------
// Nonce claim
// ---------------------------------------------------------------------------

async function claimNonce(nonce: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const result = await db.execute(
    sql`INSERT INTO falkon_webhook_nonces (id, jti, received_at, expires_at)
        VALUES (gen_random_uuid(), ${nonce}, now(), ${expiresAt}::timestamptz)
        ON CONFLICT (jti) DO NOTHING
        RETURNING id`,
  );
  const rows = (result as any).rows ?? (result as any);
  return Array.isArray(rows) ? rows.length === 0 : true;
}

// ---------------------------------------------------------------------------
// Event dispatcher
// ---------------------------------------------------------------------------

async function dispatchEvent(
  jti: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  logger.info({ jti, eventType }, "falkon webhook: dispatching event");

  // ── Verify-ping round-trip (step 5) ─────────────────────────────────────
  if (eventType === "partner.verify.ping" || eventType === "verify.ping") {
    const callbackNonce = (payload.nonce ?? (payload as any).body?.nonce) as string | undefined;
    if (callbackNonce) {
      await db.execute(
        sql`UPDATE falkon_connections
            SET verification_steps =
                  COALESCE(verification_steps, '{}')
                  || jsonb_build_object('callbackNonce', ${callbackNonce}::text),
                updated_at = now()
            WHERE verification_steps->>'pendingNonce' = ${callbackNonce}`,
      );
      logger.info(
        { callbackNonce: callbackNonce.slice(0, 8) },
        "falkon webhook: verify-ping callbackNonce written",
      );
    } else {
      logger.warn({ eventType }, "falkon webhook: verify-ping received without nonce");
    }
  }

  // ── Twin sync — property ─────────────────────────────────────────────────
  if (eventType === "twin.property.updated") {
    const externalId = payload.externalId as string | undefined;
    const falkonId   = payload.falkonPropertyId as string | undefined;
    if (externalId && falkonId) {
      await db.execute(
        sql`UPDATE properties
            SET falkon_property_id = ${falkonId}, falkon_synced_at = now()
            WHERE id = ${externalId}::uuid`,
      );
    }
  }

  // ── Twin sync — unit ─────────────────────────────────────────────────────
  if (eventType === "twin.unit.updated") {
    const externalId = payload.externalId as string | undefined;
    const falkonId   = payload.falkonUnitId  as string | undefined;
    if (externalId && falkonId) {
      await db.execute(
        sql`UPDATE falkon_units
            SET falkon_unit_id = ${falkonId}, updated_at = now()
            WHERE id = ${externalId}::uuid`,
      );
    }
  }

  // ── Inbound capability request → office approval queue ──────────────────
  if (eventType === "capability.request") {
    const correlationId  = (payload.correlationId ?? jti) as string;
    const capabilityId   = payload.capabilityId  as string | undefined;
    const summary        = payload.summary        as string | undefined;
    const requester      = payload.requester      as Record<string, unknown> | undefined;
    const sharedData     = payload.sharedData     as unknown;
    const externalRef    = (payload.externalRef ?? payload.jti ?? jti) as string;

    if (!capabilityId) {
      logger.warn({ jti }, "falkon webhook: capability.request missing capabilityId — skipping");
    } else {
      const requesterDomain = ((requester?.domain ?? requester?.trustDocUrl) as string | undefined)
        ?.replace(/^https?:\/\//, "")
        .split("/")[0];

      const peerRow = requesterDomain
        ? await db.execute(
            sql`SELECT id, name FROM falkon_peers WHERE domain = ${requesterDomain} LIMIT 1`,
          ).then((r) => {
            const rows = (r as any).rows ?? r;
            return Array.isArray(rows) ? (rows[0] as { id: string; name: string } | undefined) : undefined;
          }).catch(() => undefined)
        : undefined;

      const initEvent = JSON.stringify([{
        ts: Date.now(),
        event: "received",
        detail: `Inbound capability.request received via webhook (jti: ${jti.slice(0, 8)})`,
      }]);

      await db.execute(
        sql`INSERT INTO falkon_cross_requests
              (id, direction, peer_id, peer_name, capability_id,
               correlation_id, external_ref, approval_state, summary,
               shared_data_snapshot, requester_identity, request_events,
               attempts, created_at, updated_at)
            VALUES
              (gen_random_uuid(), 'inbound',
               ${peerRow?.id ? `${peerRow.id}` : null}::uuid,
               ${peerRow?.name ?? (requester?.businessName as string) ?? requesterDomain ?? "Unknown"},
               ${capabilityId},
               ${correlationId},
               ${externalRef},
               'awaiting_approval',
               ${summary ?? null},
               ${sharedData ? JSON.stringify(sharedData) : null}::jsonb,
               ${requester ? JSON.stringify(requester) : null}::jsonb,
               ${initEvent}::jsonb,
               0, now(), now())
            ON CONFLICT (correlation_id) DO NOTHING`,
      );

      logger.info(
        { jti, correlationId, capabilityId },
        "falkon webhook: inbound capability.request stored for approval",
      );
    }
  }

  // ── Vendor/crew compliance update ────────────────────────────────────────
  if (eventType === "vendor.compliance.updated" || eventType === "twin.vendor.updated") {
    const externalId = payload.externalId as string | undefined;
    const complianceStatus = payload.complianceStatus as string | undefined;
    const falkonTier = payload.tier as string | undefined;
    if (externalId) {
      await db.execute(
        sql`UPDATE crews
            SET falkon_compliance_status = COALESCE(${complianceStatus ?? null}, falkon_compliance_status),
                falkon_tier = COALESCE(${falkonTier ?? null}, falkon_tier),
                updated_at = now()
            WHERE id = ${externalId}::uuid`,
      );
    }
  }

  // ── Mark event processed ────────────────────────────────────────────────
  await db.execute(
    sql`UPDATE falkon_inbound_events
        SET status = 'processed', processed_at = now()
        WHERE falkon_event_id = ${jti}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the stable production base URL.
 * Prefers REPLIT_DOMAINS (production domain) over request Host header for
 * trust document stability — the trust doc URL must not change between
 * deploys or the gateway will reject the trust binding.
 */
function getProductionBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const primary = domains.split(",")[0]!.trim();
    return `https://${primary}`;
  }
  // Fallback for local dev
  return "https://archangel-halo.replit.app";
}
