/**
 * HALO ops.eod_briefing — aggregate Base44 + field facts, persist a snapshot.
 * Does not write Base44. Deterministic summary (no model required).
 */

import { desc } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewCheckinsTable,
  crewPhotosTable,
  base44SyncRunsTable,
  base44EvidenceTable,
  haloEodBriefingsTable,
} from "@workspace/db";
import {
  easternDayWindow,
  fallbackSummary,
  acceptEodSummary,
  inWindow,
  jobIsOpen,
  localDateInEastern,
  type EodBriefingMetrics,
} from "./eodBriefingCore";
import { completeText } from "./ai";
import { enforceFalkonMutation } from "./falkonPolicy";
import { logger } from "./logger";

export async function aggregateEodBriefing(date = localDateInEastern()): Promise<EodBriefingMetrics> {
  const { start, end } = easternDayWindow(date);
  const [jobs, checkins, photos, syncRuns, evidence] = await Promise.all([
    db
      .select({
        status: jobsTable.status,
        completedAt: jobsTable.completedAt,
        scheduledOn: jobsTable.scheduledOn,
      })
      .from(jobsTable),
    db
      .select({
        crewId: crewCheckinsTable.crewId,
        kind: crewCheckinsTable.kind,
        createdAt: crewCheckinsTable.createdAt,
      })
      .from(crewCheckinsTable),
    db.select({ createdAt: crewPhotosTable.createdAt }).from(crewPhotosTable),
    db
      .select({
        freshness: base44SyncRunsTable.freshness,
        attemptedAt: base44SyncRunsTable.attemptedAt,
      })
      .from(base44SyncRunsTable)
      .orderBy(desc(base44SyncRunsTable.attemptedAt))
      .limit(1),
    db
      .select({
        stale: base44EvidenceTable.stale,
        lastSeenAt: base44EvidenceTable.lastSeenAt,
      })
      .from(base44EvidenceTable),
  ]);

  const todayCheckins = checkins.filter((c) => inWindow(c.createdAt, start, end));
  const crews = new Set(todayCheckins.map((c) => c.crewId));
  const latestSync = syncRuns[0] ?? null;

  return {
    date,
    jobsCompleted: jobs.filter((j) => inWindow(j.completedAt, start, end)).length,
    jobsStillOpen: jobs.filter((j) => jobIsOpen(j.status)).length,
    jobsScheduledToday: jobs.filter((j) => j.scheduledOn === date).length,
    checkins: todayCheckins.filter((c) => c.kind === "checkin").length,
    checkouts: todayCheckins.filter((c) => c.kind === "checkout").length,
    crewsActive: crews.size,
    photos: photos.filter((p) => inWindow(p.createdAt, start, end)).length,
    base44Freshness: latestSync?.freshness ?? null,
    base44EvidenceFresh: evidence.filter((e) => !e.stale && inWindow(e.lastSeenAt, start, end)).length,
    base44EvidenceStale: evidence.filter((e) => e.stale).length,
  };
}

export async function persistEodBriefing(date = localDateInEastern()): Promise<{
  date: string;
  summary: string;
  metrics: EodBriefingMetrics;
  fallbackUsed: boolean;
}> {
  const metrics = await aggregateEodBriefing(date);
  const fallback = fallbackSummary(metrics);
  let summary = fallback;
  let fallbackUsed = true;
  try {
    const modelText = await completeText(
      "You write a short HALO end-of-day recap for the office. Use only the metrics. No schedule changes, no invoices, no invented facts. 2-4 sentences.",
      JSON.stringify(metrics),
      400,
    );
    const accepted = acceptEodSummary(modelText, fallback);
    summary = accepted.summary;
    fallbackUsed = accepted.fallbackUsed;
  } catch (err) {
    logger.warn({ err }, "ops.eod_briefing model recap failed; using fallbackSummary");
  }
  const metricsJson: Record<string, unknown> = { ...metrics };
  await db
    .insert(haloEodBriefingsTable)
    .values({
      localDate: date,
      summary,
      fallbackUsed,
      metrics: metricsJson,
    })
    .onConflictDoUpdate({
      target: haloEodBriefingsTable.localDate,
      set: {
        summary,
        fallbackUsed,
        metrics: metricsJson,
        updatedAt: new Date(),
      },
    });
  return { date, summary, metrics, fallbackUsed };
}

export async function latestEodBriefing(): Promise<{
  date: string;
  summary: string;
  fallbackUsed: boolean;
  metrics: unknown;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  const [row] = await db
    .select()
    .from(haloEodBriefingsTable)
    .orderBy(desc(haloEodBriefingsTable.localDate))
    .limit(1);
  if (!row) return null;
  return {
    date: row.localDate,
    summary: row.summary,
    fallbackUsed: row.fallbackUsed,
    metrics: row.metrics,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function runScheduledEodBriefing(): Promise<{
  persisted: boolean;
  skipped?: string;
  date?: string;
}> {
  const gated = await enforceFalkonMutation({
    action: "ops.eod_briefing",
    actorChannel: "worker",
    capability: "ops.eod_briefing",
    targetType: "briefing",
    payload: { source: "scheduler" },
  });
  if (!gated.decision.permitted) {
    logger.info({ reason: gated.decision.reason }, "eod briefing skipped by Falkon");
    return { persisted: false, skipped: gated.decision.reason };
  }
  const saved = await persistEodBriefing();
  return { persisted: true, date: saved.date };
}
