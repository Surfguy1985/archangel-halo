import { computeQueues } from "./queues";
import {
  sendDailyDigest,
  sendUrgentAlert,
  sendEveningClose,
  sendWeeklyScorecard,
  urgentSignature,
} from "./notifications";
import { campaignByKind } from "./leadTemplates";
import { runAutopilot } from "./autopilot";
import { runReconciliation } from "./financialReconciliation";
import { runContinuousAgents } from "./haloCommandAgents";
import { runBase44Sync } from "./base44Sync";
import { sendClientCardDigests } from "./clientCardDigest";
import { expireOverdueEmergencyPings } from "./emergencyExpiry";
import { runWingsAutomation } from "../wings/services/automation";
import { sendCampaignStepEmail } from "../routes/pipeline";
import { getAutoEmails } from "./emailPolicy";
import { logger } from "./logger";
import { deliverFalkonOutbox, purgeExpiredNonces } from "./falkonScheduler";
import { nudgeStaleForemanMoves } from "./foremanMoveNudge";
import { runScheduledEodBriefing } from "./eodBriefing";
import { and, eq, lte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, leadCampaignsTable, leadsTable, remindersTable, dateTimePartsInZone } from "@workspace/db";
import { isClientBoardSegmentEnabled } from "./clientBoardFlags";
import { deliverClientTurnOutbox, recomputeOpenTurnPredictions } from "./turnEngine";

const DAILY_HOUR = 6;
const DAILY_MINUTE = 45;
const CLOSE_HOUR = 18;
const CLOSE_MINUTE = 30;
const WEEKLY_HOUR = 7;
const WEEKLY_MINUTE = 0;
const WEEKLY_DOW = 1; // Monday
const TICK_MS = 60 * 1000;
const URGENT_CHECK_MS = 15 * 60 * 1000;
const AUTOPILOT_CHECK_MS = 15 * 60 * 1000;
const RECON_CHECK_MS = 5 * 60 * 1000;
const AGENTS_CHECK_MS = 5 * 60 * 1000;
const BASE44_SYNC_MS = 30 * 1000; // SoR projection pull (~30s). Not a HALO mutation; not ASSISTED-gated.

let lastDailyDate: string | null = null;
let lastCloseDate: string | null = null;
let lastBriefingDate: string | null = null;
let lastWeeklyDate: string | null = null;
const lastTurnPredictByZone = new Map<string, string>();
const TURN_PREDICT_HOUR = 1;
const TURN_PREDICT_MINUTE = 15;
let lastUrgentSignature = "";
let lastUrgentCheck = 0;
let lastAutopilotCheck = 0;
let lastReconCheck = 0;
let lastAgentsCheck = 0;
const WINGS_CHECK_MS = 15 * 60 * 1000;
let lastWingsCheck = 0;
let lastBase44Sync = 0;
const NONCE_PURGE_MS = 15 * 60 * 1000;
let lastNoncePurge = 0;
// New-card digests to clients: at most one email per account per hour.
const CLIENT_CARD_DIGEST_MS = 60 * 60 * 1000;
let lastClientCardDigest = 0;

const FOREMAN_NUDGE_MS = 15 * 60 * 1000;
let lastWingsBriefDate: string | null = null;

const REMINDER_CHECK_MS = 15 * 60 * 1000;
function nowInEastern(): {
  date: string;
  hour: number;
  minute: number;
  dow: number;
} {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    dow: dowMap[parts.weekday as string] ?? -1,
  };
}

let campaignProcessingRunning = false;

async function processDueCampaignSteps(): Promise<void> {
  // Check the live DB setting so the owner's toggle takes effect immediately.
  // Campaign rows are left intact (status/nextSendAt untouched) so re-enabling
  // the toggle resumes processing where it left off.
  const policy = await getAutoEmails();
  if (!policy.leadNurtureDrip) return;
  // Re-entry guard: never let overlapping ticks process campaigns at once.
  if (campaignProcessingRunning) return;
  campaignProcessingRunning = true;
  try {
    await processDueCampaignStepsInner();
  } finally {
    campaignProcessingRunning = false;
  }
}

async function processDueCampaignStepsInner(): Promise<void> {
  const due = await db
    .select()
    .from(leadCampaignsTable)
    .where(
      and(
        eq(leadCampaignsTable.status, "active"),
        isNotNull(leadCampaignsTable.nextSendAt),
        lte(leadCampaignsTable.nextSendAt, new Date()),
      ),
    );
  for (const campaign of due) {
    // Atomically claim the row by pushing nextSendAt out 30 minutes. If
    // another worker (or the start endpoint) already advanced/claimed it,
    // the guarded update matches nothing and we skip — no double sends.
    const claimed = await db
      .update(leadCampaignsTable)
      .set({ nextSendAt: new Date(Date.now() + 30 * 60 * 1000) })
      .where(
        and(
          eq(leadCampaignsTable.id, campaign.id),
          eq(leadCampaignsTable.status, "active"),
          eq(leadCampaignsTable.stepIndex, campaign.stepIndex),
          eq(leadCampaignsTable.nextSendAt, campaign.nextSendAt!),
        ),
      )
      .returning();
    if (!claimed.length) continue;
    const def = campaignByKind(campaign.kind);
    if (!def) {
      await db
        .update(leadCampaignsTable)
        .set({ status: "stopped", nextSendAt: null })
        .where(eq(leadCampaignsTable.id, campaign.id));
      continue;
    }
    const step = def.steps[campaign.stepIndex];
    if (!step) {
      await db
        .update(leadCampaignsTable)
        .set({ status: "completed", nextSendAt: null, completedAt: new Date() })
        .where(eq(leadCampaignsTable.id, campaign.id));
      continue;
    }
    const [lead] = await db
      .select()
      .from(leadsTable)
      .where(eq(leadsTable.id, campaign.leadId));
    if (!lead || lead.status === "converted" || lead.status === "dead") {
      await db
        .update(leadCampaignsTable)
        .set({ status: "stopped", nextSendAt: null })
        .where(eq(leadCampaignsTable.id, campaign.id));
      continue;
    }
    const result = await sendCampaignStepEmail(lead, step.templateKey);
    if (!result.sent) {
      // Missing recipient/unknown template will never succeed — stop the
      // campaign. Transient email failures retry on the next tick via a
      // pushed-out nextSendAt.
      if (result.to === null || result.error === "Unknown template") {
        logger.warn(
          { campaignId: campaign.id, leadId: lead.id, error: result.error },
          "Stopping lead campaign: unrecoverable send failure",
        );
        await db
          .update(leadCampaignsTable)
          .set({ status: "stopped", nextSendAt: null })
          .where(eq(leadCampaignsTable.id, campaign.id));
      } else {
        logger.warn(
          { campaignId: campaign.id, leadId: lead.id, error: result.error },
          "Lead campaign send failed; retrying in 30 minutes",
        );
        await db
          .update(leadCampaignsTable)
          .set({ nextSendAt: new Date(Date.now() + 30 * 60 * 1000) })
          .where(eq(leadCampaignsTable.id, campaign.id));
      }
      continue;
    }
    const nextIndex = campaign.stepIndex + 1;
    const nextStep = def.steps[nextIndex];
    if (nextStep) {
      const base = campaign.startedAt ?? new Date();
      await db
        .update(leadCampaignsTable)
        .set({
          stepIndex: nextIndex,
          nextSendAt: new Date(
            base.getTime() + nextStep.dayOffset * 24 * 60 * 60 * 1000,
          ),
        })
        .where(eq(leadCampaignsTable.id, campaign.id));
    } else {
      await db
        .update(leadCampaignsTable)
        .set({
          stepIndex: nextIndex,
          status: "completed",
          nextSendAt: null,
          completedAt: new Date(),
        })
        .where(eq(leadCampaignsTable.id, campaign.id));
    }
    logger.info(
      { campaignId: campaign.id, leadId: lead.id, template: step.templateKey },
      "Lead campaign step sent",
    );
  }
}

async function tick(): Promise<void> {
  const { date, hour, minute, dow } = nowInEastern();

  try {
    await processDueCampaignSteps();
  } catch (err) {
    logger.warn({ err }, "Lead campaign processing failed");
  }

  // Read the live email policy once per tick so toggle changes take effect
  // on the next scheduler tick (≤60 s) without a server restart.
  let tickPolicy: Awaited<ReturnType<typeof getAutoEmails>>;
  try {
    tickPolicy = await getAutoEmails();
  } catch (err) {
    logger.warn({ err }, "Failed to read auto-email policy; skipping scheduled emails this tick");
    tickPolicy = { dailyDigest: false, eveningClose: false, leadNurtureDrip: false, autoJobRecapLinks: false, crewThankYou: false, inquiryAutoReply: false };
  }

  if (
    tickPolicy.dailyDigest &&
    hour === DAILY_HOUR &&
    minute >= DAILY_MINUTE &&
    lastDailyDate !== date
  ) {
    try {
      const { sent } = await sendDailyDigest();
      if (sent) lastDailyDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled daily digest failed");
    }
  }

  if (
    tickPolicy.eveningClose &&
    hour === CLOSE_HOUR &&
    minute >= CLOSE_MINUTE &&
    lastBriefingDate !== date
  ) {
    try {
      await runScheduledEodBriefing();
      lastBriefingDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled EOD briefing failed");
    }
  }

  if (
    tickPolicy.eveningClose &&
    hour === CLOSE_HOUR &&
    minute >= CLOSE_MINUTE &&
    lastCloseDate !== date
  ) {
    try {
      const { sent } = await sendEveningClose();
      if (sent) lastCloseDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled evening close failed");
    }
  }

  if (
    dow === WEEKLY_DOW &&
    hour === WEEKLY_HOUR &&
    minute >= WEEKLY_MINUTE &&
    lastWeeklyDate !== date
  ) {
    try {
      const { sent } = await sendWeeklyScorecard();
      if (sent) lastWeeklyDate = date;
    } catch (err) {
      logger.warn({ err }, "Scheduled weekly scorecard failed");
    }
  }

  try {
    if (await isClientBoardSegmentEnabled("turnEngine")) {
      await deliverClientTurnOutbox();
      const zones = await db.execute(
        sql`SELECT DISTINCT timezone AS tz FROM properties WHERE client_org_id IS NOT NULL AND timezone IS NOT NULL`,
      );
      const zoneRows = ((zones as unknown as { rows?: { tz: string }[] }).rows ?? []);
      const now = new Date();
      for (const row of zoneRows) {
        const tz = row.tz;
        const parts = dateTimePartsInZone(now, tz);
        const zoneDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
        if (
          parts.hour === TURN_PREDICT_HOUR &&
          parts.minute >= TURN_PREDICT_MINUTE &&
          lastTurnPredictByZone.get(tz) !== zoneDate
        ) {
          const n = await recomputeOpenTurnPredictions({ now, timezone: tz });
          lastTurnPredictByZone.set(tz, zoneDate);
          logger.info({ n, timezone: tz }, "client-board: nightly ready-date recompute");
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, "client-board: outbox / nightly recompute failed");
  }

  try {
    if (await isClientBoardSegmentEnabled("csvImport")) {
      const { sweepEntrataDropFolder } = await import("./entrataCsvAdapter");
      const n = await sweepEntrataDropFolder();
      if (n > 0) logger.info({ n }, "client-board: Entrata drop-folder import");
    }
  } catch (err) {
    logger.warn({ err }, "client-board: Entrata drop-folder sweep failed");
  }

  try {
    if (await isClientBoardSegmentEnabled("security")) {
      const { tombstoneExpiredEvidence } = await import("./clientBoardRepo");
      const n = await tombstoneExpiredEvidence();
      if (n > 0) logger.info({ n }, "client-board: evidence retention tombstone");
    }
  } catch (err) {
    logger.warn({ err }, "client-board: evidence retention sweep failed");
  }

  const stamp = Date.now();

  // Every tick (1 min): expire stale emergency pings so an old offer can't
  // be accepted hours later. Never throws; failures are logged per ping.
  try {
    await expireOverdueEmergencyPings();
  } catch (err) {
    logger.warn({ err }, "Emergency ping expiry sweep failed");
  }

  // Every tick: deliver any pending Falkon outbox events. No-ops when mode
  // is OFF or no connection is configured. Never throws.
  try {
    await deliverFalkonOutbox();
  } catch (err) {
    logger.warn({ err }, "Falkon outbox delivery sweep failed");
  }

  // Every ~15 min: purge expired replay-prevention nonces.
  if (stamp - lastNoncePurge >= NONCE_PURGE_MS) {
    lastNoncePurge = stamp;
    purgeExpiredNonces().catch((err) =>
      logger.warn({ err }, "Falkon nonce purge failed"),
    );
  }

  if (stamp - lastAutopilotCheck >= AUTOPILOT_CHECK_MS) {
    lastAutopilotCheck = stamp;
    // runAutopilot never throws; it checks the settings toggle itself.
    await runAutopilot();
  }

  if (stamp - lastReconCheck >= RECON_CHECK_MS) {
    lastReconCheck = stamp;
    try {
      const result = await runReconciliation("scheduler");
      if (result.discrepanciesFound > 0) logger.info({ ...result }, "Scheduled reconciliation found discrepancies");
    } catch (err) { logger.warn({ err }, "Scheduled reconciliation failed"); }
  }
  if (stamp - lastAgentsCheck >= AGENTS_CHECK_MS) {
    lastAgentsCheck = stamp;
    try { await runContinuousAgents("scheduler"); }
    catch (err) { logger.warn({ err }, "HaloCommand agents cycle failed"); }
  }

  if (stamp - lastBase44Sync >= BASE44_SYNC_MS) {
    lastBase44Sync = stamp;
    runBase44Sync().catch((err) =>
      logger.warn({ err }, "base44 scheduled sync failed"),
    );
  }

  if (stamp - lastWingsCheck >= WINGS_CHECK_MS) {
    lastWingsCheck = stamp;
    try {
      // Daily brief once a day at/after 07:15 ET; plain sweep otherwise.
      const withBrief =
        (hour > 7 || (hour === 7 && minute >= 15)) && lastWingsBriefDate !== date;
      await runWingsAutomation({ withBrief });
      if (withBrief) lastWingsBriefDate = date;
    } catch (err) {
      logger.warn({ err }, "Founding Wings automation failed");
    }
  }

  if (stamp - lastClientCardDigest >= CLIENT_CARD_DIGEST_MS) {
    lastClientCardDigest = stamp;
    // sendClientCardDigests never throws; it logs its own failures.
    await sendClientCardDigests();
  }

  if (stamp - lastForemanNudge >= FOREMAN_NUDGE_MS) {
    lastForemanNudge = stamp;
    // nudgeStaleForemanMoves never throws; it logs its own failures.
    await nudgeStaleForemanMoves();
  }

  // Every ~15 min: resurface due reminders so GET /today/briefing picks them up.
  if (stamp - lastReminderCheck >= REMINDER_CHECK_MS) {
    lastReminderCheck = stamp;
    try {
      const now = new Date();
      const due = await db
        .select({ id: remindersTable.id, text: remindersTable.text })
        .from(remindersTable)
        .where(
          and(
            isNull(remindersTable.dismissedAt),
            isNotNull(remindersTable.remindAt),
            lte(remindersTable.remindAt, now),
            or(
              isNull(remindersTable.snoozedUntil),
              lte(remindersTable.snoozedUntil, now),
            ),
          ),
        );
      if (due.length > 0) {
        // Stamp updatedAt so the briefing endpoint sees them as freshly surfaced
        // Now-tier items and the client knows they were touched by the scheduler.
        await db
          .update(remindersTable)
          .set({ updatedAt: now })
          .where(
            and(
              isNull(remindersTable.dismissedAt),
              isNotNull(remindersTable.remindAt),
              lte(remindersTable.remindAt, now),
              or(
                isNull(remindersTable.snoozedUntil),
                lte(remindersTable.snoozedUntil, now),
              ),
            ),
          );
        logger.info(
          { count: due.length, ids: due.map((r) => r.id) },
          "Reminder resurfacing sweep: stamped due reminders",
        );
      }
    } catch (err) {
      logger.warn({ err }, "Reminder resurfacing sweep failed");
    }
  }

  if (stamp - lastUrgentCheck >= URGENT_CHECK_MS) {
    lastUrgentCheck = stamp;
    try {
      const { feed } = await computeQueues();
      const sig = urgentSignature(feed);
      if (sig && sig !== lastUrgentSignature) {
        const { sent } = await sendUrgentAlert(feed);
        if (sent) lastUrgentSignature = sig;
      } else if (!sig) {
        lastUrgentSignature = "";
      }
    } catch (err) {
      logger.warn({ err }, "Scheduled urgent check failed");
    }
  }
}

export function startScheduler(): void {
  const eastern = nowInEastern();
  const past = (h: number, m: number) =>
    eastern.hour > h || (eastern.hour === h && eastern.minute >= m);
  lastDailyDate = past(DAILY_HOUR, DAILY_MINUTE) ? eastern.date : null;
  lastCloseDate = past(CLOSE_HOUR, CLOSE_MINUTE) ? eastern.date : null;
  lastWeeklyDate =
    eastern.dow === WEEKLY_DOW && past(WEEKLY_HOUR, WEEKLY_MINUTE)
      ? eastern.date
      : null;
  setInterval(() => {
    void tick();
  }, TICK_MS);
  // GPS breadcrumb retention: trails matter for "today"; keep 30 days for
  // dispute review, purge older so the table can't grow unbounded.
  const purgeTrackPoints = async () => {
    try {
      await db.execute(
        sql`DELETE FROM crew_track_points WHERE created_at < now() - interval '30 days'`,
      );
    } catch (err) {
      logger.warn({ err }, "Track point purge failed");
    }
  };
  void purgeTrackPoints();
  setInterval(() => void purgeTrackPoints(), 6 * 3_600_000);
  logger.info(
    {
      dailyHour: DAILY_HOUR,
      dailyMinute: DAILY_MINUTE,
      closeHour: CLOSE_HOUR,
      closeMinute: CLOSE_MINUTE,
      weeklyDow: WEEKLY_DOW,
      weeklyHour: WEEKLY_HOUR,
    },
    "Email scheduler started",
  );
}

let lastForemanNudge = 0;

let lastReminderCheck = 0;
