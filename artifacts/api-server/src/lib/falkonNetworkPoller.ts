/**
 * Falkon Network — Background poller.
 *
 * Runs two periodic jobs:
 *
 * 1. Peer health checker (every 15 min):
 *    Fetches each peer's trust document and capabilities list, updates health
 *    state, and writes an audit record whenever state changes.
 *
 * 2. Outbound cross-request delivery (every 30 s):
 *    Claims pending outbound requests with FOR UPDATE SKIP LOCKED, signs them
 *    with HALO's Ed25519 key, and POSTs to the peer's inbound endpoint.
 *    Exponential backoff on failure; max 5 attempts then marks dead.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sign as edSign, createHash } from "node:crypto";
import { getSigningKey } from "./falkonIdentity";
import { logger } from "./logger";
import { CLIENT_ID } from "./falkonGateway";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PEER_POLL_INTERVAL_MS = 15 * 60 * 1_000; // 15 min
const REQUEST_DELIVERY_INTERVAL_MS = 30_000;    // 30 s
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_DELIVERY_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Peer health checker
// ---------------------------------------------------------------------------

async function checkPeerHealth(peer: {
  id: string;
  name: string;
  domain: string;
  trustDocUrl: string;
  capabilitiesUrl: string;
  healthState: string;
}): Promise<void> {
  let newState: string;
  let trustDocData: unknown = null;
  let capabilitiesData: unknown = null;

  try {
    // 1. Fetch trust document
    const trustResp = await fetch(peer.trustDocUrl, {
      signal: AbortSignal.timeout(8_000),
      headers: { Accept: "application/json" },
    });

    if (!trustResp.ok) {
      newState = "degraded";
    } else {
      trustDocData = await trustResp.json().catch(() => null);

      // 2. Fetch capabilities (optional — degrade if fails, don't disconnect)
      try {
        const capResp = await fetch(peer.capabilitiesUrl, {
          signal: AbortSignal.timeout(6_000),
          headers: { Accept: "application/json" },
        });
        if (capResp.ok) {
          capabilitiesData = await capResp.json().catch(() => null);
        }
      } catch {
        // capabilities fetch failure → degrade, not disconnect
        newState = "degraded";
      }
      newState = newState! ?? "connected";
    }
  } catch {
    newState = "disconnected";
  }

  // Update the peer row
  await db.execute(
    sql`UPDATE falkon_peers
        SET health_state = ${newState},
            last_health_check_at = now(),
            trust_doc_data = ${trustDocData ? JSON.stringify(trustDocData) : null}::jsonb,
            capabilities_data = ${capabilitiesData ? JSON.stringify(capabilitiesData) : null}::jsonb,
            updated_at = now()
        WHERE id = ${peer.id}::uuid`,
  );

  // Write audit record if state changed
  if (newState !== peer.healthState) {
    await writeAuditLog({
      eventType: "peer.health_changed",
      actor: "system",
      entityType: "peer",
      entityId: peer.id,
      summary: `${peer.name} health changed: ${peer.healthState} → ${newState}`,
      payload: { domain: peer.domain, from: peer.healthState, to: newState },
    });
    logger.info(
      { peerId: peer.id, name: peer.name, from: peer.healthState, to: newState },
      "falkon network: peer health changed",
    );
  }
}

async function runPeerHealthChecks(): Promise<void> {
  try {
    const rows = await db.execute(
      sql`SELECT id, name, domain, trust_doc_url, capabilities_url, health_state
          FROM falkon_peers
          ORDER BY last_health_check_at ASC NULLS FIRST`,
    );
    const peers = ((rows as any).rows ?? rows) as Array<{
      id: string;
      name: string;
      domain: string;
      trust_doc_url: string;
      capabilities_url: string;
      health_state: string;
    }>;

    for (const peer of peers) {
      await checkPeerHealth({
        id: peer.id,
        name: peer.name,
        domain: peer.domain,
        trustDocUrl: peer.trust_doc_url,
        capabilitiesUrl: peer.capabilities_url,
        healthState: peer.health_state ?? "pending_peer",
      }).catch((err) =>
        logger.warn({ err, peerId: peer.id }, "falkon: peer health check error"),
      );
    }
  } catch (err) {
    logger.warn({ err }, "falkon: runPeerHealthChecks error");
  }
}

// ---------------------------------------------------------------------------
// Outbound cross-request delivery
// ---------------------------------------------------------------------------

function buildRequestSignature(timestampSec: number, bodyHash: string): string | null {
  const key = getSigningKey();
  if (!key) return null;
  const signingString = `${CLIENT_ID}.${timestampSec}.${bodyHash}`;
  const sigBuf = edSign(null, Buffer.from(signingString, "utf8"), key);
  return sigBuf.toString("base64");
}

async function deliverOutboundRequest(req: {
  id: string;
  peerId: string;
  peerDomain: string;
  peerInboundUrl: string;
  correlationId: string;
  capabilityId: string;
  summary: string;
  sharedDataSnapshot: unknown;
  requesterIdentity: unknown;
  attempts: number;
}): Promise<void> {
  const ts = Math.floor(Date.now() / 1000);
  const payload = {
    jti: req.id,
    correlationId: req.correlationId,
    capabilityId: req.capabilityId,
    summary: req.summary,
    sharedData: req.sharedDataSnapshot,
    requester: req.requesterIdentity,
    eventType: "capability.request",
    timestamp: ts,
  };
  const rawBody = JSON.stringify(payload);
  const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  const sig = buildRequestSignature(ts, bodyHash);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "HALO-Client-Id": CLIENT_ID,
    "HALO-Timestamp": String(ts),
    "Idempotency-Key": req.correlationId,
  };
  if (sig) headers["HALO-Signature"] = sig;

  const resp = await fetch(req.peerInboundUrl, {
    method: "POST",
    headers,
    body: rawBody,
    signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => String(resp.status));
    throw new Error(`Peer responded ${resp.status}: ${text.slice(0, 200)}`);
  }
}

async function runOutboundDelivery(): Promise<void> {
  try {
    // Claim one batch of pending outbound requests atomically
    const rows = await db.execute(
      sql`SELECT cr.id, cr.peer_id, cr.correlation_id, cr.capability_id,
                 cr.summary, cr.shared_data_snapshot, cr.requester_identity,
                 cr.attempts,
                 p.domain AS peer_domain,
                 p.trust_doc_url,
                 p.capabilities_url
          FROM falkon_cross_requests cr
          JOIN falkon_peers p ON p.id = cr.peer_id
          WHERE cr.direction = 'outbound'
            AND cr.approval_state = 'pending_delivery'
            AND cr.attempts < ${MAX_DELIVERY_ATTEMPTS}
          ORDER BY cr.created_at ASC
          LIMIT 10
          FOR UPDATE OF cr SKIP LOCKED`,
    );

    const requests = ((rows as any).rows ?? rows) as Array<{
      id: string;
      peer_id: string;
      correlation_id: string;
      capability_id: string;
      summary: string;
      shared_data_snapshot: unknown;
      requester_identity: unknown;
      attempts: number;
      peer_domain: string;
      trust_doc_url: string;
      capabilities_url: string;
    }>;

    for (const req of requests) {
      // Derive the peer's inbound endpoint from their trust doc URL or domain
      const baseUrl = req.trust_doc_url
        ? req.trust_doc_url.replace("/.well-known/falkon-trust.json", "")
        : `https://${req.peer_domain}`;
      const peerInboundUrl = `${baseUrl}/api/falkon/webhook`;

      try {
        await deliverOutboundRequest({
          id: req.id,
          peerId: req.peer_id,
          peerDomain: req.peer_domain,
          peerInboundUrl,
          correlationId: req.correlation_id,
          capabilityId: req.capability_id,
          summary: req.summary,
          sharedDataSnapshot: req.shared_data_snapshot,
          requesterIdentity: req.requester_identity,
          attempts: req.attempts,
        });

        // Success
        await db.execute(
          sql`UPDATE falkon_cross_requests
              SET approval_state = 'sent',
                  attempts = attempts + 1,
                  last_attempt_at = now(),
                  last_error = null,
                  updated_at = now(),
                  request_events = COALESCE(request_events, '[]'::jsonb)
                    || ${JSON.stringify([{ ts: Date.now(), event: "delivered", detail: "Sent to peer" }])}::jsonb
              WHERE id = ${req.id}::uuid`,
        );

        await writeAuditLog({
          eventType: "request.delivered",
          actor: "system",
          entityType: "cross_request",
          entityId: req.id,
          summary: `Outbound request delivered to peer ${req.peer_domain}`,
          payload: { correlationId: req.correlation_id, capabilityId: req.capability_id },
        });

        logger.info(
          { reqId: req.id, correlationId: req.correlation_id, peer: req.peer_domain },
          "falkon network: outbound request delivered",
        );
      } catch (err: any) {
        const attempts = req.attempts + 1;
        const isDead = attempts >= MAX_DELIVERY_ATTEMPTS;
        const backoffMs = Math.min(30_000 * Math.pow(2, attempts), 3_600_000);
        const nextRetryAt = new Date(Date.now() + backoffMs).toISOString();

        await db.execute(
          sql`UPDATE falkon_cross_requests
              SET attempts = ${attempts},
                  last_attempt_at = now(),
                  last_error = ${String(err?.message ?? err).slice(0, 500)},
                  approval_state = ${isDead ? "delivery_failed" : "pending_delivery"},
                  next_retry_at = ${isDead ? null : nextRetryAt}::timestamptz,
                  updated_at = now(),
                  request_events = COALESCE(request_events, '[]'::jsonb)
                    || ${JSON.stringify([{
                      ts: Date.now(),
                      event: "delivery_failed",
                      detail: String(err?.message ?? err).slice(0, 200),
                      attempt: attempts,
                    }])}::jsonb
              WHERE id = ${req.id}::uuid`,
        );

        logger.warn(
          { err, reqId: req.id, attempts, isDead },
          "falkon network: outbound request delivery failed",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "falkon: runOutboundDelivery error");
  }
}

// ---------------------------------------------------------------------------
// Audit log helper (shared with routes)
// ---------------------------------------------------------------------------

export async function writeAuditLog(entry: {
  eventType: string;
  actor: "office" | "system";
  entityType: string;
  entityId?: string;
  summary: string;
  payload?: unknown;
}): Promise<void> {
  try {
    await db.execute(
      sql`INSERT INTO falkon_audit_log
            (id, event_type, actor, entity_type, entity_id, summary, payload, created_at)
          VALUES
            (gen_random_uuid(), ${entry.eventType}, ${entry.actor},
             ${entry.entityType}, ${entry.entityId ?? null},
             ${entry.summary},
             ${entry.payload ? JSON.stringify(entry.payload) : null}::jsonb,
             now())`,
    );
  } catch (err) {
    logger.warn({ err }, "falkon: writeAuditLog failed silently");
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function startFalkonNetworkPoller(): void {
  // Initial checks immediately on startup
  setTimeout(() => {
    void runPeerHealthChecks().catch((e) =>
      logger.warn({ e }, "falkon: initial peer health check failed"),
    );
  }, 5_000); // slight delay to let server fully start

  // Periodic peer health poll
  setInterval(() => {
    void runPeerHealthChecks().catch((e) =>
      logger.warn({ e }, "falkon: peer health poll failed"),
    );
  }, PEER_POLL_INTERVAL_MS);

  // Outbound request delivery loop
  setInterval(() => {
    void runOutboundDelivery().catch((e) =>
      logger.warn({ e }, "falkon: outbound delivery loop failed"),
    );
  }, REQUEST_DELIVERY_INTERVAL_MS);

  logger.info("falkon: network poller started");
}
