/**
 * Property Pulse ranking + copy. Pure — no I/O.
 * Turns live HALO jobs/crews into the mockup's status language.
 */

export type PulsePropertyInput = {
  id: string;
  name: string;
  pmcName?: string | null;
  city?: string | null;
  openJobs: number;
  crewsOnSite: number;
  overdueJobs: number;
};

export type PulseNeed = {
  id: string;
  label: string;
  urgency: "now" | "today" | "watch";
};

export function propertyStatusLines(p: PulsePropertyInput): { primary: string; secondary: string; hot: boolean } {
  const hot = p.crewsOnSite > 0 || p.overdueJobs > 0 || p.openJobs > 0;
  const primary =
    p.openJobs > 0
      ? `${p.openJobs} open turn${p.openJobs === 1 ? "" : "s"}`
      : "Clear";
  const secondary =
    p.crewsOnSite > 0
      ? "Crew on site"
      : p.overdueJobs > 0
        ? `${p.overdueJobs} behind`
        : p.openJobs > 0
          ? "Needs dispatch"
          : "Quiet";
  return { primary: titleCaseStatus(primary), secondary: titleCaseStatus(secondary), hot };
}

function titleCaseStatus(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Hottest sites first: crew on site, then overdue, then open volume. */
export function rankPulseProperties(rows: readonly PulsePropertyInput[]): PulsePropertyInput[] {
  return [...rows].sort((a, b) => {
    if (b.crewsOnSite !== a.crewsOnSite) return b.crewsOnSite - a.crewsOnSite;
    if (b.overdueJobs !== a.overdueJobs) return b.overdueJobs - a.overdueJobs;
    if (b.openJobs !== a.openJobs) return b.openJobs - a.openJobs;
    return a.name.localeCompare(b.name);
  });
}

export function predictPulseNeeds(opts: {
  uncrewedJobs: number;
  overdueInvoices: number;
  overdueJobs: number;
  crewsOnSite: number;
  base44AgeMinutes: number | null;
  smsConfigured: boolean;
  unpinnedSites?: number;
}): PulseNeed[] {
  const needs: PulseNeed[] = [];
  if ((opts.unpinnedSites ?? 0) > 0) {
    needs.push({
      id: "unpinned",
      label: `Pin GPS on ${opts.unpinnedSites} site${opts.unpinnedSites === 1 ? "" : "s"}`,
      urgency: "today",
    });
  }
  if (opts.uncrewedJobs > 0) {
    needs.push({
      id: "uncrewed",
      label: `Fill ${opts.uncrewedJobs} uncrewed job${opts.uncrewedJobs === 1 ? "" : "s"}`,
      urgency: "now",
    });
  }
  if (opts.overdueJobs > 0) {
    needs.push({
      id: "behind",
      label: `${opts.overdueJobs} job${opts.overdueJobs === 1 ? "" : "s"} behind schedule`,
      urgency: "now",
    });
  }
  if (opts.overdueInvoices > 0) {
    needs.push({
      id: "invoices",
      label: `${opts.overdueInvoices} invoice${opts.overdueInvoices === 1 ? "" : "s"} waiting`,
      urgency: "today",
    });
  }
  if (opts.crewsOnSite === 0 && opts.uncrewedJobs === 0) {
    needs.push({ id: "quiet", label: "No crews on site — check tomorrow's board", urgency: "watch" });
  }
  if (opts.base44AgeMinutes != null && opts.base44AgeMinutes > 10) {
    needs.push({
      id: "base44",
      label: `Work app projection is ${opts.base44AgeMinutes}m stale — sync`,
      urgency: "today",
    });
  }
  if (!opts.smsConfigured) {
    needs.push({
      id: "sms",
      label: "Connect Twilio so HALO can ping crew and admin",
      urgency: "watch",
    });
  }
  return needs.slice(0, 4);
}

export function crewPingBody(opts: {
  crewFirst: string;
  jobNo: string;
  unitNo: string | null;
  propertyName: string;
  when: string;
}): string {
  const unit = opts.unitNo ? ` Unit ${opts.unitNo}` : "";
  return `HALO: ${opts.crewFirst}, you're on ${opts.jobNo}${unit} at ${opts.propertyName} ${opts.when}. Reply when you're rolling.`;
}

/** One SMS per crew per day — lists their stops so we don't blast five texts. */
export function crewDayPingBody(opts: {
  crewFirst: string;
  when: "today" | "tomorrow";
  stops: { jobNo: string; unitNo: string | null; propertyName: string }[];
}): string {
  const lines = opts.stops.slice(0, 5).map((s) => {
    const unit = s.unitNo ? ` Unit ${s.unitNo}` : "";
    return `${s.jobNo}${unit} at ${s.propertyName}`;
  });
  const extra = opts.stops.length > 5 ? ` +${opts.stops.length - 5} more` : "";
  return `HALO: ${opts.crewFirst}, ${opts.when}: ${lines.join("; ")}${extra}. Reply when you're rolling.`;
}

export function gpsPingBody(opts: { site: string; unit?: string | null }): string {
  const unit = opts.unit ? ` Unit ${opts.unit}` : "";
  return `HALO: keep your crew portal open at ${opts.site}${unit} so live GPS stays on. Native app tracks in the background when checked in. Reply when rolling.`;
}

export function adminPingBody(opts: { uncrewed: number; overdue: number }): string {
  const bits = [
    opts.uncrewed > 0 ? `${opts.uncrewed} uncrewed` : null,
    opts.overdue > 0 ? `${opts.overdue} behind` : null,
  ].filter(Boolean);
  return `HALO admin: ${bits.join(", ") || "attention items"} need a look. Open Property Pulse.`;
}

/** Map overlay title matching the Property Pulse seed: "Unit 8A Turn — Paint Crew". */
export function unitOverlayTitle(opts: {
  unitNo: string | null;
  category: string | null;
  crewName: string | null;
}): string {
  const unit = opts.unitNo?.trim() ? `Unit ${opts.unitNo.trim()}` : "Turn";
  const cat = opts.category?.trim() || "Turn";
  const crew = opts.crewName?.trim();
  if (unit === "Turn") return crew ? `${cat} — ${crew}` : cat;
  return crew ? `${unit} ${cat} — ${crew}` : `${unit} ${cat}`;
}

export const GPS_FRESH_MS = 5 * 60 * 1000;

export function gpsAgeMs(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

export function isGpsFresh(iso: string | null | undefined, now = Date.now()): boolean {
  const age = gpsAgeMs(iso, now);
  return age != null && age <= GPS_FRESH_MS;
}

/** Operator-facing last-seen chip: "47s ago" / "12m ago". */
export function formatGpsAge(iso: string | null | undefined, now = Date.now()): string | null {
  const age = gpsAgeMs(iso, now);
  if (age == null) return null;
  const s = Math.round(age / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

/** One primary overlay action — pin, wake GPS, or open the twin. */
export function overlayPrimaryAction(opts: {
  pinned: boolean;
  gpsFresh: boolean;
  hasCrewToPing: boolean;
}): "pin" | "gps" | "twin" {
  if (!opts.pinned) return "pin";
  if (opts.gpsFresh) return "twin";
  if (opts.hasCrewToPing) return "gps";
  return "twin";
}
