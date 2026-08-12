/**
 * Falkon Ops — Inbound Webhook + Trust Document routes.
 *
 * GET  /.well-known/falkon-trust.json  — HALO's trust document (public)
 * POST /api/falkon/webhook             — Inbound events from Falkon gateway
 *
 * Both are public (no passcode gate).
 * Webhook requests are verified against Falkon's Ed25519 public key
 * and deduplicated via the `falkon_webhook_nonces` table.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { buildTrustDoc } from "../lib/falkonIdentity";
import { logger } from "../lib/logger";

export const falkonWebhookRouter = Router();

// ---------------------------------------------------------------------------
// Trust Document — GET /.well-known/falkon-trust.json
// ---------------------------------------------------------------------------

falkonWebhookRouter.get("/.well-known/falkon-trust.json", (req, res) => {
  const origin = getBaseUrl(req);
  const doc = buildTrustDoc(origin);
  if (!doc) {
    return res.status(503).json({ error: "Identity not yet initialised" });
  }
  res.set("Cache-Control", "public, max-age=3600");
  return res.json(doc);
});

// ---------------------------------------------------------------------------
// Inbound Webhook — POST /api/falkon/webhook
// ---------------------------------------------------------------------------

falkonWebhookRouter.post("/falkon/webhook", async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const jti = (body.jti ?? body.eventId ?? body.id) as string | undefined;
    const eventType = body.eventType as string | undefined;
    const payload = body.payload as Record<string, unknown> | undefined;
    const ts = (body.timestamp ?? body.ts) as number | string | undefined;
    const sigHeader = req.headers["falkon-signature"] as string | undefined;

    if (!jti || !eventType) {
      return res.status(400).json({ error: "Missing jti or eventType" });
    }

    // ── Timestamp validation (±5-minute window) ─────────────────────────────
    // Prevents replay of old captured-but-valid signed events.
    // The 24-hour nonce retention further blocks replays within that window.
    const tsVal = ts !== undefined ? Number(ts) : NaN;
    if (!Number.isFinite(tsVal)) {
      logger.warn({ jti, eventType }, "falkon webhook: missing or non-numeric timestamp — rejected");
      return res.status(400).json({ error: "Missing or invalid timestamp" });
    }
    const tsMs = tsVal > 1_000_000_000_000 ? tsVal : tsVal * 1_000; // handle s or ms
    const skew = Math.abs(Date.now() - tsMs);
    const MAX_SKEW_MS = 5 * 60 * 1_000; // 5 minutes
    if (skew > MAX_SKEW_MS) {
      logger.warn({ jti, eventType, skewMs: skew }, "falkon webhook: timestamp outside ±5min window — rejected");
      return res.status(400).json({ error: "Timestamp outside acceptable window" });
    }

    // ── Ed25519 signature verification ─────────────────────────────────────
    // Every inbound event is fully authenticated. Step 2 (trust-binding) caches
    // Falkon's public key before step 5 (ping round-trip) runs; the step-5
    // prerequisite check enforces this ordering.
    const rawBody = req.rawBody ?? JSON.stringify(body);
    const sigVerified = await verifyFalkonSignature(rawBody, sigHeader);
    if (!sigVerified) {
      logger.warn({ jti, eventType }, "falkon webhook: signature verification failed — rejected");
      return res.status(401).json({ error: "Invalid Falkon signature" });
    }

    // ── Nonce deduplication ────────────────────────────────────────────────
    const isDupe = await claimNonce(jti);
    if (isDupe) {
      logger.info({ jti }, "falkon webhook: duplicate nonce, already processed");
      return res.json({ ok: true, deduplicated: true });
    }

    // ── Store inbound event ────────────────────────────────────────────────
    await db.execute(
      sql`INSERT INTO falkon_inbound_events
            (id, event_type, jti, payload, received_at, processed, created_at)
          VALUES
            (gen_random_uuid(), ${eventType}, ${jti},
             ${JSON.stringify(body)}::jsonb, now(), false, now())`,
    );

    // ── Route to handler ───────────────────────────────────────────────────
    void dispatchEvent(jti, eventType, payload ?? {}).catch((err) => {
      logger.error({ err, jti, eventType }, "falkon webhook: dispatch error");
    });

    return res.json({ ok: true, jti });
  } catch (err) {
    logger.error({ err }, "falkon webhook: unhandled error");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// Signature verification using Falkon's cached Ed25519 public key
// ---------------------------------------------------------------------------

/**
 * Verify inbound Falkon Ed25519 signature.
 * FAIL CLOSED — always rejects when the signature is absent, invalid, or
 * cannot be verified against the cached Falkon Ed25519 remote key.
 *
 * Step 2 (trust-binding) caches Falkon's public key before step 5
 * (ping round-trip) runs, so every inbound event is fully authenticated.
 * There is no bootstrap exception.
 */
async function verifyFalkonSignature(
  rawBody: string,
  sigHeader: string | undefined,
): Promise<boolean> {
  if (!sigHeader) {
    logger.warn("falkon webhook: missing FALKON-SIGNATURE header — rejected");
    return false;
  }

  try {
    const row = await db.execute(
      sql`SELECT public_key_pem FROM falkon_remote_identity ORDER BY fetched_at DESC LIMIT 1`,
    );
    const key = ((row as any).rows?.[0] ?? (row as any)[0])?.public_key_pem as string | undefined;

    if (!key) {
      // No remote key on file at all — cannot verify. Fail closed.
      logger.warn("falkon webhook: no remote identity cached — rejected; run trust-binding (step 2) first");
      return false;
    }

    const sigBuf = Buffer.from(sigHeader, "base64");
    const bodyBuf = Buffer.from(rawBody, "utf8");
    const { verify: edVerify } = await import("node:crypto");
    return edVerify(null, bodyBuf, key, sigBuf);
  } catch (err) {
    logger.error({ err }, "falkon webhook: signature verification threw");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Nonce claim — returns true if already seen (duplicate)
// ---------------------------------------------------------------------------

/**
 * Atomically claim a nonce JTI for replay prevention.
 *
 * Returns `true` if the JTI was already seen (duplicate — caller should
 * return 200 deduplicated).
 *
 * THROWS on any database error. Callers must NOT catch this and accept the
 * event — a DB failure must produce a 5xx so the sender retries, rather than
 * silently accepting an event without a durable replay claim.
 */
async function claimNonce(jti: string): Promise<boolean> {
  const expiresAt = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const result = await db.execute(
    sql`INSERT INTO falkon_webhook_nonces (id, jti, received_at, expires_at)
        VALUES (gen_random_uuid(), ${jti}, now(), ${expiresAt}::timestamptz)
        ON CONFLICT (jti) DO NOTHING
        RETURNING id`,
  );
  const rows = (result as any).rows ?? (result as any);
  const inserted = Array.isArray(rows) ? rows.length : 0;
  // ON CONFLICT DO NOTHING returns no rows on conflict
  return inserted === 0;
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

  // Verify-ping nonce correlation: Falkon echoes back the nonce we sent in step 5.
  // The callback has already passed Ed25519 verification (step 2 cached the key),
  // so we trust the nonce value in the payload. Write callbackNonce so the step-5
  // polling loop can detect it. Fail silently if the nonce doesn't match (e.g.
  // stale/replayed verify-ping from a previous session) — the connection just
  // won't be marked verified.
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
      logger.info({ callbackNonce: callbackNonce.slice(0, 8) },
        "falkon webhook: verify-ping callbackNonce written");
    } else {
      logger.warn({ eventType }, "falkon webhook: verify-ping received without nonce");
    }
  }

  // Sync twin updates from Falkon
  if (eventType === "twin.property.updated") {
    const externalId = payload.externalId as string | undefined;
    const falkonId = payload.falkonPropertyId as string | undefined;
    if (externalId && falkonId) {
      await db.execute(
        sql`UPDATE properties
            SET falkon_property_id = ${falkonId}, falkon_synced_at = now()
            WHERE id = ${externalId}::uuid`,
      );
    }
  }

  if (eventType === "twin.unit.updated") {
    const externalId = payload.externalId as string | undefined;
    const falkonId = payload.falkonUnitId as string | undefined;
    if (externalId && falkonId) {
      await db.execute(
        sql`UPDATE falkon_units
            SET falkon_unit_id = ${falkonId}, updated_at = now()
            WHERE id = ${externalId}::uuid`,
      );
    }
  }

  // ── Inbound capability request — insert into cross_requests for office review
  if (eventType === "capability.request") {
    const correlationId = (payload.correlationId ?? jti) as string;
    const capabilityId = payload.capabilityId as string | undefined;
    const summary = payload.summary as string | undefined;
    const requester = payload.requester as Record<string, unknown> | undefined;
    const sharedData = payload.sharedData as unknown;
    const externalRef = (payload.externalRef ?? payload.jti ?? jti) as string;

    if (!capabilityId) {
      logger.warn({ jti }, "falkon webhook: capability.request missing capabilityId — skipping");
    } else {
      // Resolve peerId from requester domain (best-effort)
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
               ${peerRow?.name ?? (requester?.businessName as string) ?? requesterDomain ?? 'Unknown'},
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

      logger.info({ jti, correlationId, capabilityId }, "falkon webhook: inbound capability.request stored for approval");
    }
  }

  // Mark event processed
  await db.execute(
    sql`UPDATE falkon_inbound_events
        SET processed = true, processed_at = now()
        WHERE jti = ${jti}`,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBaseUrl(req: import("express").Request): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}`;
  const host = req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  return `${proto}://${host}`;
}
