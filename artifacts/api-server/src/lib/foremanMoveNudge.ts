import { and, eq, isNull, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewDispatchAssignmentsTable,
  jobsTable,
} from "@workspace/db";
import { smsEnabled, sendSms } from "./sms";
import { sendEmail } from "./email";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Foreman move-approval reminder
//
// When the office requests a crew-member move, the foreman gets a one-time
// ping from the move endpoint. If they miss it, the move can stall all day.
// This sweep runs every 15 minutes and sends ONE reminder (SMS first, email
// fallback) for any move still in `pending_move` status at least 2 hours
// after it was requested, and for which no reminder has been sent yet.
//
// Dedupe: `moveReminderSentAt` is atomically claimed (guarded UPDATE where
// moveReminderSentAt IS NULL) BEFORE the send, so overlapping sweeps can
// never double-send. If the send fails, the claim is released so the next
// sweep retries. Approve or decline resolves the move and clears the column,
// so resolved moves are never re-notified.
// ---------------------------------------------------------------------------

/** How long after moveRequestedAt before we send the reminder. */
const NUDGE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function portalUrl(token: string): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}/portal/${token}` : "";
}

function jobShortNo(j: { jobNo: string } | undefined): string {
  return j?.jobNo ?? "(unknown)";
}

/** Send a best-effort nudge to one foreman. Never throws. */
async function nudgeForeman(opts: {
  leaderId: string;
  memberName: string;
  fromJobNo: string;
  toJobNo: string;
  day: string;
}): Promise<boolean> {
  try {
    const [leader] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, opts.leaderId));
    if (!leader) return false;

    const url = leader.portalToken ? portalUrl(leader.portalToken) : "";
    const body =
      `Reminder: move still waiting on your approval — ` +
      `${opts.memberName} from job ${opts.fromJobNo} to job ${opts.toJobNo} (${opts.day}). ` +
      `Open your crew portal to approve or decline.`;

    if (leader.phone && (await smsEnabled())) {
      const result = await sendSms(leader.phone, url ? `${body} ${url}` : body);
      if (result.ok) return true;
      logger.warn({ error: result.error }, "foreman move-nudge sms failed");
    }
    if (leader.email) {
      const emailResult = await sendEmail({
        to: leader.email,
        subject: `Reminder: move approval needed for ${opts.memberName}`,
        html: `<p>${body}</p>${url ? `<p><a href="${url}">Open your crew portal</a></p>` : ""}`,
      });
      if (!emailResult.ok) {
        logger.warn({ error: emailResult.error }, "foreman move-nudge email failed");
      }
      return emailResult.ok;
    }
    return false;
  } catch (err) {
    logger.warn({ err }, "foreman move-nudge notification failed");
    return false;
  }
}

/** In-process mutex — never run two sweeps concurrently. */
let running = false;

/**
 * Sweep for stale pending_move rows. Called by the scheduler every
 * FOREMAN_NUDGE_CHECK_MS (15 minutes). Never throws.
 */
export async function nudgeStaleForemanMoves(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const threshold = new Date(Date.now() - NUDGE_THRESHOLD_MS);

    // Find all pending_move rows old enough that haven't been reminded yet.
    // We also need the member name and both job numbers, so fetch in bulk.
    const stale = await db
      .select({
        id: crewDispatchAssignmentsTable.id,
        memberId: crewDispatchAssignmentsTable.memberId,
        day: crewDispatchAssignmentsTable.day,
        jobId: crewDispatchAssignmentsTable.jobId,
        pendingJobId: crewDispatchAssignmentsTable.pendingJobId,
        moveRequestedAt: crewDispatchAssignmentsTable.moveRequestedAt,
      })
      .from(crewDispatchAssignmentsTable)
      .where(
        and(
          eq(crewDispatchAssignmentsTable.status, "pending_move"),
          isNotNull(crewDispatchAssignmentsTable.pendingJobId),
          isNull(crewDispatchAssignmentsTable.moveReminderSentAt),
          lte(crewDispatchAssignmentsTable.moveRequestedAt, threshold),
        ),
      );

    if (stale.length === 0) return;

    // Collect unique job IDs we need labels for.
    const jobIds = new Set<string>();
    const memberIds = new Set<string>();
    for (const row of stale) {
      jobIds.add(row.jobId);
      if (row.pendingJobId) jobIds.add(row.pendingJobId);
      memberIds.add(row.memberId);
    }

    const [jobs, members] = await Promise.all([
      db
        .select({ id: jobsTable.id, jobNo: jobsTable.jobNo })
        .from(jobsTable)
        .where(
          sql`${jobsTable.id} = ANY(${[...jobIds]})`,
        ),
      db
        .select({
          id: crewsTable.id,
          name: crewsTable.name,
          leaderId: crewsTable.leaderId,
        })
        .from(crewsTable)
        .where(
          sql`${crewsTable.id} = ANY(${[...memberIds]})`,
        ),
    ]);

    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const memberById = new Map(members.map((m) => [m.id, m]));

    for (const row of stale) {
      const member = memberById.get(row.memberId);
      if (!member?.leaderId) continue; // no foreman — shouldn't happen, but skip

      // Atomically claim: set moveReminderSentAt where it is still NULL.
      // If another process beat us, the update returns 0 rows → skip.
      const claimed = await db
        .update(crewDispatchAssignmentsTable)
        .set({ moveReminderSentAt: new Date() })
        .where(
          and(
            eq(crewDispatchAssignmentsTable.id, row.id),
            eq(crewDispatchAssignmentsTable.status, "pending_move"),
            isNull(crewDispatchAssignmentsTable.moveReminderSentAt),
          ),
        )
        .returning({ id: crewDispatchAssignmentsTable.id });

      if (claimed.length === 0) continue; // already claimed by another sweep

      const fromJobNo = jobShortNo(jobById.get(row.jobId));
      const toJobNo = row.pendingJobId
        ? jobShortNo(jobById.get(row.pendingJobId))
        : "(unknown)";

      const sent = await nudgeForeman({
        leaderId: member.leaderId,
        memberName: member.name,
        fromJobNo,
        toJobNo,
        day: row.day,
      });

      if (!sent) {
        // Release claim so the next sweep retries.
        await db
          .update(crewDispatchAssignmentsTable)
          .set({ moveReminderSentAt: null })
          .where(eq(crewDispatchAssignmentsTable.id, row.id));
        logger.warn(
          { assignmentId: row.id },
          "foreman move-nudge send failed; claim released for retry",
        );
      } else {
        logger.info(
          { assignmentId: row.id, leaderId: member.leaderId },
          "foreman move-approval reminder sent",
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "nudgeStaleForemanMoves sweep failed");
  } finally {
    running = false;
  }
}
