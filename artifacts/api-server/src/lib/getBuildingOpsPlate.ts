/**
 * Shared building-ops plate — used by REST, unity-twin, SSE, MCP.
 */
import { desc, eq, gte, isNotNull } from "drizzle-orm";
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
} from "./buildingSiteOps";
import { THORNBURY_SITE_META } from "./thornburySitePlan";
import { haversineMeters } from "./siteTwinCore";
import { buildSiteTwinLayers } from "./siteTwinLayers";
import { getSelection } from "./siteSelection";
import { getMatchedFootprints } from "./footprintsCache";
import {
  countByBuilding,
  countOnSite,
  mergeTwinPresence,
  tagLivePresence,
  thornburyDemoPresence,
  type TwinCrewPresence,
} from "./twinCrewPresence";

export async function getBuildingOpsPlate(
  propertyId: string,
  opts: { demo?: boolean } = {},
) {
  const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!prop) return null;

  const buildings = buildBuildingPins();
  const siteCenter = {
    lat: prop.latitude ?? THORNBURY_SITE_META.lat,
    lng: prop.longitude ?? THORNBURY_SITE_META.lng,
  };

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const siteJobs = await db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId));
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

  const interest = new Set([...lastGps.keys(), ...crewIds]);
  const livePresence: TwinCrewPresence[] = [];
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
      confidence: "far" as "inside" | "near" | "site" | "far",
    };
    let onSite = false;
    if (gps) {
      const s = snapGpsToBuilding({ lat: gps.lat, lng: gps.lng }, buildings);
      snap = s;
      onSite = s.confidence !== "far";
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

    livePresence.push(
      tagLivePresence({
        crewId,
        crewName: crew.name,
        trade: crew.trade ?? null,
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
      }),
    );
  }

  const presence = opts.demo
    ? mergeTwinPresence(livePresence, thornburyDemoPresence(buildings))
    : livePresence;

  const heatPts = trails
    .filter((t) => t.lat != null && t.lng != null)
    .filter((t) => haversineMeters({ lat: t.lat!, lng: t.lng! }, siteCenter) < SITE_M * 1.5)
    .map((t) => ({ lat: t.lat!, lng: t.lng! }));
  const heat = buildHeatmap(heatPts, buildings);

  const unitRows = new Map<
    string,
    { unitNo: string; building: number | null; status: string; jobId: string; jobNo: string | null }
  >();
  for (const j of siteJobs) {
    const u = resolveUnitFromJob(j.unitNo);
    if (!u.unitNo) continue;
    const st = j.status || (j as any).boardStatus || "open";
    unitRows.set(u.unitNo, {
      unitNo: u.unitNo,
      building: u.building,
      status: st,
      jobId: j.id,
      jobNo: j.jobNo,
    });
  }

  const onSiteCount = countOnSite(presence);
  const byBuilding = countByBuilding(presence);

  const centroids = new Map(
    buildings.map((b) => [b.building, { lat: b.lat, lng: b.lng }] as const),
  );
  let layers: Awaited<ReturnType<typeof buildSiteTwinLayers>>;
  try {
    layers = await buildSiteTwinLayers(propertyId, centroids);
  } catch {
    layers = {
      moneyTint: [],
      turnRadar: [],
      photoBillboards: [],
      layerSummary: { hotBuildings: [], watchBuildings: [], overdueTurns: 0, photoCount: 0 },
    };
  }

  let footprints: Awaited<ReturnType<typeof getMatchedFootprints>> = [];
  try {
    footprints = await getMatchedFootprints();
  } catch {
    footprints = [];
  }

  // Attach risk onto building pins for clients
  const tintMap = new Map(layers.moneyTint.map((m) => [m.building, m]));
  const buildingsWithTint = buildings.map((b) => {
    const t = tintMap.get(b.building);
    return {
      ...b,
      risk: t?.risk ?? "clean",
      openTurns: t?.openTurns ?? 0,
      openDiscrepancies: t?.openDiscrepancies ?? 0,
      riskLabel: t?.label ?? b.label,
    };
  });

  return {
    ok: true as const,
    mode: "building_first" as const,
    demo: { active: !!opts.demo, presentationOnly: true },
    propertyId,
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
      overdueTurns: layers.layerSummary.overdueTurns,
      photoCount: layers.layerSummary.photoCount,
      demoActive: !!opts.demo,
      headline:
        onSiteCount === 0
          ? "No crews on site right now"
          : `${onSiteCount} crew${onSiteCount === 1 ? "" : "s"} on site` +
            (Object.keys(byBuilding).length
              ? ` · densest Bldg ${Object.entries(byBuilding).sort((a, b) => b[1] - a[1])[0]![0]}`
              : ""),
    },
    buildings: buildingsWithTint,
    presence,
    heat,
    units: [...unitRows.values()].sort((a, b) => a.unitNo.localeCompare(b.unitNo)),
    byBuilding,
    moneyTint: layers.moneyTint,
    turnRadar: layers.turnRadar,
    photoBillboards: layers.photoBillboards,
    layerSummary: layers.layerSummary,
    selection: getSelection(propertyId),
    footprints,
    footprintsCount: footprints.length,
  };
}

export function qrForProperty(propertyId: string) {
  const buildings = buildBuildingPins();
  return {
    ok: true as const,
    propertyId,
    codes: buildings.map((b) => ({
      building: b.building,
      label: b.label,
      payload: buildingQrPayload(propertyId, b.building),
      scanUrl: `/api/properties/${propertyId}/building-ops/checkin?building=${b.building}`,
    })),
  };
}
