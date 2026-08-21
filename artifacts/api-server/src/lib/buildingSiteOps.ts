/**
 * Building-first Site Twin — no per-unit photo mapping required.
 *
 * Truth model:
 *   1. Property pin  → on-site / off-site
 *   2. Building centroid → which building
 *   3. Job.unitNo → which unit (from WO / Base44)
 *   4. Crew GPS → presence + heat
 *   5. Optional QR scan → hard building check-in
 */

import { fitAffine, imageToLatLng, type Gcp } from "./sitePlanGeoref";
import { haversineMeters, type GeoPoint } from "./siteTwinCore";
import {
  BUILDING_CENTER_EXPORT,
  BUILDING_UNITS_EXPORT,
  THORNBURY_GCPS,
  THORNBURY_SITE_META,
  unitToBuilding,
} from "./thornburySitePlan";

export const BUILDING_INSIDE_M = 35;
export const BUILDING_NEAR_M = 55;
export const SITE_M = 120;

export type BuildingPin = {
  building: number;
  label: string;
  x: number;
  y: number;
  lat: number;
  lng: number;
  unitCount: number;
  units: string[];
};

export type BuildingSnap = {
  building: number | null;
  label: string | null;
  meters: number | null;
  confidence: "inside" | "near" | "site" | "far";
};

export type CrewPresence = {
  crewId: string;
  crewName: string;
  lat: number;
  lng: number;
  at: string | null;
  onSite: boolean;
  building: number | null;
  buildingLabel: string | null;
  confidence: BuildingSnap["confidence"];
  meters: number | null;
  /** From assigned live job — source of truth for unit */
  jobId: string | null;
  jobNo: string | null;
  unitNo: string | null;
  unitFromJob: boolean;
  title: string;
};

export type HeatCell = {
  lat: number;
  lng: number;
  weight: number;
  building: number | null;
};

function coeff() {
  return fitAffine([...THORNBURY_GCPS] as Gcp[]);
}

/** Building pins in real lat/lng from site-plan fractions + GCPs. */
export function buildBuildingPins(): BuildingPin[] {
  const c = coeff();
  const centers = BUILDING_CENTER_EXPORT;
  const units = BUILDING_UNITS_EXPORT;
  const out: BuildingPin[] = [];
  for (const [numStr, frac] of Object.entries(centers)) {
    const building = Number(numStr);
    const list = units[building] || [];
    let lat = THORNBURY_SITE_META.lat;
    let lng = THORNBURY_SITE_META.lng;
    if (c) {
      const p = imageToLatLng(frac.x, frac.y, c);
      lat = p.lat;
      lng = p.lng;
    }
    out.push({
      building,
      label: `Building ${building}`,
      x: frac.x,
      y: frac.y,
      lat,
      lng,
      unitCount: list.length,
      units: list,
    });
  }
  return out.sort((a, b) => a.building - b.building);
}

export function snapGpsToBuilding(gps: GeoPoint, buildings: BuildingPin[]): BuildingSnap {
  const site = { lat: THORNBURY_SITE_META.lat, lng: THORNBURY_SITE_META.lng };
  const siteM = haversineMeters(gps, site);
  if (siteM > SITE_M) {
    return { building: null, label: null, meters: siteM, confidence: "far" };
  }
  let best: BuildingPin | null = null;
  let bestM = Infinity;
  for (const b of buildings) {
    const m = haversineMeters(gps, { lat: b.lat, lng: b.lng });
    if (m < bestM) {
      bestM = m;
      best = b;
    }
  }
  if (!best) {
    return { building: null, label: null, meters: siteM, confidence: "site" };
  }
  if (bestM <= BUILDING_INSIDE_M) {
    return { building: best.building, label: best.label, meters: bestM, confidence: "inside" };
  }
  if (bestM <= BUILDING_NEAR_M) {
    return { building: best.building, label: best.label, meters: bestM, confidence: "near" };
  }
  return { building: best.building, label: best.label, meters: bestM, confidence: "site" };
}

export function resolveUnitFromJob(unitNo: string | null | undefined): {
  unitNo: string | null;
  building: number | null;
} {
  if (!unitNo) return { unitNo: null, building: null };
  const cleaned = String(unitNo).replace(/\D/g, "") || String(unitNo).trim();
  const building = unitToBuilding(cleaned);
  return { unitNo: cleaned, building };
}

export function presenceTitle(opts: {
  unitNo: string | null;
  building: number | null;
  confidence: BuildingSnap["confidence"];
  meters: number | null;
  unitFromJob: boolean;
}): string {
  const unit = opts.unitNo ? `Unit ${opts.unitNo}` : opts.building != null ? `Bldg ${opts.building}` : "Site";
  const bits: string[] = [];
  if (opts.unitFromJob && opts.unitNo) bits.push("from job");
  if (opts.confidence === "inside") bits.push("at building");
  else if (opts.confidence === "near") bits.push("near building");
  else if (opts.confidence === "site") bits.push("on site");
  else bits.push("off site");
  if (opts.meters != null && opts.confidence !== "inside") bits.push(`${Math.round(opts.meters)}m`);
  return `${unit} — ${bits.join(" · ")}`;
}

/** Simple heat cells: grid-quantize GPS pings. */
export function buildHeatmap(
  points: Array<{ lat: number; lng: number }>,
  buildings: BuildingPin[],
  cellDeg = 0.00012,
): HeatCell[] {
  const map = new Map<string, HeatCell>();
  for (const p of points) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const gx = Math.round(p.lng / cellDeg);
    const gy = Math.round(p.lat / cellDeg);
    const key = `${gx}:${gy}`;
    const snap = snapGpsToBuilding(p, buildings);
    const cur = map.get(key);
    if (cur) cur.weight += 1;
    else {
      map.set(key, {
        lat: gy * cellDeg,
        lng: gx * cellDeg,
        weight: 1,
        building: snap.building,
      });
    }
  }
  return [...map.values()].sort((a, b) => b.weight - a.weight);
}

/** QR payload for building check-in (crew portal scans). */
export function buildingQrPayload(propertyId: string, building: number): string {
  return JSON.stringify({
    t: "halo_building_checkin",
    v: 1,
    propertyId,
    building,
    label: `Building ${building}`,
  });
}
