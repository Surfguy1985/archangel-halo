/**
 * Property GPS pin + Site Twin (unit-level live locator).
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lte, or } from "drizzle-orm";
import {
  db,
  propertiesTable,
  propertyUnitsTable,
  jobsTable,
  crewsTable,
  crewCheckinsTable,
  crewTrackPointsTable,
  crewPhotosTable,
  invoicesTable,
} from "@workspace/db";
import type { PgColumn } from "drizzle-orm/pg-core";
import { fetchBuildingFootprint, nominatimReverse } from "../lib/geocode";
import { localYmd } from "../lib/jarvisOpsCore";
import { computeUnitStatuses, normUnit } from "./clientCms";
import {
  bboxFromRing,
  computePresenceDay,
  downsampleTrail,
  humanMinutes,
  padBBoxAround,
  snapGpsToFloor,
  unitCentroid,
  unitTitleSummary,
  type FloorUnit,
  type GeoPoint,
  type PresenceDay,
  type TrackPing,
} from "../lib/siteTwinCore";
import { buildThornburySiteUnits, THORNBURY_SITE_META } from "../lib/thornburySitePlan";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const buildingCache = new Map<string, { at: number; ring: GeoPoint[]; source: "osm" | "pad" }>();

// The twin polls every few seconds and unit statuses sweep every job, request,
// invoice and line item for the property — far too heavy to redo per poll, and
// the answer cannot meaningfully change that fast.
const statusCache = new Map<
  string,
  { at: number; value: Awaited<ReturnType<typeof computeUnitStatuses>> }
>();
const STATUS_TTL_MS = 15_000;

async function cachedUnitStatuses(
  propertyId: string,
): Promise<Awaited<ReturnType<typeof computeUnitStatuses>>> {
  const hit = statusCache.get(propertyId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value;
  const value = await computeUnitStatuses(propertyId);
  statusCache.set(propertyId, { at: Date.now(), value });
  return value;
}

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
  const siteJobIds = siteJobs.map((j) => j.id);

  // GPS reads are scoped to THIS site. A global row cap would let a busy
  // sister property push this property's own breadcrumbs out of the window,
  // which reads on screen as "the crew vanished". Two buckets are unioned:
  //   - anything pinging near this site (catches a crew nobody assigned here)
  //   - every crew on live work here, wherever they are — that second bucket
  //     is exactly how the "assigned here but off-site" exception is detected,
  //     so it must NOT be geo-filtered.
  const GEO_PAD = 0.02; // ~2km, far wider than the on-site radius
  const nearSite = (lat: PgColumn, lng: PgColumn) =>
    and(
      gte(lat, bbox.south - GEO_PAD),
      lte(lat, bbox.north + GEO_PAD),
      gte(lng, bbox.west - GEO_PAD),
      lte(lng, bbox.east + GEO_PAD),
    );
  const assignedCrew = crewIds.length ? crewIds : null;

  const [allCrews, lastCheckins, trails, invoices, sitePhotos, unitStatuses] = await Promise.all([
    // The roster table is small and is needed to name crews discovered by GPS
    // alone, so it is read whole on purpose.
    db.select().from(crewsTable),
    db
      .select()
      .from(crewCheckinsTable)
      .where(
        and(
          isNotNull(crewCheckinsTable.lat),
          or(
            nearSite(crewCheckinsTable.lat, crewCheckinsTable.lng),
            assignedCrew ? inArray(crewCheckinsTable.crewId, assignedCrew) : undefined,
          ),
        ),
      )
      .orderBy(desc(crewCheckinsTable.createdAt))
      .limit(400),
    db
      .select()
      .from(crewTrackPointsTable)
      .where(
        and(
          gte(crewTrackPointsTable.createdAt, dayStart),
          or(
            nearSite(crewTrackPointsTable.lat, crewTrackPointsTable.lng),
            assignedCrew ? inArray(crewTrackPointsTable.crewId, assignedCrew) : undefined,
          ),
        ),
      )
      .orderBy(desc(crewTrackPointsTable.createdAt))
      .limit(8000),
    db.select().from(invoicesTable).where(eq(invoicesTable.propertyId, id)),
    siteJobIds.length
      ? db
          .select()
          .from(crewPhotosTable)
          .where(inArray(crewPhotosTable.jobId, siteJobIds))
          .orderBy(desc(crewPhotosTable.createdAt))
          .limit(300)
      : Promise.resolve([] as (typeof crewPhotosTable.$inferSelect)[]),
    cachedUnitStatuses(id),
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

  // ---- Presence — today's breadcrumbs, reduced to unit visits -------------
  // The day is already in memory from the query above, so dwell costs no extra
  // round trip. Only watched crews are reduced; everyone else is noise here.
  const pingsByCrew = new Map<string, TrackPing[]>();
  for (const t of trails) {
    if (!watchIds.has(t.crewId)) continue;
    const ping: TrackPing = { lat: t.lat, lng: t.lng, at: t.createdAt };
    const list = pingsByCrew.get(t.crewId);
    if (list) list.push(ping);
    else pingsByCrew.set(t.crewId, [ping]);
  }
  const presenceByCrew = new Map<string, PresenceDay>();
  for (const [cid, pings] of pingsByCrew) {
    presenceByCrew.set(cid, computePresenceDay(pings, bbox, floor, center));
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
      const presence = presenceByCrew.get(cid) ?? null;
      const inUnit = snap.confidence === "inside" || snap.confidence === "near";
      const minutesHere = presence && snap.unitId ? presence.minutesByUnit[snap.unitId] ?? 0 : 0;
      const baseTitle = unitTitleSummary({
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
        jobId: job?.id ?? null,
        jobNo: job?.jobNo ?? null,
        jobUnit: job?.unitNo ?? null,
        unitId: snap.unitId,
        unitLabel,
        meters: snap.meters,
        confidence: snap.confidence,
        // Dwell is the whole point of the roster line: "in unit" means little
        // without "for how long".
        title: inUnit && minutesHere > 0 ? `${baseTitle} · ${humanMinutes(minutesHere)}` : baseTitle,
        minutesHere,
        onSiteMinutes: presence?.onSiteMinutes ?? 0,
        arrivedAt: presence?.firstSeenAt ?? null,
        visits: presence?.visits ?? [],
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null)
    .sort((a, b) => {
      const rank = { inside: 0, near: 1, site: 2, far: 3 };
      return rank[a.confidence] - rank[b.confidence] || a.name.localeCompare(b.name);
    });

  // ---- Unit state — what every box on the plate is actually doing ---------
  const nowMs = Date.now();
  const DAY_MS = 86_400_000;
  const FRESH_MS = 5 * 60 * 1000;
  const daysSince = (d: Date | string | null | undefined): number | null =>
    d == null ? null : Math.max(0, Math.floor((nowMs - new Date(d).getTime()) / DAY_MS));

  const jobById = new Map(siteJobs.map((j) => [j.id, j]));
  const jobsByUnit = new Map<string, typeof siteJobs>();
  for (const j of siteJobs) {
    const key = normUnit(j.unitNo);
    if (!key) continue;
    const list = jobsByUnit.get(key);
    if (list) list.push(j);
    else jobsByUnit.set(key, [j]);
  }

  // Money owed, keyed by unit. Drafts and cancellations are not owed money.
  const unpaidByUnit = new Map<string, number>();
  for (const inv of invoices) {
    if (["paid", "cancelled", "draft"].includes(inv.status)) continue;
    const job = inv.jobId ? jobById.get(inv.jobId) : undefined;
    const key = normUnit(job?.unitNo);
    if (!key) continue;
    unpaidByUnit.set(key, (unpaidByUnit.get(key) ?? 0) + inv.amount + (inv.taxAmount ?? 0));
  }

  // Photos anchor to a unit by where the phone was standing when the shutter
  // fired; only when a photo carries no fix does it fall back to the job's
  // unit number. That difference is what makes a photo evidence.
  type PlatePhoto = { id: string; url: string; phase: string | null; at: string; geo: boolean; crewId: string };
  const photosByUnit = new Map<string, PlatePhoto[]>();
  let photosToday = 0;
  for (const p of sitePhotos) {
    const takenAt = p.capturedAt ?? p.createdAt;
    if (takenAt.getTime() >= dayStart.getTime()) photosToday += 1;
    let key: string | null = null;
    let geo = false;
    if (p.lat != null && p.lng != null) {
      const s = snapGpsToFloor({ lat: p.lat, lng: p.lng }, bbox, floor, center);
      if ((s.confidence === "inside" || s.confidence === "near") && s.label) {
        key = normUnit(s.label);
        geo = true;
      }
    }
    if (!key) {
      const job = p.jobId ? jobById.get(p.jobId) : undefined;
      key = normUnit(job?.unitNo) || null;
    }
    if (!key) continue;
    const entry: PlatePhoto = {
      id: p.id,
      url: `/api/storage${p.storagePath}`,
      phase: p.phase,
      at: takenAt.toISOString(),
      geo,
      crewId: p.crewId,
    };
    const list = photosByUnit.get(key);
    if (list) list.push(entry);
    else photosByUnit.set(key, [entry]);
  }

  const minutesByUnitId = new Map<string, number>();
  for (const presence of presenceByCrew.values()) {
    for (const [uid, mins] of Object.entries(presence.minutesByUnit)) {
      minutesByUnitId.set(uid, (minutesByUnitId.get(uid) ?? 0) + mins);
    }
  }

  const plateUnits = units.map((u) => {
    const key = normUnit(u.label);
    const unitJobs = jobsByUnit.get(key) ?? [];
    const open = unitJobs.filter(
      (j) => !["complete", "paid", "cancelled"].includes(j.status) && j.boardStatus !== "removed",
    );
    const status = unitStatuses.byUnit.get(key);
    const occupant =
      crews.find(
        (c) =>
          c.unitId === u.id &&
          (c.confidence === "inside" || c.confidence === "near") &&
          c.at != null &&
          nowMs - new Date(c.at).getTime() <= FRESH_MS,
      ) ?? null;
    const lastDone = unitJobs
      .filter((j) => j.completedAt)
      .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime())[0] ?? null;
    const activeJob = open.find((j) => j.scheduledOn === today) ?? open[0] ?? null;
    const unpaid = unpaidByUnit.get(key) ?? 0;
    const photos = photosByUnit.get(key) ?? [];

    // Precedence matters: a blocked unit stays blocked even while someone is
    // standing in it, because that is the fact the office has to act on.
    let state: "blocked" | "active" | "turning" | "scheduled" | "ready" | "idle";
    if (status?.status === "red") state = "blocked";
    else if (occupant) state = "active";
    else if (open.some((j) => j.crewLeaderId || j.status !== "open")) state = "turning";
    else if (open.length > 0) state = "scheduled";
    else if (lastDone && (daysSince(lastDone.completedAt) ?? 999) <= 30) state = "ready";
    else state = "idle";

    const stageSince =
      state === "ready" || state === "idle"
        ? lastDone?.completedAt ?? null
        : activeJob?.scheduledOn ?? activeJob?.createdAt ?? null;

    const crewName =
      occupant?.name ??
      (activeJob?.crewLeaderId ? allCrews.find((c) => c.id === activeJob.crewLeaderId)?.name ?? null : null);

    return {
      ...u,
      state,
      reasons: status?.reasons ?? [],
      daysInStage: daysSince(stageSince),
      jobId: activeJob?.id ?? null,
      jobNo: activeJob?.jobNo ?? null,
      jobLabel: activeJob?.category ?? activeJob?.description ?? null,
      jobStatus: activeJob?.status ?? null,
      scheduledOn: activeJob?.scheduledOn ?? null,
      crewId: occupant?.id ?? activeJob?.crewLeaderId ?? null,
      crewName,
      openJobs: open.length,
      unpaid: Math.round(unpaid * 100) / 100,
      minutesToday: minutesByUnitId.get(u.id) ?? 0,
      photos: photos.slice(0, 3),
      photoCount: photos.length,
      occupied: occupant != null,
    };
  });

  const countOf = (s: string) => plateUnits.filter((u) => u.state === s).length;
  const counts = {
    total: plateUnits.length,
    blocked: countOf("blocked"),
    active: countOf("active"),
    turning: countOf("turning"),
    scheduled: countOf("scheduled"),
    ready: countOf("ready"),
    idle: countOf("idle"),
    unpaid: Math.round(plateUnits.reduce((sum, u) => sum + u.unpaid, 0) * 100) / 100,
    minutesToday: plateUnits.reduce((sum, u) => sum + u.minutesToday, 0),
    photosToday,
  };

  // ---- Replay — the day's movement, thinned enough to scrub smoothly ------
  const replay = {
    since: dayStart.toISOString(),
    crews: [...pingsByCrew]
      .map(([cid, pings]) => {
        const sorted = [...pings].sort(
          (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
        );
        return {
          id: cid,
          name: allCrews.find((c) => c.id === cid)?.name ?? "Crew",
          points: downsampleTrail(sorted, 240).map((p) => ({
            lat: p.lat,
            lng: p.lng,
            t: new Date(p.at).toISOString(),
          })),
        };
      })
      .filter((c) => c.points.length > 1),
  };

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
    units: plateUnits,
    crews,
    counts,
    replay,
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


/** Apply full Thornbury leasing-map unit plate (buildings 1–20). Idempotent. */
router.post("/properties/:id/apply-thornbury-site-plan", async (req, res): Promise<void> => {
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
  const siteUnits = buildThornburySiteUnits();
  const existing = await db
    .select()
    .from(propertyUnitsTable)
    .where(eq(propertyUnitsTable.propertyId, id));
  const byLabel = new Map(existing.map((u) => [u.label, u]));
  let inserted = 0;
  let updated = 0;
  const toInsert = siteUnits.filter((u) => !byLabel.has(u.label));
  for (let i = 0; i < toInsert.length; i += 80) {
    const chunk = toInsert.slice(i, i + 80);
    await db.insert(propertyUnitsTable).values(
      chunk.map((u) => ({
        propertyId: id,
        label: u.label,
        x: u.x,
        y: u.y,
        w: u.w,
        h: u.h,
      })),
    );
    inserted += chunk.length;
  }
  for (const u of siteUnits) {
    const row = byLabel.get(u.label);
    if (!row) continue;
    await db
      .update(propertyUnitsTable)
      .set({ x: u.x, y: u.y, w: u.w, h: u.h, updatedAt: new Date() })
      .where(eq(propertyUnitsTable.id, row.id));
    updated += 1;
  }
  // Ensure property pin is on site
  if (p.latitude == null || p.longitude == null) {
    await db
      .update(propertiesTable)
      .set({
        latitude: THORNBURY_SITE_META.lat,
        longitude: THORNBURY_SITE_META.lng,
        address: THORNBURY_SITE_META.address,
        city: "Plano",
      })
      .where(eq(propertiesTable.id, id));
  }
  logger.info({ propertyId: id, inserted, updated, total: siteUnits.length }, "thornbury site plan applied");
  res.json({
    ok: true,
    propertyId: id,
    inserted,
    updated,
    totalUnits: siteUnits.length,
    meta: THORNBURY_SITE_META,
    message: "Site plan applied — open Site Twin to see units + live crew GPS",
  });
});


export default router;
