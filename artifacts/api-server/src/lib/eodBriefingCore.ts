/**
 * End-of-day briefing metrics + deterministic fallback (pure).
 * If a model is added later, it must fall back to fallbackSummary — never fail open empty.
 */

export const EASTERN_TZ = "America/New_York";

export interface EodBriefingMetrics {
  date: string;
  jobsCompleted: number;
  jobsStillOpen: number;
  jobsScheduledToday: number;
  checkins: number;
  checkouts: number;
  crewsActive: number;
  photos: number;
  base44Freshness: string | null;
  base44EvidenceFresh: number;
  base44EvidenceStale: number;
}

export function localDateInEastern(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: EASTERN_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function tzOffsetMs(instant: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

function addCalendarDay(ymd: string): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo! - 1, d! + 1)).toISOString().slice(0, 10);
}

function zonedMidnight(ymd: string): Date {
  let utc = Date.parse(`${ymd}T00:00:00Z`);
  for (let i = 0; i < 2; i++) {
    const offset = tzOffsetMs(new Date(utc), EASTERN_TZ);
    utc = Date.parse(`${ymd}T00:00:00Z`) - offset;
  }
  return new Date(utc);
}

/** `[start, end)` for a YYYY-MM-DD calendar day in America/New_York. */
export function easternDayWindow(ymd: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    throw new Error("easternDayWindow expects YYYY-MM-DD");
  }
  return { start: zonedMidnight(ymd), end: zonedMidnight(addCalendarDay(ymd)) };
}

export function fallbackSummary(m: EodBriefingMetrics): string {
  const parts: string[] = [`HALO end-of-day ${m.date}.`];
  if (m.jobsCompleted === 0 && m.checkins === 0 && m.photos === 0) {
    parts.push("No field completions, check-ins, or photos recorded today.");
  } else {
    parts.push(
      `${m.jobsCompleted} job${m.jobsCompleted === 1 ? "" : "s"} completed, ${m.jobsScheduledToday} scheduled, ${m.jobsStillOpen} still open.`,
    );
    parts.push(
      `${m.crewsActive} crew${m.crewsActive === 1 ? "" : "s"} punched (${m.checkins} in / ${m.checkouts} out), ${m.photos} field photo${m.photos === 1 ? "" : "s"}.`,
    );
  }
  if (m.base44Freshness) {
    parts.push(`Base44 projection freshness: ${m.base44Freshness}.`);
  }
  if (m.base44EvidenceStale > 0) {
    parts.push(
      `${m.base44EvidenceStale} Base44 evidence row${m.base44EvidenceStale === 1 ? "" : "s"} marked stale.`,
    );
  }
  return parts.join(" ");
}

export function inWindow(at: Date | string | null | undefined, start: Date, end: Date): boolean {
  if (!at) return false;
  const t = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= start.getTime() && t < end.getTime();
}

const CLOSED_JOB_STATUSES = new Set(["complete", "closed", "cancelled", "paid", "cleared"]);

export function jobIsOpen(status: string | null | undefined): boolean {
  return !CLOSED_JOB_STATUSES.has((status ?? "").toLowerCase());
}
