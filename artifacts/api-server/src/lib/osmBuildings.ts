/**
 * Bulk building footprints from OpenStreetMap (Overpass) — no hand mapping.
 *
 * Pulls all ways/relations with building=* in a bbox, returns GeoJSON-ready
 * features + centroids for Halo Site Twin / MapKit.
 */
import { logger } from "./logger";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

export type BBox = { south: number; west: number; north: number; east: number };

export type OsmBuildingFeature = {
  id: string;
  osmType: "way" | "relation";
  osmId: number;
  name: string | null;
  building: string | null;
  levels: number | null;
  flats: string | null;
  /** Ring of [lng, lat] (closed). */
  ring: Array<[number, number]>;
  centroid: { lat: number; lng: number };
  areaApproxM2: number;
};

export type OsmBuildingsResult = {
  ok: true;
  source: "overpass";
  bbox: BBox;
  count: number;
  buildings: OsmBuildingFeature[];
  geojson: {
    type: "FeatureCollection";
    features: Array<{
      type: "Feature";
      id: string;
      properties: Record<string, unknown>;
      geometry: { type: "Polygon"; coordinates: number[][][] };
    }>;
  };
  fetchedAt: string;
};

function overpassQuery(bbox: BBox) {
  const { south, west, north, east } = bbox;
  return `[out:json][timeout:55];
(
  way["building"](${south},${west},${north},${east});
  relation["building"](${south},${west},${north},${east});
);
out body;
>;
out skel qt;`;
}

async function fetchOverpass(query: string): Promise<any> {
  let lastErr: Error | null = null;
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(55000),
      });
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} from ${url}`);
        continue;
      }
      return await res.json();
    } catch (err: any) {
      lastErr = err;
      logger.warn({ err: err.message, url }, "overpass mirror failed");
    }
  }
  throw lastErr || new Error("All Overpass mirrors failed");
}

function ringCentroid(ring: Array<[number, number]>): { lat: number; lng: number } {
  if (!ring.length) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  const use = n > 0 ? n : ring.length;
  for (let i = 0; i < use; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return { lat: lat / use, lng: lng / use };
}

/** Rough area via shoelace in degree-space * cos(lat) scale — relative only. */
function approxAreaM2(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][1] * (Math.PI / 180);
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.cos(lat0);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] * mPerDegLng;
    const y1 = ring[i][1] * mPerDegLat;
    const x2 = ring[i + 1][0] * mPerDegLng;
    const y2 = ring[i + 1][1] * mPerDegLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function parseOverpassToBuildings(data: any): OsmBuildingFeature[] {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways: any[] = [];
  for (const el of data.elements || []) {
    if (el.type === "node") nodes.set(el.id, { lat: el.lat, lon: el.lon });
    else if (el.type === "way" && el.tags?.building) ways.push(el);
  }

  const out: OsmBuildingFeature[] = [];
  for (const w of ways) {
    const ring: Array<[number, number]> = [];
    for (const nid of w.nodes || []) {
      const n = nodes.get(nid);
      if (n) ring.push([n.lon, n.lat]);
    }
    if (ring.length < 3) continue;
    // close ring
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);

    const levels = w.tags["building:levels"] ? Number(w.tags["building:levels"]) : null;
    out.push({
      id: `way/${w.id}`,
      osmType: "way",
      osmId: w.id,
      name: w.tags.name || w.tags["addr:housename"] || null,
      building: w.tags.building || null,
      levels: Number.isFinite(levels) ? levels : null,
      flats: w.tags["building:flats"] || null,
      ring,
      centroid: ringCentroid(ring),
      areaApproxM2: Math.round(approxAreaM2(ring)),
    });
  }

  // Largest first (likely main apartment blocks)
  out.sort((x, y) => y.areaApproxM2 - x.areaApproxM2);
  return out;
}

export async function fetchOsmBuildings(bbox: BBox): Promise<OsmBuildingsResult> {
  const data = await fetchOverpass(overpassQuery(bbox));
  const buildings = parseOverpassToBuildings(data);
  const geojson = {
    type: "FeatureCollection" as const,
    features: buildings.map((b) => ({
      type: "Feature" as const,
      id: b.id,
      properties: {
        name: b.name,
        building: b.building,
        levels: b.levels,
        flats: b.flats,
        osmId: b.osmId,
        areaApproxM2: b.areaApproxM2,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: [b.ring],
      },
    })),
  };
  return {
    ok: true,
    source: "overpass",
    bbox,
    count: buildings.length,
    buildings,
    geojson,
    fetchedAt: new Date().toISOString(),
  };
}

/** Default bbox around Thornbury / Watters Creek (from live OSM sample). */
export const THORNBURY_BBOX: BBox = {
  south: 33.0705,
  west: -96.6975,
  north: 33.0755,
  east: -96.692,
};

/** Expand property lat/lng into a small bbox (~600m). */
export function bboxAround(lat: number, lng: number, meters = 500): BBox {
  const dLat = meters / 111320;
  const dLng = meters / (111320 * Math.cos((lat * Math.PI) / 180));
  return {
    south: lat - dLat,
    west: lng - dLng,
    north: lat + dLat,
    east: lng + dLng,
  };
}
