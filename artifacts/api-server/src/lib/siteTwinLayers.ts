/**
 * Site Twin layers 1–5 support:
 * - Money / discrepancy tint per building
 * - Turn radar (open turns with age/SLA risk)
 * - Photo billboards (recent before/after)
 */
import { desc, eq, inArray } from "drizzle-orm";
import { db, jobsTable, crewPhotosTable } from "@workspace/db";
import { resolveUnitFromJob } from "./buildingSiteOps";

export type BuildingMoneyTint = {
  building: number;
  openDiscrepancies: number;
  openTurns: number;
  risk: "clean" | "watch" | "hot";
  label: string;
};

export type TurnRadarItem = {
  jobId: string;
  jobNo: string | null;
  unitNo: string | null;
  building: number | null;
  status: string;
  ageHours: number;
  risk: "ok" | "aging" | "overdue";
  lat: number | null;
  lng: number | null;
};

export type PhotoBillboard = {
  id: string;
  jobId: string | null;
  unitNo: string | null;
  building: number | null;
  phase: string | null;
  note: string | null;
  storagePath: string | null;
  lat: number | null;
  lng: number | null;
  capturedAt: string | null;
};

function ageHours(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return Math.max(0, (Date.now() - t) / 3600000);
}

export async function buildSiteTwinLayers(propertyId: string, buildingCentroids: Map<number, { lat: number; lng: number }>) {
  const jobs = await db.select().from(jobsTable).where(eq(jobsTable.propertyId, propertyId));
  const openStatuses = new Set(["open", "active", "in_progress", "scheduled", "dispatched", "qc", "pending"]);
  const openJobs = jobs.filter((j) => openStatuses.has((j.status || j.boardStatus || "open").toLowerCase()) || !["complete", "paid", "cancelled"].includes((j.status || "").toLowerCase()));

  // Turn radar
  const radar: TurnRadarItem[] = [];
  const discByBuilding = new Map<number, number>();
  const turnsByBuilding = new Map<number, number>();

  for (const j of openJobs) {
    const u = resolveUnitFromJob(j.unitNo);
    const age = ageHours(j.createdAt || j.updatedAt);
    let risk: TurnRadarItem["risk"] = "ok";
    if (age >= 72) risk = "overdue";
    else if (age >= 36) risk = "aging";

    // lightweight "discrepancy proxy": no invoice / board stuck
    const status = (j.status || j.boardStatus || "").toLowerCase();
    const looksStuck = status.includes("exception") || status === "needs_fix" || !(j as any).invoiceId;
    if (u.building != null) {
      turnsByBuilding.set(u.building, (turnsByBuilding.get(u.building) || 0) + 1);
      if (looksStuck || risk !== "ok") {
        discByBuilding.set(u.building, (discByBuilding.get(u.building) || 0) + 1);
      }
    }

    const pin = u.building != null ? buildingCentroids.get(u.building) : null;
    radar.push({
      jobId: j.id,
      jobNo: j.jobNo,
      unitNo: u.unitNo,
      building: u.building,
      status: j.status || j.boardStatus || "open",
      ageHours: Math.round(age * 10) / 10,
      risk,
      lat: pin?.lat ?? null,
      lng: pin?.lng ?? null,
    });
  }

  radar.sort((a, b) => b.ageHours - a.ageHours);

  const moneyTint: BuildingMoneyTint[] = [];
  for (let b = 1; b <= 20; b++) {
    const openTurns = turnsByBuilding.get(b) || 0;
    const openDiscrepancies = discByBuilding.get(b) || 0;
    let risk: BuildingMoneyTint["risk"] = "clean";
    if (openDiscrepancies >= 3 || openTurns >= 5) risk = "hot";
    else if (openDiscrepancies >= 1 || openTurns >= 2) risk = "watch";
    moneyTint.push({
      building: b,
      openDiscrepancies,
      openTurns,
      risk,
      label:
        risk === "hot"
          ? `Bldg ${b} · ${openTurns} turns · risk`
          : risk === "watch"
            ? `Bldg ${b} · ${openTurns} open`
            : `Bldg ${b} · clear`,
    });
  }

  // Photo billboards — recent field photos for this property's jobs
  const jobIds = jobs.map((j) => j.id).slice(0, 200);
  let billboards: PhotoBillboard[] = [];
  if (jobIds.length) {
    try {
      const photos = await db
        .select()
        .from(crewPhotosTable)
        .where(inArray(crewPhotosTable.jobId, jobIds))
        .orderBy(desc(crewPhotosTable.capturedAt))
        .limit(40);
      const jobMap = new Map(jobs.map((j) => [j.id, j]));
      billboards = photos.map((p) => {
        const j = p.jobId ? jobMap.get(p.jobId) : null;
        const u = resolveUnitFromJob(j?.unitNo ?? null);
        const pin = u.building != null ? buildingCentroids.get(u.building) : null;
        return {
          id: p.id,
          jobId: p.jobId,
          unitNo: u.unitNo,
          building: u.building,
          phase: p.phase,
          note: p.note,
          storagePath: p.storagePath,
          lat: p.lat ?? pin?.lat ?? null,
          lng: p.lng ?? pin?.lng ?? null,
          capturedAt: p.capturedAt?.toISOString?.() ?? null,
        };
      });
    } catch {
      billboards = [];
    }
  }

  return {
    moneyTint,
    turnRadar: radar.slice(0, 80),
    photoBillboards: billboards,
    layerSummary: {
      hotBuildings: moneyTint.filter((m) => m.risk === "hot").map((m) => m.building),
      watchBuildings: moneyTint.filter((m) => m.risk === "watch").map((m) => m.building),
      overdueTurns: radar.filter((t) => t.risk === "overdue").length,
      photoCount: billboards.length,
    },
  };
}
