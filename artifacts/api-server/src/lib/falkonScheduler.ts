/**
 * Falkon Ops — outbox delivery sweep.
 *
 * Called every scheduler tick. Picks up to 10 pending falkon_events whose
 * nextRetryAt <= now and delivers each using Ed25519 canonical signing
 * (Falkon enterprise contract). Falls back to HMAC-SHA256 only when the
 * Ed25519 private key is unavailable AND a webhookSecret is configured
 * (transition period only).
 *
 * Delivery URL priority:
 *   1. conn.eventIngestUrl  — Falkon's event-ingestion endpoint (preferred)
 *   2. conn.webhookUrl      — partner webhook fallback
 *
 * Ed25519 delivery headers (Falkon canonical):
 *   X-Falkon-Client-Id:  fk_archangel_halo_prod
 *   X-Falkon-Timestamp:  <epoch ms>
 *   X-Falkon-Nonce:      <uuid>
 *   X-Falkon-Signature:  <ed25519 base64url-no-padding>
 *
 * HMAC fallback headers (deprecated, removal planned):
 *   X-Falkon-Timestamp:  <epoch ms>
 *   X-Falkon-Signature:  v1=<hmac-sha256-hex>
 *
 * Backoff:  doubles per attempt, base 30 s, cap 4 h.
 * Dead-letter: after 5 attempts status → "dead", visible in admin UI.
 */

import { and, eq, lte } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { createHash, sign as edSign } from "node:crypto";
import { db } from "@workspace/db";
import { falkonConnectionsTable, falkonEventsTable } from "@workspace/db/schema";
import { buildFalkonHmacSignature } from "./falkonEmit";
import { getSigningKey } from "./falkonIdentity";
import { CLIENT_ID } from "./falkonGateway";
import { logger } from "./logger";
import { sql } from "drizzle-orm";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30 s
const MAX_BACKOFF_MS = 4 * 3600_000; // 4 h

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts), MAX_BACKOFF_MS);
}

// ---------------------------------------------------------------------------
// Ed25519 delivery signing
// ---------------------------------------------------------------------------

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function base64urlNopad(buf: Buffer): string {
  return buf.toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Build X-Falkon-Signature for outbox delivery using Ed25519.
 * Returns null if the private key is not available (falls back to HMAC).
 */
function buildEd25519Signature(
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
    return null;
  }
}

// ---------------------------------------------------------------------------
// Outbox delivery sweep
// ---------------------------------------------------------------------------

export async function deliverFalkonOutbox(): Promise<void> {
  try {
    // Fast-path: skip if no connection or mode is OFF
    const [conn] = await db
      .select({
        webhookUrl: falkonConnectionsTable.webhookUrl,
        webhookSecret: falkonConnectionsTable.webhookSecret,
        eventIngestUrl: (falkonConnectionsTable as any).eventIngestUrl,
        mode: falkonConnectionsTable.mode,
      })
      .from(falkonConnectionsTable)
      .limit(1);

    if (!conn || conn.mode === "OFF") return;

    const deliveryUrl =
      (conn as any).eventIngestUrl ?? conn.webhookUrl;

    if (!deliveryUrl) return;

    const now = new Date();
    const pending = await db
      .select()
      .from(falkonEventsTable)
      .where(
        and(
          eq(falkonEventsTable.status, "pending"),
          lte(falkonEventsTable.nextRetryAt, now),
        ),
      )
      .limit(10);

    if (pending.length === 0) return;

    for (const event of pending) {
      const body: Record<string, unknown> = {
        id: event.id, // idempotency key — stable across retries
        eventType: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        payload: event.payload,
        mode: event.mode,
        createdAt: event.createdAt,
        _schema: "halo-falkon/v2",
      };
      const rawBody = JSON.stringify(body);
      const timestampMs = Date.now();
      const nonce = randomUUID();
      const bodyHash = sha256hex(rawBody);
      const ed25519Sig = buildEd25519Signature(timestampMs, nonce, bodyHash);

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Falkon-Client-Id": CLIENT_ID,
        "X-Falkon-Timestamp": String(timestampMs),
        "X-Falkon-Nonce": nonce,
      };

      if (ed25519Sig) {
        // Primary: Ed25519 canonical signing
        headers["X-Falkon-Signature"] = ed25519Sig;
      } else if (conn.webhookSecret) {
        // Fallback: HMAC-SHA256 (transition only — remove when all partners upgrade)
        headers["X-Falkon-Signature"] = buildFalkonHmacSignature(
          conn.webhookSecret,
          timestampMs,
          rawBody,
        );
        logger.warn({ eventId: event.id }, "falkon: using HMAC fallback for delivery (Ed25519 key unavailable)");
      }

      try {
        const resp = await fetch(deliveryUrl, {
          method: "POST",
          headers,
          body: rawBody,
          signal: AbortSignal.timeout(10_000),
        });

        if (resp.ok) {
          await db
            .update(falkonEventsTable)
            .set({ status: "delivered", deliveredAt: new Date(), error: null })
            .where(eq(falkonEventsTable.id, event.id));
        } else {
          const errText = await resp.text().catch(() => String(resp.status));
          await markFailed(event.id, event.attempts, `HTTP ${resp.status}: ${errText.slice(0, 200)}`);
        }
      } catch (err: any) {
        await markFailed(event.id, event.attempts, String(err?.message ?? err).slice(0, 200));
      }
    }
  } catch (err) {
    logger.warn({ err }, "falkon: deliverFalkonOutbox sweep failed");
  }
}

// ---------------------------------------------------------------------------
// Nonce purge — remove expired replay-prevention nonces
// ---------------------------------------------------------------------------

export async function purgeExpiredNonces(): Promise<void> {
  try {
    await db.execute(
      sql`DELETE FROM falkon_webhook_nonces WHERE expires_at < now()`,
    );
  } catch {
    /* silent — table may not exist on first start */
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function markFailed(id: string, currentAttempts: number, error: string) {
  const attempts = currentAttempts + 1;
  const isDead = attempts >= MAX_ATTEMPTS;
  await db
    .update(falkonEventsTable)
    .set({
      status: isDead ? "dead" : "failed",
      attempts,
      error,
      nextRetryAt: new Date(Date.now() + backoffMs(attempts)),
    })
    .where(eq(falkonEventsTable.id, id));
}
