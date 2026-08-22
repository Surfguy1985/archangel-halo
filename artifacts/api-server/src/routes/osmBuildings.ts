/**
 * OSM bulk footprints — no hand mapping.
 *
 * GET  /api/osm/buildings?south=&west=&north=&east=
 * GET  /api/osm/buildings/thornbury
 * GET  /api/properties/:id/osm-buildings
 * GET  /api/osm/buildings/geojson?...  (raw FeatureCollection)
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import {
  fetchOsmBuildings,
  THORNBURY_BBOX,
  bboxAround,
  type BBox,
} from "../lib/osmBuildings";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// In-memory cache (15 min)
const cache = new Map<string, { at: number; data: any }>();
const TTL = 15 * 60 * 1000;

function cacheKey(b: BBox) {
  return `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`;
}

async function cachedFetch(bbox: BBox) {
  const key = cacheKey(bbox);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };
  const data = await fetchOsmBuildings(bbox);
  cache.set(key, { at: Date.now(), data });
  return { ...data, cached: false };
}

router.get("/osm/buildings/health", (_req, res) => {
  res.json({
    ok: true,
    service: "osm-buildings",
    note: "Bulk footprints via Overpass — no hand mapping",
    endpoints: [
      "GET /api/osm/buildings/thornbury",
      "GET /api/osm/buildings?south=&west=&north=&east=",
      "GET /api/properties/:id/osm-buildings",
    ],
  });
});

router.get("/osm/buildings/thornbury", async (_req, res) => {
  try {
    const data = await cachedFetch(THORNBURY_BBOX);
    res.json(data);
  } catch (err: any) {
    logger.error({ err }, "osm thornbury failed");
    res.status(502).json({ error: err.message || "Overpass failed" });
  }
});

router.get("/osm/buildings", async (req, res) => {
  try {
    const south = Number(req.query.south);
    const west = Number(req.query.west);
    const north = Number(req.query.north);
    const east = Number(req.query.east);
    if (![south, west, north, east].every(Number.isFinite)) {
      res.status(400).json({
        error: "Query params required: south,west,north,east",
        example: "/api/osm/buildings?south=33.0705&west=-96.6975&north=33.0755&east=-96.692",
        thornbury: "/api/osm/buildings/thornbury",
      });
      return;
    }
    const data = await cachedFetch({ south, west, north, east });
    if (req.query.format === "geojson") {
      res.json(data.geojson);
      return;
    }
    res.json(data);
  } catch (err: any) {
    logger.error({ err }, "osm buildings failed");
    res.status(502).json({ error: err.message || "Overpass failed" });
  }
});

router.get("/properties/:id/osm-buildings", async (req, res) => {
  try {
    const id = String(req.params.id || "");
    if (!UUID_RE.test(id)) {
      res.status(400).json({ error: "Invalid property id" });
      return;
    }
    const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id)).limit(1);
    if (!prop) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    const lat = Number((prop as any).lat ?? (prop as any).latitude);
    const lng = Number((prop as any).lng ?? (prop as any).longitude);
    const bbox =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? bboxAround(lat, lng, Number(req.query.meters) || 550)
        : THORNBURY_BBOX;
    const data = await cachedFetch(bbox);
    res.json({
      ...data,
      propertyId: id,
      propertyName: prop.name,
      bboxSource:
        Number.isFinite(lat) && Number.isFinite(lng) ? "property_lat_lng" : "thornbury_default",
    });
  } catch (err: any) {
    logger.error({ err }, "property osm-buildings failed");
    res.status(502).json({ error: err.message || "Overpass failed" });
  }
});

export default router;
