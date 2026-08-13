/**
 * weather.schedule_recommend — deterministic recommendation packet.
 * Never writes jobs.scheduledOn or Base44.
 */

import type { WeatherSeverity } from "./weatherRiskCore";

export interface RecommendJob {
  id: string;
  jobNo: string;
  propertyId: string;
  propertyName?: string | null;
  scheduledOn: string | null;
  description?: string | null;
}

export interface RecommendDayRisk {
  date: string;
  severity: WeatherSeverity | null;
  summary: string;
}

export interface RecommendPropertyRisk {
  propertyId: string;
  days: RecommendDayRisk[];
}

export interface ScheduleMove {
  jobId: string;
  jobNo: string;
  propertyId: string;
  propertyName: string | null;
  fromDate: string;
  toDate: string;
  severity: WeatherSeverity;
  reason: string;
}

export interface ScheduleRecommendPacket {
  writes: false;
  summary: string;
  moves: ScheduleMove[];
  notes: string[];
}

function dayMap(days: RecommendDayRisk[]): Map<string, RecommendDayRisk> {
  return new Map(days.map((d) => [d.date, d]));
}

function isRisky(sev: WeatherSeverity | null): sev is WeatherSeverity {
  return sev === "high" || sev === "medium";
}

function firstSaferDate(fromDate: string, days: RecommendDayRisk[]): string | null {
  const later = days.filter((d) => d.date > fromDate && !isRisky(d.severity));
  return later[0]?.date ?? null;
}

export function recommendScheduleMoves(
  jobs: RecommendJob[],
  risks: RecommendPropertyRisk[],
  today: string,
): ScheduleRecommendPacket {
  const byProp = new Map(risks.map((r) => [r.propertyId, r.days]));
  const moves: ScheduleMove[] = [];
  const notes: string[] = [];

  for (const job of jobs) {
    if (!job.scheduledOn || job.scheduledOn < today) continue;
    const days = byProp.get(job.propertyId);
    if (!days || days.length === 0) {
      notes.push(`${job.jobNo}: no forecast for this property.`);
      continue;
    }
    const onDay = dayMap(days).get(job.scheduledOn);
    if (!onDay) {
      notes.push(`${job.jobNo}: scheduled ${job.scheduledOn} is outside the forecast window.`);
      continue;
    }
    if (!isRisky(onDay.severity)) continue;
    const safer = firstSaferDate(job.scheduledOn, days);
    if (!safer) {
      notes.push(
        `${job.jobNo}: ${onDay.severity} weather on ${job.scheduledOn} (${onDay.summary}) — no clearer day in the forecast.`,
      );
      continue;
    }
    moves.push({
      jobId: job.id,
      jobNo: job.jobNo,
      propertyId: job.propertyId,
      propertyName: job.propertyName ?? null,
      fromDate: job.scheduledOn,
      toDate: safer,
      severity: onDay.severity,
      reason: `${onDay.summary} on ${job.scheduledOn}. Suggest ${safer}. Base44 remains schedule source of record.`,
    });
  }

  const summary =
    moves.length === 0
      ? notes.length > 0
        ? "No movable jobs — see notes. HALO did not change any schedule."
        : "No weather-driven schedule moves recommended."
      : `${moves.length} job${moves.length === 1 ? "" : "s"} may be safer on a later day. Recommendation only — Base44 owns the schedule.`;

  return { writes: false, summary, moves, notes };
}
