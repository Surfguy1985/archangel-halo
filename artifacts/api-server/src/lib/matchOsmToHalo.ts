/**
 * Match OSM footprints → Halo Building 1–20 by nearest centroid.
 * No hand labeling required.
 */
import { haversineMeters } from "./siteTwinCore";
import { buildBuildingPins } from "./buildingSiteOps";
import type { OsmBuildingFeature } from "./osmBuildings";

export type MatchedFootprint = {
  building: number;
  label: string;
  osmId: number;
  osmName: string | null;
  distanceM: number;
  centroid: { lat: number; lng: number };
  ring: Array<[number, number]>;
  levels: number | null;
  flats: string | null;
  areaApproxM2: number;
  confidence: "high" | "medium" | "low";
};

/**
 * Greedy nearest-neighbor: each Halo building gets the closest unmatched OSM footprint
 * within maxMeters. Remaining OSM buildings listed as unmatched.
 */
export function matchOsmToHaloBuildings(
  osm: OsmBuildingFeature[],
  maxMeters = 90,
): {
  matched: MatchedFootprint[];
  unmatchedOsm: OsmBuildingFeature[];
  unmatchedHalo: number[];
} {
  const pins = buildBuildingPins();
  const usedOsm = new Set<number>();
  const matched: MatchedFootprint[] = [];
  const unmatchedHalo: number[] = [];

  // Sort pins by building number for stable assignment
  for (const pin of pins) {
    let best: { i: number; d: number } | null = null;
    for (let i = 0; i < osm.length; i++) {
      if (usedOsm.has(i)) continue;
      const o = osm[i]!;
      const d = haversineMeters(
        { lat: pin.lat, lng: pin.lng },
        { lat: o.centroid.lat, lng: o.centroid.lng },
      );
      if (d > maxMeters) continue;
      if (!best || d < best.d) best = { i, d };
    }
    if (!best) {
      unmatchedHalo.push(pin.building);
      continue;
    }
    usedOsm.add(best.i);
    const o = osm[best.i]!;
    const confidence: MatchedFootprint["confidence"] =
      best.d < 25 ? "high" : best.d < 55 ? "medium" : "low";
    matched.push({
      building: pin.building,
      label: `Building ${pin.building}`,
      osmId: o.osmId,
      osmName: o.name,
      distanceM: Math.round(best.d * 10) / 10,
      centroid: o.centroid,
      ring: o.ring,
      levels: o.levels,
      flats: o.flats,
      areaApproxM2: o.areaApproxM2,
      confidence,
    });
  }

  const unmatchedOsm = osm.filter((_, i) => !usedOsm.has(i));
  matched.sort((a, b) => a.building - b.building);
  return { matched, unmatchedOsm, unmatchedHalo };
}
