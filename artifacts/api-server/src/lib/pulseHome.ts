/**
 * Pulse Home — property-safe summary only.
 * No invoice totals, crew payouts, vendor rates, or money fields.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, jobsTable, propertiesTable, crewPhotosTable } from "@workspace/db";
import { logger } from "./logger";

export type PulseUnitCard = {
  jobId: string;
  jobNo: string | null;
  unitNo: string | null;
  propertyName: string | null;
  status: "turning" | "waiting" | "done" | "blocked";
  statusLabel: string;
  updatedAt: string | null;
  hasPhotos: boolean;
  lat: number | null;
  lng: number | null;
};

export type PulseHomePayload = {
  ok: true;
  asOf: string;
  property: { id: string | null; name: string; city: string | null } | null;
  counts: {
    turning: number;
    waiting: number;
    doneToday: number;
    blocked: number;
  };
  headline: string;
  units: PulseUnitCard[];
  recentPhotoPaths: string[];
};

function mapStatus(board?: string | null, status?: string | null): PulseUnitCard["status"] {
  const b = (board || status || "").toLowerCase();
  if (["completed", "complete", "done", "billing"].includes(b)) return "done";
  if (["hold", "blocked", "change_order", "waiting"].includes(b)) return "blocked";
  if (["filled", "scheduled", "in_progress", "active", "dispatched"].includes(b)) return "turning";
  if (["open", "reopened", "new", "backlog"].includes(b)) return "waiting";
  return "turning";
}

function statusLabel(s: PulseUnitCard["status"]) {
  switch (s) {
    case "turning": return "In progress";
    case "waiting": return "Waiting";
    case "done": return "Ready";
    case "blocked": return "Needs attention";
  }
}

export async function buildPulseHome(opts?: { propertyId?: string; limit?: number }): Promise<PulseHomePayload> {
  const limit = opts?.limit ?? 40;
  let property: PulseHomePayload["property"] = null;

  if (opts?.propertyId) {
    const [p] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, opts.propertyId)).limit(1);
    if (p) property = { id: p.id, name: p.name || "Property", city: (p as any).city || null };
  }

  const jobQuery = db
    .select({
      id: jobsTable.id,
      jobNo: jobsTable.jobNo,
      unitNo: jobsTable.unitNo,
      boardStatus: jobsTable.boardStatus,
      status: jobsTable.status,
      propertyId: jobsTable.propertyId,
      updatedAt: jobsTable.updatedAt,
      createdAt: jobsTable.createdAt,
    })
    .from(jobsTable)
    .orderBy(desc(jobsTable.updatedAt))
    .limit(limit * 2);

  const jobs = opts?.propertyId
    ? await db
        .select({
          id: jobsTable.id,
          jobNo: jobsTable.jobNo,
          unitNo: jobsTable.unitNo,
          boardStatus: jobsTable.boardStatus,
          status: jobsTable.status,
          propertyId: jobsTable.propertyId,
          updatedAt: jobsTable.updatedAt,
          createdAt: jobsTable.createdAt,
        })
        .from(jobsTable)
        .where(eq(jobsTable.propertyId, opts.propertyId))
        .orderBy(desc(jobsTable.updatedAt))
        .limit(limit * 2)
    : await jobQuery;

  // property names
  const propIds = [...new Set(jobs.map((j) => j.propertyId).filter(Boolean))] as string[];
  const props =
    propIds.length > 0
      ? await db
          .select({
            id: propertiesTable.id,
            name: propertiesTable.name,
            lat: propertiesTable.latitude,
            lng: propertiesTable.longitude,
          })
          .from(propertiesTable)
          .where(inArray(propertiesTable.id, propIds))
      : [];
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const propCoord = new Map(props.map((p) => [p.id, { lat: p.lat, lng: p.lng }]));

  if (!property && props[0]) {
    property = { id: props[0].id, name: props[0].name || "Portfolio", city: null };
  }

  const jobIds = jobs.map((j) => j.id);
  let photoJobIds = new Set<string>();
  let recentPhotoPaths: string[] = [];
  if (jobIds.length > 0) {
    try {
      const photos = await db
        .select({ jobId: crewPhotosTable.jobId, path: crewPhotosTable.storagePath })
        .from(crewPhotosTable)
        .where(inArray(crewPhotosTable.jobId, jobIds.slice(0, 80)))
        .orderBy(desc(crewPhotosTable.createdAt))
        .limit(24);
      for (const ph of photos) {
        if (ph.jobId) photoJobIds.add(ph.jobId);
        if (ph.path && recentPhotoPaths.length < 8) recentPhotoPaths.push(ph.path);
      }
    } catch (err) {
      logger.warn({ err }, "pulse home photos skipped");
    }
  }

  const units: PulseUnitCard[] = jobs.slice(0, limit).map((j) => {
    const status = mapStatus(j.boardStatus, j.status);
    const coord = j.propertyId ? propCoord.get(j.propertyId) : null;
    return {
      jobId: j.id,
      jobNo: j.jobNo,
      unitNo: j.unitNo,
      propertyName: j.propertyId ? propName.get(j.propertyId) || null : null,
      status,
      statusLabel: statusLabel(status),
      updatedAt: j.updatedAt ? new Date(j.updatedAt).toISOString() : null,
      hasPhotos: photoJobIds.has(j.id),
      lat: coord?.lat ?? null,
      lng: coord?.lng ?? null,
    };
  });

  const counts = {
    turning: units.filter((u) => u.status === "turning").length,
    waiting: units.filter((u) => u.status === "waiting").length,
    doneToday: units.filter((u) => u.status === "done").length,
    blocked: units.filter((u) => u.status === "blocked").length,
  };

  const headline =
    counts.blocked > 0
      ? `${counts.blocked} need attention · ${counts.turning} turning`
      : counts.turning > 0
        ? `${counts.turning} units turning · ${counts.doneToday} ready`
        : counts.doneToday > 0
          ? `${counts.doneToday} ready for next step`
          : "All quiet";

  return {
    ok: true,
    asOf: new Date().toISOString(),
    property,
    counts,
    headline,
    units: [
      ...units.filter((u) => u.status === "blocked"),
      ...units.filter((u) => u.status === "turning"),
      ...units.filter((u) => u.status === "waiting"),
      ...units.filter((u) => u.status === "done"),
    ],
    recentPhotoPaths,
  };
}

/** Property-safe unit detail for drawer — no money. */
export async function buildPulseUnitDetail(jobId: string) {
  const [job] = await db
    .select({
      id: jobsTable.id,
      jobNo: jobsTable.jobNo,
      unitNo: jobsTable.unitNo,
      boardStatus: jobsTable.boardStatus,
      status: jobsTable.status,
      propertyId: jobsTable.propertyId,
      updatedAt: jobsTable.updatedAt,
      createdAt: jobsTable.createdAt,
      notes: (jobsTable as any).notes,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);
  if (!job) return null;

  let propertyName: string | null = null;
  let propertyCity: string | null = null;
  if (job.propertyId) {
    const [p] = await db
      .select({
        name: propertiesTable.name,
        city: (propertiesTable as any).city,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, job.propertyId))
      .limit(1);
    propertyName = p?.name || null;
    propertyCity = p?.city ?? null;
  }

  let photos: Array<{ id: string; path: string; phase: string | null; createdAt: string | null }> = [];
  try {
    const rows = await db
      .select({
        id: crewPhotosTable.id,
        path: crewPhotosTable.storagePath,
        phase: crewPhotosTable.phase,
        createdAt: crewPhotosTable.createdAt,
      })
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.jobId, jobId))
      .orderBy(desc(crewPhotosTable.createdAt))
      .limit(12);
    photos = rows.map((r) => ({
      id: r.id,
      path: r.path,
      phase: r.phase || null,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
    }));
  } catch {
    /* photos optional */
  }

  const status = mapStatus(job.boardStatus, job.status);
  return {
    ok: true as const,
    jobId: job.id,
    jobNo: job.jobNo,
    unitNo: job.unitNo,
    propertyName,
    propertyCity,
    status,
    statusLabel: statusLabel(status),
    boardStatus: job.boardStatus,
    updatedAt: job.updatedAt ? new Date(job.updatedAt).toISOString() : null,
    createdAt: job.createdAt ? new Date(job.createdAt).toISOString() : null,
    notes: typeof job.notes === "string" ? job.notes : null,
    photos,
    // Explicitly no money keys
    money: false as const,
  };
}
