/**
 * Building-first site ops — no per-unit photo mapping.
 * Property → buildings → job unit → crew GPS heat + QR check-in.
 */
import { Router } from "express";
import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm";
import {
  db,
  propertiesTable,
  jobsTable,
  crewsTable,
  crewCheckinsTable,
  crewTrackPointsTable,
} from "@workspace/db";
import {
  buildBuildingPins,
  buildHeatmap,
  snapGpsToBuilding,
  resolveUnitFromJob,
  presenceTitle,
  buildingQrPayload,
  SITE_M,
} from "../lib/buildingSiteOps";
import { THORNBURY_SITE_META } from "../lib/thornburySitePlan";
import { haversineMeters } from "../lib/siteTwinCore";
import { logger } from "../lib/logger";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/building-ops/health", (_req, res) => {
  res.json({ ok: true, service: "building-ops", version: 1 });
});

/** Full building plate + live crew presence (job unit = truth). */
router.get("/properties/:id/building-ops", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  try {
    const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
    if (!prop) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const buildings = buildBuildingPins();
    const siteCenter = {
      lat: prop.latitude ?? THORNBURY_SITE_META.lat,
      lng: prop.longitude ?? THORNBURY_SITE_META.lng,
    };

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    const siteJobs = await db.select().from(jobsTable).where(eq(jobsTable.propertyId, id));
    const liveJobs = siteJobs.filter((j) => !["complete", "paid", "cancelled"].includes(j.status || ""));
    const crewIds = [
      ...new Set(liveJobs.map((j) => j.crewLeaderId).filter((x): x is string => !!x)),
    ];

    const [allCrews, checkins, trails] = await Promise.all([
      db.select().from(crewsTable),
      db
        .select()
        .from(crewCheckinsTable)
        .where(isNotNull(crewCheckinsTable.lat))
        .orderBy(desc(crewCheckinsTable.createdAt))
        .limit(500),
      db
        .select()
        .from(crewTrackPointsTable)
        .where(gte(crewTrackPointsTable.createdAt, dayStart))
        .orderBy(desc(crewTrackPointsTable.createdAt))
        .limit(2000),
    ]);

    const crewById = new Map(allCrews.map((c) => [c.id, c]));
    const jobByCrew = new Map<string, (typeof liveJobs)[0]>();
    for (const j of liveJobs) {
      if (j.crewLeaderId && !jobByCrew.has(j.crewLeaderId)) jobByCrew.set(j.crewLeaderId, j);
    }

    // Latest GPS per crew (prefer today's trail, else checkin)
    const lastGps = new Map<string, { lat: number; lng: number; at: string | null }>();
    for (const t of trails) {
      if (t.lat == null || t.lng == null) continue;
      if (!lastGps.has(t.crewId)) {
        lastGps.set(t.crewId, {
          lat: t.lat,
          lng: t.lng,
          at: t.createdAt?.toISOString?.() ?? null,
        });
      }
    }
    for (const c of checkins) {
      if (c.lat == null || c.lng == null) continue;
      if (!lastGps.has(c.crewId)) {
        lastGps.set(c.crewId, {
          lat: c.lat,
          lng: c.lng,
          at: c.createdAt?.toISOString?.() ?? null,
        });
      }
    }

    // Include crews with live jobs even if GPS is cold
    const interest = new Set([...lastGps.keys(), ...crewIds]);
    const presence = [];
    for (const crewId of interest) {
      const crew = crewById.get(crewId);
      if (!crew) continue;
      const gps = lastGps.get(crewId);
      const job = jobByCrew.get(crewId) ?? null;
      const fromJob = resolveUnitFromJob(job?.unitNo ?? null);
      let snap = {
        building: null as number | null,
        label: null as string | null,
        meters: null as number | null,
        confidence: "far" as const,
      };
      let onSite = false;
      if (gps) {
        const s = snapGpsToBuilding({ lat: gps.lat, lng: gps.lng }, buildings);
        snap = s;
        onSite = s.confidence !== "far";
        // Prefer job's building if GPS is only "site"
        if (fromJob.building != null && (s.confidence === "site" || s.building == null)) {
          snap = {
            building: fromJob.building,
            label: `Building ${fromJob.building}`,
            meters: s.meters,
            confidence: s.confidence === "far" ? "site" : s.confidence,
          };
        }
      } else if (fromJob.building != null) {
        snap = {
          building: fromJob.building,
          label: `Building ${fromJob.building}`,
          meters: null,
          confidence: "site",
        };
      }

      presence.push({
        crewId,
        crewName: crew.name,
        lat: gps?.lat ?? null,
        lng: gps?.lng ?? null,
        at: gps?.at ?? null,
        onSite,
        building: snap.building,
        buildingLabel: snap.label,
        confidence: snap.confidence,
        meters: snap.meters,
        jobId: job?.id ?? null,
        jobNo: job?.jobNo ?? null,
        unitNo: fromJob.unitNo,
        unitFromJob: !!fromJob.unitNo,
        title: presenceTitle({
          unitNo: fromJob.unitNo,
          building: snap.building,
          confidence: snap.confidence,
          meters: snap.meters,
          unitFromJob: !!fromJob.unitNo,
        }),
      });
    }

    // Heat from today's trails near site
    const heatPts = trails
      .filter((t) => t.lat != null && t.lng != null)
      .filter((t) => haversineMeters({ lat: t.lat!, lng: t.lng! }, siteCenter) < SITE_M * 1.5)
      .map((t) => ({ lat: t.lat!, lng: t.lng! }));
    const heat = buildHeatmap(heatPts, buildings);

    // Unit status list (trust job board — no geometry)
    const unitRows = new Map<
      string,
      { unitNo: string; building: number | null; status: string; jobId: string; jobNo: string | null }
    >();
    for (const j of siteJobs) {
      const u = resolveUnitFromJob(j.unitNo);
      if (!u.unitNo) continue;
      const st = j.status || j.boardStatus || "open";
      unitRows.set(u.unitNo, {
        unitNo: u.unitNo,
        building: u.building,
        status: st,
        jobId: j.id,
        jobNo: j.jobNo,
      });
    }

    const onSiteCount = presence.filter((p) => p.onSite).length;
    const byBuilding: Record<string, number> = {};
    for (const p of presence) {
      if (p.building != null && p.onSite) {
        byBuilding[String(p.building)] = (byBuilding[String(p.building)] || 0) + 1;
      }
    }

    res.json({
      ok: true,
      mode: "building_first",
      propertyId: id,
      propertyName: prop.name,
      site: siteCenter,
      meta: THORNBURY_SITE_META,
      summary: {
        buildings: buildings.length,
        crewsTracked: presence.length,
        onSite: onSiteCount,
        offSite: presence.length - onSiteCount,
        liveJobs: liveJobs.length,
        heatCells: heat.length,
        headline:
          onSiteCount === 0
            ? "No crews on site right now"
            : `${onSiteCount} crew${onSiteCount === 1 ? "" : "s"} on site` +
              (Object.keys(byBuilding).length
                ? ` · densest Bldg ${Object.entries(byBuilding).sort((a, b) => b[1] - a[1])[0]![0]}`
                : ""),
      },
      buildings,
      presence,
      heat,
      units: [...unitRows.values()].sort((a, b) => a.unitNo.localeCompare(b.unitNo)),
      byBuilding,
    });
  } catch (err: any) {
    logger.error({ err }, "building-ops failed");
    res.status(500).json({ error: err.message || "building-ops failed" });
  }
});

/** QR payloads for all buildings (print & post at breezeways). */
router.get("/properties/:id/building-ops/qr", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const buildings = buildBuildingPins();
  res.json({
    ok: true,
    propertyId: id,
    codes: buildings.map((b) => ({
      building: b.building,
      label: b.label,
      payload: buildingQrPayload(id, b.building),
      scanUrl: `/api/properties/${id}/building-ops/checkin?building=${b.building}`,
    })),
  });
});

/** Hard building check-in (QR / NFC). Body: { crewId, building, lat?, lng? } */
router.post("/properties/:id/building-ops/checkin", async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid property" });
    return;
  }
  const crewId = String(req.body?.crewId ?? "");
  const building = Number(req.body?.building ?? req.query.building);
  if (!UUID_RE.test(crewId) || !Number.isFinite(building) || building < 1 || building > 20) {
    res.status(400).json({ error: "crewId and building (1–20) required" });
    return;
  }
  const pins = buildBuildingPins();
  const pin = pins.find((b) => b.building === building);
  if (!pin) {
    res.status(404).json({ error: "Unknown building" });
    return;
  }
  const lat = typeof req.body?.lat === "number" ? req.body.lat : pin.lat;
  const lng = typeof req.body?.lng === "number" ? req.body.lng : pin.lng;

  await db.insert(crewCheckinsTable).values({
    crewId,
    kind: "building_qr",
    lat,
    lng,
    label: `Building ${building}`,
    note: `QR/NFC check-in Building ${building}`,
  });

  res.json({
    ok: true,
    building,
    label: pin.label,
    lat,
    lng,
    message: `Checked in at Building ${building}`,
  });
});

export default router;
