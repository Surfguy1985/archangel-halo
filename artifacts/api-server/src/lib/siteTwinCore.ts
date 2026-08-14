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
