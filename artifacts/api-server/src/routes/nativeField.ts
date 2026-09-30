import { Router, type IRouter, type Request } from "express";
import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  schedulesTable,
  propertiesTable,
  jobLineItemsTable,
  crewDispatchAssignmentsTable,
  crewPhotosTable,
  activitiesTable,
  crewCheckinsTable,
} from "@workspace/db";
import { findCrewByPortalBearer } from "../lib/portalToken";
import { localToday } from "../lib/localDate";
import { isUuid, jobBelongsToCrew } from "../lib/crewJobAccess";
import { ObjectStorageService } from "../lib/objectStorage";
import { isMintedUploadPath, mirrorFieldPhotoActivity } from "../lib/fieldPhotos";
import { recordFieldProvenance } from "../lib/fieldProvenance";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

async function authorizedCrew(req: Request) {
  const token = bearerFromRequest(req);
  if (!token) return null;
  const crew = await findCrewByPortalBearer(token);
  if (!crew || crew.active === false) return null;
  return crew;
}

function safeGps(body: Record<string, unknown>) {
  const lat = typeof body.lat === "number" ? body.lat : null;
  const lng = typeof body.lng === "number" ? body.lng : null;
  const accuracy = typeof body.accuracy === "number" ? body.accuracy : null;
  if (lat == null || lng == null) return { lat: null, lng: null, accuracy: null };
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { lat: null, lng: null, accuracy: null };
  }
  return {
    lat,
    lng,
    accuracy: accuracy != null && accuracy >= 0 && accuracy < 10_000 ? accuracy : null,
  };
}

function bearerFromRequest(req: Request): string | null {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match?.[1]) return match[1].trim();
  const fallback = typeof req.headers["x-halo-crew-token"] === "string"
    ? req.headers["x-halo-crew-token"].trim()
    : "";
  return fallback || null;
}

function plusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

router.get("/native/v1/field-feed", async (req, res): Promise<void> => {
  const crew = await authorizedCrew(req);
  if (!crew) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const requested = typeof req.query.date === "string" ? req.query.date : "";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : localToday();
  const end = plusDays(start, 14);

  const [scheduledRows, dispatchRows, directRows] = await Promise.all([
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.crewLeaderId, crew.id),
          gte(schedulesTable.scheduledOn, start),
          lte(schedulesTable.scheduledOn, end),
        ),
      ),
    db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(
        and(
          eq(crewDispatchAssignmentsTable.memberId, crew.id),
          gte(crewDispatchAssignmentsTable.day, start),
          lte(crewDispatchAssignmentsTable.day, end),
        ),
      ),
    db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.crewLeaderId, crew.id),
          notInArray(jobsTable.status, ["complete", "paid", "cancelled", "cleared"]),
        ),
      ),
  ]);

  const jobIds = [
    ...new Set(
      [
        ...scheduledRows.map((row) => row.jobId),
        ...dispatchRows.map((row) => row.jobId),
        ...directRows.map((row) => row.id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!jobIds.length) {
    res.json({
      ok: true,
      crew: { id: crew.id, name: crew.name },
      range: { start, end },
      jobs: [],
    });
    return;
  }

  const [jobs, lineItems] = await Promise.all([
    db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds)),
    db.select().from(jobLineItemsTable).where(inArray(jobLineItemsTable.jobId, jobIds)),
  ]);

  const propertyIds = [
    ...new Set(jobs.map((job) => job.propertyId).filter((id): id is string => Boolean(id))),
  ];
  const properties = propertyIds.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];

  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const scheduleByJob = new Map(scheduledRows.map((row) => [row.jobId, row]));
  const dispatchByJob = new Map(dispatchRows.map((row) => [row.jobId, row]));
  const serviceMap = new Map<string, string[]>();

  for (const line of lineItems) {
    if (!line.service || line.service === "Quoted price") continue;
    const list = serviceMap.get(line.jobId) ?? [];
    if (!list.includes(line.service)) list.push(line.service);
    serviceMap.set(line.jobId, list);
  }

  const payload = jobs.map((job) => {
    const property = propertyById.get(job.propertyId);
    const schedule = scheduleByJob.get(job.id);
    const dispatch = dispatchByJob.get(job.id);

    return {
      id: job.id,
      jobNo: job.jobNo ?? null,
      propertyId: job.propertyId,
      propertyName: property?.name ?? null,
      propertyAddress: property?.address ?? null,
      propertyCity: property?.city ?? null,
      propertyLatitude: property?.latitude ?? null,
      propertyLongitude: property?.longitude ?? null,
      unitNo: job.unitNo ?? null,
      category: job.category ?? null,
      description: job.description ?? null,
      services: serviceMap.get(job.id) ?? [],
      tasks: lineItems
        .filter((line) => line.jobId === job.id && line.service && line.service !== "Quoted price")
        .map((line) => ({
          id: line.id,
          title: line.service,
          detail: line.unit ?? null,
          isComplete: Boolean(line.completedAt),
          requiresPhoto: true,
          assignedCrewId: line.assignedCrewId ?? null,
        })),
      status: job.status,
      boardStatus: job.boardStatus ?? null,
      scheduledOn: schedule?.scheduledOn ?? job.scheduledOn ?? dispatch?.day ?? null,
      scheduledTime: schedule?.windowStart ?? job.scheduledTime ?? null,
      scheduleStatus: schedule?.status ?? null,
      source: dispatch ? "dispatch" : schedule ? "schedule" : "assigned",
      crewLeaderId: job.crewLeaderId ?? crew.id,
      crewLeaderName: crew.name,
      updatedAt: job.createdAt?.toISOString?.() ?? null,
    };
  });

  payload.sort((a, b) => {
    const ad = a.scheduledOn ?? "9999-12-31";
    const bd = b.scheduledOn ?? "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99");
  });

  res.json({
    ok: true,
    crew: { id: crew.id, name: crew.name },
    range: { start, end },
    jobs: payload,
  });
});



function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadius = 6_371_000;
  const toRadians = (value: number) => value * Math.PI / 180;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const lat1 = toRadians(aLat);
  const lat2 = toRadians(bLat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

router.post("/native/v1/check-in", async (req, res): Promise<void> => {
  const crew = await authorizedCrew(req);
  if (!crew) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const lat = typeof body.lat === "number" ? body.lat : Number.NaN;
  const lng = typeof body.lng === "number" ? body.lng : Number.NaN;
  const accuracy = typeof body.accuracy === "number" ? body.accuracy : Number.NaN;
  const capturedAtRaw = typeof body.capturedAt === "string" ? body.capturedAt : "";
  const capturedAt = new Date(capturedAtRaw);
  const now = new Date();

  if (!isUuid(jobId) || !(await jobBelongsToCrew(jobId, crew.id))) {
    res.status(403).json({ error: "That job is not assigned to this crew", code: "job_not_assigned" });
    return;
  }

  if (
    !Number.isFinite(lat) || !Number.isFinite(lng) ||
    lat < -90 || lat > 90 || lng < -180 || lng > 180 ||
    !Number.isFinite(accuracy) || accuracy < 0
  ) {
    res.status(400).json({ error: "A valid GPS fix is required.", code: "gps_invalid" });
    return;
  }

  if (!Number.isFinite(capturedAt.getTime()) || Math.abs(now.getTime() - capturedAt.getTime()) > 120_000) {
    res.status(400).json({ error: "Location is too old. Get a fresh GPS fix.", code: "gps_stale" });
    return;
  }

  if (accuracy > 100) {
    res.status(409).json({
      error: "GPS accuracy is not strong enough yet. Move outside or wait for a better signal.",
      code: "gps_accuracy",
      accuracy,
      requiredAccuracy: 100,
    });
    return;
  }

  const [job] = await db
    .select({
      id: jobsTable.id,
      propertyId: jobsTable.propertyId,
      unitNo: jobsTable.unitNo,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId))
    .limit(1);

  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const [property] = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      latitude: propertiesTable.latitude,
      longitude: propertiesTable.longitude,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId))
    .limit(1);

  if (
    !property ||
    property.latitude == null ||
    property.longitude == null
  ) {
    res.status(409).json({
      error: "This property needs a verified map location before mobile check-in can be used.",
      code: "property_location_missing",
    });
    return;
  }

  const distanceMeters = metersBetween(
    lat,
    lng,
    property.latitude,
    property.longitude,
  );
  const allowedRadiusMeters = 300;

  if (distanceMeters > allowedRadiusMeters) {
    res.status(409).json({
      error: "You are not close enough to this property to check in.",
      code: "outside_geofence",
      distanceMeters: Math.round(distanceMeters),
      allowedRadiusMeters,
    });
    return;
  }

  const [existing] = await db
    .select()
    .from(crewCheckinsTable)
    .where(
      and(
        eq(crewCheckinsTable.crewId, crew.id),
        eq(crewCheckinsTable.jobId, jobId),
        eq(crewCheckinsTable.kind, "checkin"),
        gte(crewCheckinsTable.createdAt, new Date(now.getTime() - 12 * 60 * 60 * 1000)),
      ),
    )
    .limit(1);

  let checkinId = existing?.id ?? null;
  if (!existing) {
    const [created] = await db
      .insert(crewCheckinsTable)
      .values({
        crewId: crew.id,
        jobId,
        kind: "checkin",
        lat,
        lng,
        accuracy,
        label: "Verified native iOS check-in",
      })
      .returning({ id: crewCheckinsTable.id });
    checkinId = created?.id ?? null;

    if (created) {
      void recordFieldProvenance({
        eventId: created.id,
        kind: "checkin",
        crewId: crew.id,
        haloJobId: jobId,
        lat,
        lng,
      });
    }
  }

  res.json({
    ok: true,
    verified: true,
    replayed: Boolean(existing),
    checkinId,
    jobId,
    propertyId: property.id,
    propertyName: property.name,
    distanceMeters: Math.round(distanceMeters),
    allowedRadiusMeters,
    accuracyMeters: accuracy,
    verifiedAt: now.toISOString(),
  });
});

router.post("/native/v1/actions", async (req, res): Promise<void> => {
  const crew = await authorizedCrew(req);
  if (!crew) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const actionId = typeof body.id === "string" ? body.id.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const payload = (body.payload ?? {}) as Record<string, unknown>;

  if (!actionId || !isUuid(jobId)) {
    res.status(400).json({ error: "Invalid field action" });
    return;
  }
  if (!(await jobBelongsToCrew(jobId, crew.id))) {
    res.status(403).json({ error: "That job is not assigned to this crew" });
    return;
  }

  if (kind === "taskToggle") {
    const taskId = typeof payload.taskID === "string" ? payload.taskID.trim() : "";
    const isComplete = payload.isComplete === true || payload.isComplete === "true";
    if (!isUuid(taskId)) {
      res.status(400).json({ error: "Invalid task" });
      return;
    }

    const [line] = await db
      .select()
      .from(jobLineItemsTable)
      .where(and(eq(jobLineItemsTable.id, taskId), eq(jobLineItemsTable.jobId, jobId)))
      .limit(1);
    if (!line) {
      res.status(404).json({ error: "Task not found" });
      return;
    }
    if (line.assignedCrewId && line.assignedCrewId !== crew.id) {
      res.status(403).json({ error: "That task is assigned to another crew" });
      return;
    }

    await db
      .update(jobLineItemsTable)
      .set({
        completedAt: isComplete ? new Date() : null,
        completedByCrewId: isComplete ? crew.id : null,
      })
      .where(eq(jobLineItemsTable.id, taskId));

    res.json({ ok: true, actionId, kind, jobId });
    return;
  }

  if (kind === "workflowState") {
    const state = typeof payload.to === "string" ? payload.to : "";
    const allowed = new Set(["enRoute", "arrived", "active", "proof", "review"]);
    if (!allowed.has(state)) {
      res.status(400).json({ error: "Unsupported field state" });
      return;
    }

    // Field-state events are intentionally audit-only. They do not bypass the
    // existing office completion/billing workflow or mutate financial status.
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: jobId,
      kind: "field_state",
      body: JSON.stringify({
        actionId,
        state,
        crewId: crew.id,
        crewName: crew.name,
        at: new Date().toISOString(),
      }),
    });

    res.json({ ok: true, actionId, kind, jobId, state });
    return;
  }

  res.status(400).json({ error: "Unsupported field action" });
});

router.post("/native/v1/proofs/request-upload", async (req, res): Promise<void> => {
  const crew = await authorizedCrew(req);
  if (!crew) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const size = typeof body.size === "number" ? body.size : 0;
  const contentType = typeof body.contentType === "string" ? body.contentType : "image/jpeg";

  if (!isUuid(jobId) || !(await jobBelongsToCrew(jobId, crew.id))) {
    res.status(403).json({ error: "That job is not assigned to this crew" });
    return;
  }
  if (size <= 0 || size > 25 * 1024 * 1024 || contentType !== "image/jpeg") {
    res.status(400).json({ error: "Invalid proof file" });
    return;
  }

  const uploadURL = await objectStorage.getObjectEntityUploadURL();
  const objectPath = objectStorage.normalizeObjectEntityPath(uploadURL);
  res.json({ ok: true, uploadURL, objectPath });
});

router.post("/native/v1/proofs/register", async (req, res): Promise<void> => {
  const crew = await authorizedCrew(req);
  if (!crew) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const proofId = typeof body.proofId === "string" ? body.proofId.trim() : "";
  const jobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
  const phase = body.phase === "after" ? "after" : body.phase === "before" ? "before" : null;

  if (!proofId || !isUuid(jobId) || !(await jobBelongsToCrew(jobId, crew.id))) {
    res.status(403).json({ error: "That job is not assigned to this crew" });
    return;
  }
  if (!phase || !isMintedUploadPath(storagePath)) {
    res.status(400).json({ error: "Invalid proof registration" });
    return;
  }

  const [already] = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.storagePath, storagePath))
    .limit(1);

  if (already && already.crewId !== crew.id) {
    res.status(403).json({ error: "That proof belongs to another crew" });
    return;
  }

  let photo = already;
  if (!photo) {
    const gps = safeGps(body);
    [photo] = await db
      .insert(crewPhotosTable)
      .values({
        crewId: crew.id,
        jobId,
        storagePath,
        takenOn: localToday(),
        note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
        phase,
        lat: gps.lat,
        lng: gps.lng,
        accuracy: gps.accuracy,
        capturedAt: new Date(),
      })
      .returning();
  }

  try {
    await mirrorFieldPhotoActivity({
      jobId,
      phase,
      storagePath,
      crewName: crew.name,
      note: typeof body.note === "string" ? body.note.slice(0, 500) : null,
    });
  } catch {
    // Registration is already committed; mirror is best-effort and idempotent.
  }

  res.status(201).json({
    ok: true,
    proofId,
    photo: photo ? { id: photo.id, phase: photo.phase, url: `/api/storage${photo.storagePath}` } : null,
  });
});

export default router;
