import { and, eq, lte } from "drizzle-orm";
import {
  db,
  emergencyPingsTable,
  emergencyPingTargetsTable,
  crewsTable,
  jobsTable,
  propertiesTable,
  activitiesTable,
  notificationsTable,
} from "@workspace/db";
import { smsEnabled, sendSms } from "./sms";
import { logger } from "./logger";

/**
 * Sweep: flip open emergency pings past their deadline to cancelled
 * (stamping expiredAt), mark still-pending crews "expired", and notify the
 * office that no one committed. No hold exists on an open ping, so nothing
 * has to be returned.
 *
 * Safe to call from anywhere (scheduler tick + lazy commit-path guard) —
 * the flip is a guarded UPDATE, so concurrent sweeps or a racing commit
 * settle to exactly one outcome.
 */
export async function expireOverdueEmergencyPings(): Promise<void> {
  const now = new Date();
  const overdue = await db
    .select()
    .from(emergencyPingsTable)
    .where(
      and(
        eq(emergencyPingsTable.status, "open"),
        lte(emergencyPingsTable.expiresAt, now),
      ),
    );

  for (const ping of overdue) {
    try {
      const result = await db.transaction(async (tx) => {
        // Guarded flip: only expire a ping that is still open. A commit that
        // won the race keeps the ping (its own guard already checked the
        // deadline before flipping open -> filled).
        const expired = await tx
          .update(emergencyPingsTable)
          .set({ status: "cancelled", cancelledAt: now, expiredAt: now })
          .where(
            and(
              eq(emergencyPingsTable.id, ping.id),
              eq(emergencyPingsTable.status, "open"),
            ),
          )
          .returning();
        if (expired.length === 0) return null;
        const pendingTargets = await tx
          .update(emergencyPingTargetsTable)
          .set({ status: "expired", respondedAt: now })
          .where(
            and(
              eq(emergencyPingTargetsTable.pingId, ping.id),
              eq(emergencyPingTargetsTable.status, "pending"),
            ),
          )
          .returning();
        return { pendingTargets };
      });
      if (!result) continue;

      const [job] = await db
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, ping.jobId));
      const [prop] = job
        ? await db
            .select()
            .from(propertiesTable)
            .where(eq(propertiesTable.id, job.propertyId))
        : [];
      const jobLabel = job
        ? [job.jobNo, job.category].filter(Boolean).join(" · ")
        : "job";

      await db.insert(activitiesTable).values({
        entityType: "job",
        entityId: ping.jobId,
        kind: "note",
        body: `Emergency ping expired — no one committed before the deadline. Pending crews were notified.`,
      });
      await db.insert(notificationsTable).values({
        kind: "emergency_ping_expired",
        priority: "urgent",
        entityType: "job",
        entityId: ping.jobId,
        title: `Emergency ping expired — no one committed (${jobLabel})`,
        body: `The offer to ${result.pendingTargets.length} pending crew${result.pendingTargets.length === 1 ? "" : "s"} expired. Re-ping with a bigger bonus or staff the job manually.`,
      });

      // Best-effort SMS to crews who never answered — never fails the sweep.
      if (result.pendingTargets.length > 0 && (await smsEnabled())) {
        const propLabel = [prop?.name, prop?.address]
          .filter(Boolean)
          .join(", ");
        for (const t of result.pendingTargets) {
          const [crew] = await db
            .select()
            .from(crewsTable)
            .where(eq(crewsTable.id, t.crewId));
          if (!crew?.phone) continue;
          await sendSms(
            crew.phone,
            `The emergency offer for ${propLabel || "the property"} has expired and can no longer be accepted.`,
          );
        }
      }

      logger.info(
        { pingId: ping.id, jobId: ping.jobId, pending: result.pendingTargets.length },
        "emergency ping expired",
      );
    } catch (err) {
      logger.warn({ err, pingId: ping.id }, "emergency ping expiry failed");
    }
  }
}
