/**
 * Property GPS pin + Site Twin (unit-level live locator).
 */
import { Router, type IRouter } from "express";
import { desc, eq, gte, isNotNull } from "drizzle-orm";
import {
  db,
  propertiesTable,
  propertyUnitsTable,
  jobsTable,
  crewsTable,
  crewCheckinsTable,
  crewTrackPointsTable,
} from "@workspace/db";
import { fetchBuildingFootprint, nominatimReverse } from "../lib/geocode";
import { localYmd } from "../lib/jarvisOpsCore";
import {
  bboxFromRing,
  padBBoxAround,
  snapGpsToFloor,
  unitCentroid,
  unitTitleSummary,
  type FloorUnit,
  type GeoPoint,
} from "../lib/siteTwinCore";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const buildingCache = new Map<string, { at: number; ring: GeoPoint[]; source: "osm" | "pad" }>();

function parseCoord(n: unknown): number | null {
  const v = typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN;
  return Number.isFinite(v) ? v : null;
}

router.get("/properties/:id/gps", async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!p) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  res.json({
    ok: true,
    latitude: p.latitude,
    longitude: p.longitude,
    address: p.address,
    city: p.city,
    geocodedAt: p.geocodedAt,
  });
});

router.post("/properties/:id/gps", async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const lat = parseCoord(req.body?.latitude ?? req.body?.lat);
  const lng = parseCoord(req.body?.longitude ?? req.body?.lng);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    res.status(400).json({ error: "latitude and longitude are required" });
    return;
  }
  const [existing] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const updateAddress = req.body?.updateAddress === true;
  let address = typeof req.body?.address === "string" ? req.body.address.trim() : "";
  if (updateAddress && !address) {
    address = (await nominatimReverse(lat, lng)) ?? "";
  }
  const [row] = await db
    .update(propertiesTable)
    .set({
      latitude: lat,
      longitude: lng,
      geocodedAt: new Date(),
      ...(updateAddress && address ? { address } : {}),
    })
    .where(eq(propertiesTable.id, id))
    .returning();
  buildingCache.delete(id);
  res.json({
    ok: true,
    latitude: row?.latitude ?? lat,
    longitude: row?.longitude ?? lng,
    address: row?.address ?? existing.address,
  });
});

router.get("/properties/:id/site-twin", async (req, res): Promise<void> => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  const lat = property.latitude;
  const lng = property.longitude;
  if (lat == null || lng == null) {
    res.json({
      ok: true,
      ready: false,
      reason: "unpinned",
      property: {
        id: property.id,
        name: property.name,
        address: property.address,
        city: property.city,
        units: property.units,
      },
      latitude: null,
      longitude: null,
      footprint: null,
      bbox: null,
      units: [],
      crews: [],
      headline: `${property.name} — pin GPS to open the site twin`,
      setup: {
        pinned: false,
        unitCount: 0,
        expectedUnits: property.units ?? 0,
        liveGps: 0,
      },
    });
    return;
  }

  const center: GeoPoint = { lat, lng };
  let footprint = buildingCache.get(id);
  if (!footprint || Date.now() - footprint.at > 60 * 60 * 1000) {
    const fetched = await fetchBuildingFootprint(center);
    footprint = { at: Date.now(), ring: fetched.ring, source: fetched.source };
    buildingCache.set(id, footprint);
  }

  const bbox = bboxFromRing(footprint.ring) ?? padBBoxAround(center, 45);
  const unitRows = await db
    .select()
    .from(propertyUnitsTable)
    .where(eq(propertyUnitsTable.propertyId, id));
  const floor: FloorUnit[] = unitRows.map((u) => ({
    id: u.id,
    label: u.label,
    x: u.x,
    y: u.y,
    w: u.w,
    h: u.h,
  }));
  const units = floor.map((u) => {
    const c = unitCentroid(u, bbox);
    return { ...u, lat: c.lat, lng: c.lng };
  });

  const today = localYmd(new Date());
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const siteJobs = await db.select().from(jobsTable).where(eq(jobsTable.propertyId, id));
  const liveJobs = siteJobs.filter((j) => !["complete", "paid", "cancelled"].includes(j.status));
  const crewIds = [...new Set(liveJobs.map((j) => j.crewLeaderId).filter((x): x is string => !!x))];

  const [allCrews, lastCheckins, trails] = await Promise.all([
    db.select().from(crewsTable),
    db
      .select()
      .from(crewCheckinsTable)
      .where(isNotNull(crewCheckinsTable.lat))
      .orderBy(desc(crewCheckinsTable.createdAt))
      .limit(400),
    db
      .select()
      .from(crewTrackPointsTable)
      .where(gte(crewTrackPointsTable.createdAt, dayStart))
      .orderBy(desc(crewTrackPointsTable.createdAt))
      .limit(8000),
  ]);

  const lastGps = new Map<string, GeoPoint & { at: string }>();
  for (const t of trails) {
    if (lastGps.has(t.crewId)) continue;
    lastGps.set(t.crewId, { lat: t.lat, lng: t.lng, at: t.createdAt.toISOString() });
  }
  for (const c of lastCheckins) {
    if (c.lat == null || c.lng == null) continue;
    if (lastGps.has(c.crewId)) continue;
    lastGps.set(c.crewId, { lat: c.lat, lng: c.lng, at: c.createdAt.toISOString() });
  }

  const watchIds = new Set(crewIds);
  for (const [cid, gps] of lastGps) {
    const snap = snapGpsToFloor(gps, bbox, floor, center);
    if (snap.confidence !== "far") watchIds.add(cid);
  }

  const crews = [...watchIds]
    .map((cid) => {
      const crew = allCrews.find((c) => c.id === cid);
      if (!crew) return null;
      const gps = lastGps.get(cid);
      const job =
        liveJobs.find((j) => j.crewLeaderId === cid && j.scheduledOn === today) ??
        liveJobs.find((j) => j.crewLeaderId === cid) ??
        null;
      const snap = gps
        ? snapGpsToFloor(gps, bbox, floor, center)
        : {
            unitId: null,
            label: job?.unitNo ?? null,
            meters: null,
            confidence: job ? ("site" as const) : ("far" as const),
            frac: null,
          };
      const unitLabel = snap.confidence === "inside" || snap.confidence === "near" ? snap.label : snap.label ?? job?.unitNo ?? null;
      const title = unitTitleSummary({
        unitLabel,
        crewName: crew.name,
        trade: crew.trade ?? job?.category ?? null,
        confidence: snap.confidence,
        meters: snap.meters,
      });
      return {
        id: crew.id,
        name: crew.name,
        trade: crew.trade,
        phone: crew.phone,
        selfiePath: crew.selfiePath,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        at: gps?.at ?? null,
        jobNo: job?.jobNo ?? null,
        jobUnit: job?.unitNo ?? null,
        unitId: snap.unitId,
        unitLabel,
        meters: snap.meters,
        confidence: snap.confidence,
        title,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => {
      const rank = { inside: 0, near: 1, site: 2, far: 3 };
      return rank[a.confidence] - rank[b.confidence] || a.name.localeCompare(b.name);
    });

  const lead = crews.find((c) => c.confidence === "inside" || c.confidence === "near") ?? crews[0] ?? null;
  const inferredUnits = new Set(
    siteJobs.map((j) => (j.unitNo ?? "").trim()).filter((u) => u.length > 0),
  ).size;
  const expectedUnits = property.units || inferredUnits;
  const liveGps = crews.filter((c) => c.lat != null).length;
  const freshGps = crews.filter((c) => {
    if (c.lat == null || !c.at) return false;
    return Date.now() - new Date(c.at).getTime() <= 5 * 60 * 1000;
  }).length;

  res.json({
    ok: true,
    ready: true,
    property: {
      id: property.id,
      name: property.name,
      address: property.address,
      city: property.city,
      units: property.units,
    },
    latitude: lat,
    longitude: lng,
    footprint: { ring: footprint.ring, source: footprint.source },
    bbox,
    units,
    crews,
    headline: lead?.title ?? (units.length === 0
      ? `${property.name} — lay out units so GPS can snap to apartments`
      : `${property.name} — no crew GPS on the plate yet`),
    setup: {
      pinned: true,
      unitCount: units.length,
      expectedUnits,
      inferredUnits,
      liveGps,
      freshGps,
    },
  });
});

export default router;
