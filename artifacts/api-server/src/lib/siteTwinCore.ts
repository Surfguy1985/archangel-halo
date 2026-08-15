/**
 * Site Twin — georeference a unit floor plate and snap crew GPS to a unit.
 * Pure: no I/O. Fractional unit boxes (0..1) map onto a lat/lng bounding box.
 */

export type GeoPoint = { lat: number; lng: number };
export type GeoBBox = { south: number; west: number; north: number; east: number };
export type FloorUnit = { id: string; label: string; x: number; y: number; w: number; h: number };

export type SnapConfidence = "inside" | "near" | "site" | "far";

export type UnitSnap = {
  unitId: string | null;
  label: string | null;
  meters: number | null;
  confidence: SnapConfidence;
  frac: { x: number; y: number } | null;
};

const EARTH_M = 6371000;
export const INSIDE_M = 12;
export const NEAR_M = 35;
export const SITE_M = 90;

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** ~meters box around a pin when OSM has no building footprint. */
export function padBBoxAround(center: GeoPoint, meters: number): GeoBBox {
  const dLat = meters / 111_320;
  const dLng = meters / (111_320 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lng - dLng,
    east: center.lng + dLng,
  };
}

/** OSM-style ring of {lat,lng}. */
export function bboxFromRing(ring: GeoPoint[]): GeoBBox | null {
  if (ring.length < 3) return null;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  for (const p of ring) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  if (!Number.isFinite(south) || south >= north || west >= east) return null;
  return { south, west, north, east };
}

export function bboxAreaDeg2(b: GeoBBox): number {
  return Math.max(0, b.north - b.south) * Math.max(0, b.east - b.west);
}

/** Canvas y grows down, so y=0 is the north edge of the site. */
export function fracToLatLng(x: number, y: number, bbox: GeoBBox): GeoPoint {
  return {
    lat: bbox.north - y * (bbox.north - bbox.south),
    lng: bbox.west + x * (bbox.east - bbox.west),
  };
}

export function latLngToFrac(point: GeoPoint, bbox: GeoBBox): { x: number; y: number } {
  const dw = bbox.east - bbox.west || 1;
  const dh = bbox.north - bbox.south || 1;
  return {
    x: (point.lng - bbox.west) / dw,
    y: (bbox.north - point.lat) / dh,
  };
}

export function unitCentroid(unit: FloorUnit, bbox: GeoBBox): GeoPoint {
  return fracToLatLng(unit.x + unit.w / 2, unit.y + unit.h / 2, bbox);
}

export function pointInUnit(frac: { x: number; y: number }, unit: FloorUnit): boolean {
  return (
    frac.x >= unit.x &&
    frac.x <= unit.x + unit.w &&
    frac.y >= unit.y &&
    frac.y <= unit.y + unit.h
  );
}

export function snapGpsToFloor(
  point: GeoPoint,
  bbox: GeoBBox,
  units: readonly FloorUnit[],
  siteCenter: GeoPoint,
): UnitSnap {
  const frac = latLngToFrac(point, bbox);
  const inside = units.find((u) => pointInUnit(frac, u));
  if (inside) {
    const c = unitCentroid(inside, bbox);
    return {
      unitId: inside.id,
      label: inside.label,
      meters: Math.round(haversineMeters(point, c) * 10) / 10,
      confidence: "inside",
      frac,
    };
  }

  let best: FloorUnit | null = null;
  let bestM = Infinity;
  for (const u of units) {
    const m = haversineMeters(point, unitCentroid(u, bbox));
    if (m < bestM) {
      bestM = m;
      best = u;
    }
  }
  const siteM = haversineMeters(point, siteCenter);
  if (best && bestM <= NEAR_M) {
    return {
      unitId: best.id,
      label: best.label,
      meters: Math.round(bestM * 10) / 10,
      confidence: "near",
      frac,
    };
  }
  if (siteM <= SITE_M) {
    return {
      unitId: best?.id ?? null,
      label: best?.label ?? null,
      meters: Math.round((best ? bestM : siteM) * 10) / 10,
      confidence: "site",
      frac,
    };
  }
  return {
    unitId: null,
    label: null,
    meters: Math.round(siteM * 10) / 10,
    confidence: "far",
    frac,
  };
}

export function unitTitleSummary(opts: {
  unitLabel: string | null;
  crewName: string;
  trade?: string | null;
  status?: string | null;
  meters?: number | null;
  confidence: SnapConfidence;
}): string {
  const unit = opts.unitLabel?.trim() ? `UNIT ${opts.unitLabel.trim()}` : "ON SITE";
  const bits = [opts.crewName];
  if (opts.trade?.trim()) bits.push(opts.trade.trim());
  if (opts.confidence === "inside") bits.push("in unit");
  else if (opts.confidence === "near") bits.push("at door");
  else if (opts.confidence === "site") bits.push("on site");
  else bits.push("en route");
  if (opts.meters != null && opts.confidence !== "inside") bits.push(`${Math.round(opts.meters)}m`);
  return `${unit} — ${bits.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// Presence & dwell — turn raw breadcrumbs into "who was in which unit, for how
// long". Pings arrive roughly every 30s while a crew session is open, so the
// thresholds below are tuned to that cadence: a long gap means the phone slept
// (end the visit), a short one means GPS jitter (keep the visit whole).
// ---------------------------------------------------------------------------

export type TrackPing = { lat: number; lng: number; at: string | Date };

export type UnitVisit = {
  unitId: string;
  label: string | null;
  startAt: string;
  endAt: string;
  minutes: number;
  pings: number;
};

export type PresenceDay = {
  visits: UnitVisit[];
  /** unitId -> minutes spent inside it today */
  minutesByUnit: Record<string, number>;
  onSiteMinutes: number;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
};

/** Longer than this between pings and the phone was asleep — close the visit. */
export const DWELL_GAP_MS = 10 * 60_000;
/** A blip out of the box shorter than this is jitter, not a real departure. */
export const DWELL_MERGE_MS = 3 * 60_000;
/** Walking past a door is not a visit. */
export const DWELL_MIN_MS = 60_000;

function pingTime(at: string | Date): number {
  return at instanceof Date ? at.getTime() : new Date(at).getTime();
}

/**
 * Reduce one crew's day of breadcrumbs to unit visits.
 *
 * A "visit" is a run of consecutive pings that snap to the same unit. Runs are
 * split on long gaps, rejoined across brief jitter, and drive-by noise is
 * dropped — otherwise a two-hour stay reads as forty separate visits.
 */
export function computePresenceDay(
  pings: readonly TrackPing[],
  bbox: GeoBBox,
  units: readonly FloorUnit[],
  siteCenter: GeoPoint,
): PresenceDay {
  const ordered = pings
    .map((p) => ({ lat: p.lat, lng: p.lng, t: pingTime(p.at) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.t))
    .sort((a, b) => a.t - b.t);

  if (ordered.length === 0) {
    return { visits: [], minutesByUnit: {}, onSiteMinutes: 0, firstSeenAt: null, lastSeenAt: null };
  }

  type Run = {
    unitId: string;
    label: string | null;
    start: number;
    end: number;
    pings: number;
    // True when the crew was off the property between this run and the one
    // before it. Such a run can never be stitched onto its predecessor.
    afterOffSite: boolean;
  };
  const runs: Run[] = [];
  let onSiteMs = 0;
  let prevOnSite: number | null = null;
  // A ping that lands off the property ends the stay outright. Dwell is
  // evidence — "in unit 204 for two hours" must never be bridged across the
  // crew actually leaving, no matter how briefly, or the number is a lie.
  let leftSite = false;
  let firstOnSite: number | null = null;
  let lastOnSite: number | null = null;

  for (const p of ordered) {
    const snap = snapGpsToFloor({ lat: p.lat, lng: p.lng }, bbox, units, siteCenter);
    const here = snap.confidence === "inside" || snap.confidence === "near" ? snap.unitId : null;

    if (snap.confidence !== "far") {
      if (firstOnSite == null) firstOnSite = p.t;
      lastOnSite = p.t;
      if (prevOnSite != null && p.t - prevOnSite <= DWELL_GAP_MS) onSiteMs += p.t - prevOnSite;
      prevOnSite = p.t;
    } else {
      prevOnSite = null;
      leftSite = true;
    }

    const last = runs[runs.length - 1];
    if (here && !leftSite && last && last.unitId === here && p.t - last.end <= DWELL_GAP_MS) {
      last.end = p.t;
      last.pings += 1;
      continue;
    }
    if (here) {
      runs.push({
        unitId: here,
        label: snap.label,
        start: p.t,
        end: p.t,
        pings: 1,
        afterOffSite: leftSite,
      });
      leftSite = false;
    }
  }

  // Rejoin runs the crew briefly stepped out of — a GPS wobble across a box
  // edge must not read as leaving and re-entering the apartment. Two shapes of
  // wobble occur in the field: stepping into the hallway (a gap with no unit at
  // all), and a single ping landing in the unit next door. Standing on a shared
  // wall produces the second shape over and over, so the blip is hopped rather
  // than treated as a divider — otherwise a two-hour stay shreds into nothing.
  const merged: Run[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (
      last &&
      !run.afterOffSite &&
      last.unitId === run.unitId &&
      run.start - last.end <= DWELL_MERGE_MS
    ) {
      last.end = run.end;
      last.pings += run.pings;
      continue;
    }
    const prev = merged[merged.length - 2];
    const blipMs = last ? last.end - last.start : Infinity;
    if (
      prev &&
      last &&
      !run.afterOffSite &&
      !last.afterOffSite &&
      prev.unitId === run.unitId &&
      blipMs < DWELL_MIN_MS &&
      run.start - prev.end <= DWELL_MERGE_MS
    ) {
      prev.end = run.end;
      prev.pings += run.pings;
      merged.pop();
      continue;
    }
    merged.push({ ...run });
  }

  const visits: UnitVisit[] = [];
  const minutesByUnit: Record<string, number> = {};
  for (const run of merged) {
    const ms = run.end - run.start;
    if (ms < DWELL_MIN_MS) continue;
    const minutes = Math.round(ms / 60_000);
    visits.push({
      unitId: run.unitId,
      label: run.label,
      startAt: new Date(run.start).toISOString(),
      endAt: new Date(run.end).toISOString(),
      minutes,
      pings: run.pings,
    });
    minutesByUnit[run.unitId] = (minutesByUnit[run.unitId] ?? 0) + minutes;
  }

  return {
    visits,
    minutesByUnit,
    onSiteMinutes: Math.round(onSiteMs / 60_000),
    // Seen ON SITE, not merely seen: the roster prints this as "in at 7:14a",
    // so a ping from the crew's driveway must not become an arrival time.
    firstSeenAt: firstOnSite == null ? null : new Date(firstOnSite).toISOString(),
    lastSeenAt: lastOnSite == null ? null : new Date(lastOnSite).toISOString(),
  };
}

/** "2h14m" / "47m" / "just arrived" — used in HUD titles and the roster. */
export function humanMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return "just arrived";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/**
 * Thin a day of breadcrumbs for the replay scrubber. Keeps the first and last
 * ping so the timeline still spans the real working day.
 */
export function downsampleTrail<T>(points: readonly T[], max: number): T[] {
  const cap = Math.max(2, Math.floor(max));
  if (points.length <= cap) return [...points];
  const step = (points.length - 1) / (cap - 1);
  const out: T[] = [];
  for (let i = 0; i < cap; i++) out.push(points[Math.round(i * step)]!);
  return out;
}

export type GridBox = { label: string; x: number; y: number; w: number; h: number };

/** Fractional unit plate used by Admin unit map and Site Twin one-tap layout. */
export function layoutUnitGrid(count: number, startAt = 101): GridBox[] {
  const n = Math.floor(count);
  if (n < 1) return [];
  const cols = Math.ceil(Math.sqrt(n * 1.6));
  const rows = Math.ceil(n / cols);
  const gap = 0.012;
  const w = (1 - gap * (cols + 1)) / cols;
  const h = (1 - gap * (rows + 1)) / rows;
  const out: GridBox[] = [];
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    out.push({
      label: String(startAt + i),
      x: gap + col * (w + gap),
      y: gap + row * (h + gap),
      w,
      h,
    });
  }
  return out;
}
