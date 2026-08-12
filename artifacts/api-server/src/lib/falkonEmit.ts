/**
 * Falkon Ops — outbound event emission library.
 *
 * Called from HALO route handlers after a successful DB commit.
 * All functions are fire-and-forget: they never throw, so a Falkon
 * delivery problem can never break a HALO request.
 *
 * Delivery is asynchronous via the falkon_events outbox table.
 * The scheduler tick (lib/scheduler.ts) picks up pending rows and POSTs
 * HMAC-signed callbacks to falkon_connections.webhook_url.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  falkonEventsTable,
} from "@workspace/db/schema";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FalkonEventType =
  | "job.created"
  | "job.assigned"
  | "job.checked_in"
  | "job.walk_submitted"
  | "job.walk_approved"
  | "job.invoiced"
  | "job.paid"
  | "job.crew_paid"
  | "job.closed"
  | "job.change_order"
  | "evidence.captured"
  | "unit.status_changed"
  | "property.updated"
  | "crew.checked_in"
  | "ping";

export type FalkonEntityType =
  | "job"
  | "property"
  | "unit"
  | "crew"
  | "invoice"
  | "system";

// ---------------------------------------------------------------------------
// Core emit — writes to outbox, never throws
// ---------------------------------------------------------------------------

/**
 * Queue a Falkon event for signed delivery.
 *
 * No-ops when:
 *   - no falkon_connections row exists
 *   - mode is "OFF"
 *
 * Must be called *after* the primary DB mutation succeeds to avoid ghost
 * events from rolled-back transactions.
 */
export async function emitFalkonEvent(
  eventType: FalkonEventType,
  entityType: FalkonEntityType,
  entityId: string | null,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    const [conn] = await db
      .select({ mode: falkonConnectionsTable.mode })
      .from(falkonConnectionsTable)
      .limit(1);

    if (!conn || conn.mode === "OFF") return;

    await db.insert(falkonEventsTable).values({
      eventType,
      entityType,
      // entityId column is uuid type — only pass if it looks like a UUID
      entityId:
        entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : undefined,
      payload: { ...payload, _ts: new Date().toISOString() },
      mode: conn.mode,
      status: "pending",
      attempts: 0,
      nextRetryAt: new Date(),
    });
  } catch (err) {
    logger.warn(
      { err, eventType, entityType, entityId },
      "falkon: emitFalkonEvent failed silently",
    );
  }
}

// ---------------------------------------------------------------------------
// HMAC signing — used by the scheduler when delivering outbox rows
// ---------------------------------------------------------------------------

/**
 * Produce the HALO-Signature header value for an outbound Falkon callback.
 *
 * Signature scheme (follows Stripe webhook pattern):
 *   HALO-Timestamp: <unix seconds>
 *   HALO-Signature: v1=<hmac-sha256(secret, "<ts>.<rawBody>")>
 *
 * Falkon verifies on receipt. Replay window: ±300 s on timestamp.
 */
export function buildFalkonSignature(
  secret: string,
  timestampSec: number,
  rawBody: string,
): string {
  const msg = `${timestampSec}.${rawBody}`;
  const sig = createHmac("sha256", secret).update(msg).digest("hex");
  return `v1=${sig}`;
}

/**
 * Verify an inbound Falkon → HALO request signature.
 *
 * Returns true only when the signature is valid and the timestamp is within
 * 300 seconds of now (replay protection).
 */
export function verifyFalkonSignature(
  secret: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
  rawBody: string,
): boolean {
  if (!timestampHeader || !signatureHeader) return false;
  const ts = parseInt(timestampHeader, 10);
  if (isNaN(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > 300) return false;

  const expected = buildFalkonSignature(secret, ts, rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signatureHeader, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
