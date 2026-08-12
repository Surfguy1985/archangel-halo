/**
 * Falkon Ops — outbox delivery sweep.
 *
 * Called every scheduler tick. Picks up to 10 pending falkon_events whose
 * nextRetryAt <= now, POSTs each to the configured webhook URL with an
 * HMAC-SHA256 signature, and updates status to delivered or failed/dead.
 *
 * Exponential backoff: delay doubles per attempt (base 30s), capped at 4h.
 * Dead after 5 failed attempts.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { falkonConnectionsTable, falkonEventsTable } from "@workspace/db/schema";
import { buildFalkonSignature } from "./falkonEmit";
import { logger } from "./logger";

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30 s
const MAX_BACKOFF_MS = 4 * 3600_000; // 4 h

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts), MAX_BACKOFF_MS);
}

export async function deliverFalkonOutbox(): Promise<void> {
  try {
    // Fast-path: skip if no connection or mode is OFF
    const [conn] = await db
      .select({
        webhookUrl: falkonConnectionsTable.webhookUrl,
        webhookSecret: falkonConnectionsTable.webhookSecret,
        mode: falkonConnectionsTable.mode,
      })
      .from(falkonConnectionsTable)
      .limit(1);

    if (!conn || conn.mode === "OFF" || !conn.webhookUrl || !conn.webhookSecret) {
      return;
    }

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
      const ts = Math.floor(Date.now() / 1000);
      const body = JSON.stringify({
        id: event.id,
        event: event.eventType,
        entityType: event.entityType,
        entityId: event.entityId,
        payload: event.payload,
        mode: event.mode,
        createdAt: event.createdAt,
      });
      const sig = buildFalkonSignature(conn.webhookSecret, ts, body);

      try {
        const resp = await fetch(conn.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "HALO-Timestamp": String(ts),
            "HALO-Signature": sig,
            "HALO-Event": event.eventType,
          },
          body,
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
