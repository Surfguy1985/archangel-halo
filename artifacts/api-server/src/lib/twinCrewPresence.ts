/**
 * Shared Unity + Pulse crew-presence shape.
 *
 * Live GPS is the source of truth. Thornbury demo markers are presentation-only:
 * they never share an id with a real crew UUID and must not be written to
 * check-ins or track points.
 */
import { BUILDING_UNITS_EXPORT } from "./thornburySitePlan";
import { buildBuildingPins, presenceTitle, type BuildingPin } from "./buildingSiteOps";

export const DEMO_CREW_PREFIX = "demo:";
export const LIVE_GPS_FRESH_MS = 5 * 60_000;

export type TwinPresenceSource = "live" | "demo";

export type TwinCrewPresence = {
  crewId: string;
  crewName: string;
  trade: string | null;
  lat: number | null;
  lng: number | null;
  at: string | null;
  onSite: boolean;
  building: number | null;
  buildingLabel: string | null;
  confidence: "inside" | "near" | "site" | "far";
  meters: number | null;
  jobId: string | null;
  jobNo: string | null;
  unitNo: string | null;
  unitFromJob: boolean;
  title: string;
  source: TwinPresenceSource;
  demo: boolean;
  fresh: boolean;
};

export type TwinDemoSlot = {
  key: string;
  name: string;
  trade: string;
  building: number;
  unitIndex: number;
};

/** Deterministic Thornbury walkthrough placements — not real people. */
export const THORNBURY_DEMO_SLOTS: readonly TwinDemoSlot[] = [
  { key: "paint", name: "Demo Paint Crew", trade: "Paint", building: 12, unitIndex: 0 },
  { key: "make-ready", name: "Demo Make-Ready", trade: "Make-ready", building: 4, unitIndex: 0 },
  { key: "floor", name: "Demo Flooring", trade: "Flooring", building: 8, unitIndex: 2 },
  { key: "hvac", name: "Demo HVAC", trade: "HVAC", building: 16, unitIndex: 0 },
  { key: "clean", name: "Demo Clean", trade: "Clean", building: 1, unitIndex: 1 },
];

export function isDemoPresenceId(id: unknown): boolean {
  return typeof id === "string" && id.startsWith(DEMO_CREW_PREFIX);
}

/** Query `demo=1|true|thornbury` turns on presentation mocks. */
export function wantsTwinDemo(query: unknown): boolean {
  if (query == null || typeof query !== "object") return false;
  const raw = (query as Record<string, unknown>).demo;
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === true || v === 1) return true;
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "thornbury" || s === "on";
}

export function isFreshLiveGps(at: string | null | undefined, now = Date.now()): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t <= LIVE_GPS_FRESH_MS;
}

export function hasLivePosition(row: Pick<TwinCrewPresence, "demo" | "source" | "lat" | "lng">): boolean {
  if (row.demo || row.source === "demo") return false;
  return row.lat != null && row.lng != null && Number.isFinite(row.lat) && Number.isFinite(row.lng);
}

export function tagLivePresence(
  row: Omit<TwinCrewPresence, "source" | "demo" | "fresh"> & Partial<Pick<TwinCrewPresence, "source" | "demo" | "fresh">>,
  now = Date.now(),
): TwinCrewPresence {
  return {
    trade: row.trade ?? null,
    ...row,
    source: "live",
    demo: false,
    fresh: isFreshLiveGps(row.at, now),
  };
}

export function thornburyDemoPresence(
  pins: BuildingPin[] = buildBuildingPins(),
): TwinCrewPresence[] {
  const byBldg = new Map(pins.map((p) => [p.building, p]));
  return THORNBURY_DEMO_SLOTS.map((slot) => {
    const pin = byBldg.get(slot.building);
    const units = BUILDING_UNITS_EXPORT[slot.building] ?? [];
    const unitNo = units[slot.unitIndex] ?? units[0] ?? null;
    const lat = pin ? pin.lat + 0.00004 : null;
    const lng = pin ? pin.lng + 0.00003 : null;
    const title = `[DEMO] ${presenceTitle({
      unitNo,
      building: slot.building,
      confidence: "inside",
      meters: 0,
      unitFromJob: !!unitNo,
    })}`;
    return {
      crewId: `${DEMO_CREW_PREFIX}${slot.key}`,
      crewName: slot.name,
      trade: slot.trade,
      lat,
      lng,
      at: null,
      onSite: true,
      building: slot.building,
      buildingLabel: pin?.label ?? `Building ${slot.building}`,
      confidence: "inside" as const,
      meters: 0,
      jobId: null,
      jobNo: null,
      unitNo,
      unitFromJob: false,
      title,
      source: "demo" as const,
      demo: true,
      fresh: false,
    };
  });
}

/**
 * Live GPS wins for the same crewId. Demo rows are extra presentation markers
 * and never replace a real fix.
 */
export function mergeTwinPresence(
  live: TwinCrewPresence[],
  demo: TwinCrewPresence[],
  now = Date.now(),
): TwinCrewPresence[] {
  const liveRows = live.map((row) => tagLivePresence(row, now));
  const byId = new Map(liveRows.map((row) => [row.crewId, row]));
  const out = [...liveRows];
  for (const raw of demo) {
    const mock: TwinCrewPresence = {
      ...raw,
      source: "demo",
      demo: true,
      fresh: false,
      title: raw.title.startsWith("[DEMO]") ? raw.title : `[DEMO] ${raw.title}`,
    };
    if (!isDemoPresenceId(mock.crewId) && !mock.crewId.startsWith(DEMO_CREW_PREFIX)) {
      mock.crewId = `${DEMO_CREW_PREFIX}${mock.crewId}`;
    }
    const existing = byId.get(mock.crewId) ?? byId.get(raw.crewId);
    if (existing && hasLivePosition(existing)) continue;
    if (existing) continue;
    byId.set(mock.crewId, mock);
    out.push(mock);
  }
  return out;
}

export function twinPresenceLegend(demoActive: boolean): { live: string; demo: string | null } {
  return {
    live: "Live GPS",
    demo: demoActive ? "DEMO / MOCK — not a real check-in" : null,
  };
}

export function countOnSite(presence: TwinCrewPresence[]): number {
  return presence.filter((p) => p.onSite).length;
}

export function countByBuilding(presence: TwinCrewPresence[]): Record<string, number> {
  const byBuilding: Record<string, number> = {};
  for (const p of presence) {
    if (p.building != null && p.onSite) {
      byBuilding[String(p.building)] = (byBuilding[String(p.building)] || 0) + 1;
    }
  }
  return byBuilding;
}
