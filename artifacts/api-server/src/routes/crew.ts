import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, gte, ilike, lt, ne, or, sql } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewMessagesTable,
  crewCheckinsTable,
  crewDocumentsTable,
  crewPaymentsTable,
  crewPhotosTable,
  crewInvoicesTable,
  crewInvoiceItemsTable,
  photoSharesTable,
  notificationsTable,
  schedulesTable,
  jobsTable,
  jobLineItemsTable,
  propertiesTable,
  calendarEventsTable,
  crewRoutePlansTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  GetCrewDetailParams,
  GetCrewDetailResponse,
  GenerateCrewPortalLinkParams,
  GenerateCrewPortalLinkResponse,
  ListCrewMessagesParams,
  ListCrewMessagesResponse,
  SendCrewMessageParams,
  SendCrewMessageBody,
  SendCrewMessageResponse,
  ListCrewCheckinsParams,
  ListCrewCheckinsResponse,
  GetCrewMapPinsResponse,
  ListCrewDocumentsParams,
  ListCrewDocumentsResponse,
  SendCrewDocumentParams,
  SendCrewDocumentBody,
  SendCrewDocumentResponse,
  UpdateCrewPaymentMethodParams,
  UpdateCrewPaymentMethodBody,
  UpdateCrewPaymentMethodResponse,
  ListCrewPaymentsResponse,
  CreateCrewPaymentBody,
  CreateCrewPaymentResponse,
  UpdateCrewPaymentParams,
  UpdateCrewPaymentBody,
  UpdateCrewPaymentResponse,
  ListCrewPhotosParams,
  ListCrewPhotosResponse,
  CreatePhotoShareParams,
  CreatePhotoShareBody,
  CreatePhotoShareResponse,
  GetPhotoShareParams,
  GetPhotoShareReportPdfParams,
  UpdatePhotoShareNotesParams,
  UpdatePhotoShareNotesBody,
  UpdatePhotoShareNotesResponse,
  GetPhotoShareResponse,
  ListCrewInvoicesParams,
  GetCrewWorkHistoryParams,
  GetCrewWorkHistoryResponse,
  ListCrewInvoicesResponse,
  GetCrewInvoiceQueueResponse,
  ReviewCrewInvoiceParams,
  ReviewCrewInvoiceBody,
  ReviewCrewInvoiceResponse,
  GetCrewDayPlanParams,
  GetCrewDayPlanResponse,
  SaveCrewDayPlanParams,
  SaveCrewDayPlanBody,
  SaveCrewDayPlanResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";
import { jobLabelMap } from "../lib/jobLabels";
import { gatherDayReport, buildDayReportPdf } from "../lib/dayReportPdf";
import { sendExpoPush } from "../lib/pushNotification";

const router: IRouter = Router();

type CrewRow = typeof crewsTable.$inferSelect;

function crewDetail(row: CrewRow) {
  return {
    id: row.id,
    name: row.name,
    trade: row.trade,
    phone: row.phone,
    email: row.email,
    isLeader: row.isLeader,
    role: row.role ?? null,
    hireDate: row.hireDate ?? null,
    wingsExcluded: row.wingsExcluded ?? false,
    active: row.active,
    portalToken: row.portalToken,
    preferredPaymentMethod: row.preferredPaymentMethod,
    paymentDetails: row.paymentDetails,
    paymentTerms: row.paymentTerms,
    services:
      (row.services as { name: string; rate?: number | null }[] | null) ??
      null,
    selfiePath: row.selfiePath ?? null,
    availability:
      (row.availability as Record<string, { on: boolean; from?: string | null; to?: string | null }> | null) ??
      null,
    w9Submitted: row.w9SubmittedAt != null,
    w9SubmittedAt: row.w9SubmittedAt ? row.w9SubmittedAt.toISOString() : null,
    w9: (row.w9 as Record<string, unknown> | null) ?? null,
  };
}

router.get("/crews/:id/detail", async (req, res): Promise<void> => {
  const { id } = GetCrewDetailParams.parse(req.params);
  const [row] = await db.select().from(crewsTable).where(eq(crewsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const payments = await db
    .select()
    .from(crewPaymentsTable)
    .where(eq(crewPaymentsTable.crewId, id));
  let paidTotal = 0;
  let outstandingTotal = 0;
  for (const p of payments) {
    if (p.status === "completed") paidTotal += p.amount;
    else if (p.status !== "cancelled") outstandingTotal += p.amount;
  }
  res.json(
    GetCrewDetailResponse.parse({
      ...crewDetail(row),
      paidTotal,
      outstandingTotal,
    }),
  );
});

// STABLE PORTAL LINK — tokens are permanent and must NEVER be rotated.
// New crews get a token at creation (POST /crews). This endpoint is a
// safe fallback for legacy rows that predate auto-minting. It is
// intentionally idempotent: it returns the existing token unchanged and
// only mints a fresh one when the column is still null. Do NOT add any
// logic here that overwrites an existing token — doing so would silently
// invalidate every SMS / saved bookmark the crew already has.
router.post("/crews/:id/portal-link", async (req, res): Promise<void> => {
  const { id } = GenerateCrewPortalLinkParams.parse(req.params);
  const [row] = await db.select().from(crewsTable).where(eq(crewsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  let token = row.portalToken;
  if (!token) {
    // Legacy crew created before auto-minting — mint now and persist once.
    token = randomBytes(24).toString("base64url");
    await db
      .update(crewsTable)
      .set({ portalToken: token })
      .where(eq(crewsTable.id, id));
  }
  res.json(
    GenerateCrewPortalLinkResponse.parse({
      token,
      path: `/portal/${token}`,
    }),
  );
});

router.get("/crews/:id/messages", async (req, res): Promise<void> => {
  const { id } = ListCrewMessagesParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewMessagesTable)
    .where(eq(crewMessagesTable.crewId, id))
    .orderBy(crewMessagesTable.createdAt);
  res.json(ListCrewMessagesResponse.parse(rows.map((r) => ser(r))));
});

router.post("/crews/:id/messages", async (req, res): Promise<void> => {
  const { id } = SendCrewMessageParams.parse(req.params);
  const body = SendCrewMessageBody.parse(req.body);
  const [[row], crewRows] = await Promise.all([
    db
      .insert(crewMessagesTable)
      .values({ crewId: id, sender: "admin", body: body.body })
      .returning(),
    db
      .select({ pushToken: crewsTable.pushToken })
      .from(crewsTable)
      .where(eq(crewsTable.id, id)),
  ]);
  // Best-effort push — never await or throw
  sendExpoPush(crewRows[0]?.pushToken, {
    title: "📨 New message from office",
    body: body.body.slice(0, 120),
  }).catch(() => {});
  res.status(201).json(SendCrewMessageResponse.parse(ser(row)));
});

router.get("/crews/:id/photos", async (req, res): Promise<void> => {
  const { id } = ListCrewPhotosParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.crewId, id))
    .orderBy(desc(crewPhotosTable.createdAt));
  const labels = await jobLabelMap(
    rows.map((r) => r.jobId).filter((v): v is string => !!v),
  );
  res.json(
    ListCrewPhotosResponse.parse(
      rows.map((r) => ({
        ...ser(r),
        jobLabel: r.jobId ? (labels.get(r.jobId) ?? null) : null,
      })),
    ),
  );
});

router.post("/crews/:id/photo-shares", async (req, res): Promise<void> => {
  const { id } = CreatePhotoShareParams.parse(req.params);
  const body = CreatePhotoShareBody.parse(req.body);
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, id));
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(photoSharesTable)
    .where(
      and(eq(photoSharesTable.crewId, id), eq(photoSharesTable.day, body.day)),
    );
  if (existing) {
    res.status(201).json(
      CreatePhotoShareResponse.parse({
        token: existing.token,
        day: existing.day,
        notes: existing.notes,
      }),
    );
    return;
  }
  const token = randomBytes(18).toString("base64url");
  const [row] = await db
    .insert(photoSharesTable)
    .values({ crewId: id, day: body.day, token })
    .returning();
  res
    .status(201)
    .json(CreatePhotoShareResponse.parse({ token: row.token, day: row.day }));
});

router.get("/photo-shares/:token", async (req, res): Promise<void> => {
  const { token } = GetPhotoShareParams.parse(req.params);
  const [share] = await db
    .select()
    .from(photoSharesTable)
    .where(eq(photoSharesTable.token, token));
  if (!share) {
    res.status(404).json({ error: "Invalid share link" });
    return;
  }
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, share.crewId));
  const photos = await db
    .select()
    .from(crewPhotosTable)
    .where(
      and(
        eq(crewPhotosTable.crewId, share.crewId),
        eq(crewPhotosTable.takenOn, share.day),
      ),
    )
    .orderBy(crewPhotosTable.createdAt);
  const [dy, dm, dd] = share.day.split("-").map(Number);
  const dayStart = new Date(dy, dm - 1, dd);
  const dayEnd = new Date(dy, dm - 1, dd + 1);
  const checkins = await db
    .select()
    .from(crewCheckinsTable)
    .where(
      and(
        eq(crewCheckinsTable.crewId, share.crewId),
        gte(crewCheckinsTable.createdAt, dayStart),
        lt(crewCheckinsTable.createdAt, dayEnd),
      ),
    )
    .orderBy(crewCheckinsTable.createdAt);
  const labels = await jobLabelMap(
    [...photos.map((p) => p.jobId), ...checkins.map((c) => c.jobId)].filter(
      (v): v is string => !!v,
    ),
  );
  res.json(
    GetPhotoShareResponse.parse({
      crewName: crew?.name ?? "Crew",
      trade: crew?.trade ?? null,
      day: share.day,
      photos: photos.map((p) => ({
        ...ser(p),
        jobLabel: p.jobId ? (labels.get(p.jobId) ?? null) : null,
      })),
      checkins: checkins.map((c) => ({
        id: c.id,
        jobId: c.jobId ?? null,
        jobLabel: c.jobId ? (labels.get(c.jobId) ?? null) : null,
        kind: c.kind,
        label: c.label ?? null,
        note: c.note ?? null,
        createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      })),
    }),
  );
});

router.patch("/crews/:id/photo-share-notes", async (req, res): Promise<void> => {
  const { id } = UpdatePhotoShareNotesParams.parse(req.params);
  const body = UpdatePhotoShareNotesBody.parse(req.body);
  const [row] = await db
    .update(photoSharesTable)
    .set({ notes: body.notes })
    .where(
      and(eq(photoSharesTable.crewId, id), eq(photoSharesTable.day, body.day)),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "No share exists for that crew and day" });
    return;
  }
  res.json(
    UpdatePhotoShareNotesResponse.parse({
      token: row.token,
      day: row.day,
      notes: row.notes,
    }),
  );
});

router.get("/photo-shares/:token/report", async (req, res): Promise<void> => {
  const { token } = GetPhotoShareReportPdfParams.parse({ token: req.params.token });
  const data = await gatherDayReport(token);
  if (!data) {
    res.status(404).json({ error: "Invalid share link" });
    return;
  }
  const pdf = await buildDayReportPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="daily-report-${data.crewName.replace(/[^\w.-]+/g, "_")}-${data.day}.pdf"`,
  );
  res.send(Buffer.from(pdf));
});

// Node-local midnight — the app's single "today" basis for trails (never
// date_trunc in SQL, which uses the DB session timezone).
function localDayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

router.get("/crews/map", async (_req, res): Promise<void> => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  const todayStr = `${y}-${m}-${d}`;
  const [crews, schedules, jobs, props, checkins, trackPoints] = await Promise.all([
    db.select().from(crewsTable),
    db.select().from(schedulesTable).where(eq(schedulesTable.scheduledOn, todayStr)),
    db.select().from(jobsTable),
    db.select().from(propertiesTable),
    db.execute(sql`
      SELECT DISTINCT ON (crew_id)
        crew_id AS "crewId", kind, lat, lng, label, created_at AS "createdAt"
      FROM crew_checkins
      WHERE lat IS NOT NULL AND lng IS NOT NULL
      ORDER BY crew_id, created_at DESC
    `),
    db.execute(sql`
      SELECT crew_id AS "crewId", lat, lng, created_at AS "createdAt"
      FROM crew_track_points
      WHERE created_at >= ${localDayStart()}
      ORDER BY created_at ASC
      LIMIT 20000
    `),
  ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  // Secondary batch: photos + line items for today's scheduled jobs only.
  const todayJobIds = [...new Set(schedules.map((s) => s.jobId))];
  const [todayPhotos, todayLineItems] = todayJobIds.length
    ? await Promise.all([
        db
          .select()
          .from(crewPhotosTable)
          .where(inArray(crewPhotosTable.jobId, todayJobIds))
          .orderBy(desc(crewPhotosTable.createdAt))
          .limit(300),
        db
          .select()
          .from(jobLineItemsTable)
          .where(inArray(jobLineItemsTable.jobId, todayJobIds)),
      ])
    : [[], []];

  const photosByJob = new Map<string, (typeof todayPhotos)[number][]>();
  for (const p of todayPhotos) {
    if (!p.jobId) continue;
    const list = photosByJob.get(p.jobId) ?? [];
    list.push(p);
    photosByJob.set(p.jobId, list);
  }
  const lineItemsByJob = new Map<string, (typeof todayLineItems)[number][]>();
  for (const li of todayLineItems) {
    const list = lineItemsByJob.get(li.jobId) ?? [];
    list.push(li);
    lineItemsByJob.set(li.jobId, list);
  }

  type LastCheckin = {
    crewId: string;
    kind: string;
    lat: number | string;
    lng: number | string;
    label: string | null;
    createdAt: string | Date | null;
  };
  const lastRows = (checkins.rows ?? []) as unknown as LastCheckin[];
  const lastByCrew = new Map(lastRows.map((c) => [c.crewId, c]));
  type TrackRow = { crewId: string; lat: number | string; lng: number | string; createdAt: string | Date };
  const trailByCrew = new Map<string, { lat: number; lng: number; at: string }[]>();
  for (const r of (trackPoints.rows ?? []) as unknown as TrackRow[]) {
    const list = trailByCrew.get(r.crewId) ?? [];
    list.push({
      lat: Number(r.lat),
      lng: Number(r.lng),
      at: new Date(r.createdAt).toISOString(),
    });
    trailByCrew.set(r.crewId, list);
  }
  res.json(
    GetCrewMapPinsResponse.parse(
      crews
        .filter((c) => c.active !== false)
        .map((c) => {
          const sched = schedules.find((s) => s.crewLeaderId === c.id);
          const job = sched ? jobById.get(sched.jobId) : undefined;
          const last = lastByCrew.get(c.id);
          const trail = trailByCrew.get(c.id) ?? [];
          // Pin follows the freshest signal: latest breadcrumb beats an older check-in.
          const tip = trail.length ? trail[trail.length - 1] : null;
          const tipNewer =
            tip &&
            (!last?.createdAt || new Date(tip.at).getTime() > new Date(last.createdAt).getTime());
          const jobPhotos = job ? (photosByJob.get(job.id) ?? []) : [];
          const jobServices = job ? (lineItemsByJob.get(job.id) ?? []) : [];
          return {
            id: c.id,
            name: c.name,
            trade: c.trade ?? null,
            phone: c.phone ?? null,
            selfiePath: c.selfiePath ?? null,
            todayStatus: sched ? (sched.status === "done" ? "done" : "site") : "idle",
            todayJob: job?.jobNo ?? null,
            todayProperty: job ? (propName.get(job.propertyId) ?? null) : null,
            unitNo: job?.unitNo ?? null,
            lat: tipNewer ? tip.lat : last?.lat != null ? Number(last.lat) : null,
            lng: tipNewer ? tip.lng : last?.lng != null ? Number(last.lng) : null,
            lastCheckinKind: last?.kind ?? null,
            lastCheckinLabel: last?.label ?? null,
            lastCheckinAt: last?.createdAt ? new Date(last.createdAt).toISOString() : null,
            trail,
            photos: jobPhotos.slice(0, 8).map((p) => ({
              id: p.id,
              url: `/api/storage${p.storagePath}`,
              phase: p.phase ?? null,
              note: p.note ?? null,
            })),
            services: jobServices.map((li) => ({
              id: li.id,
              service: li.service,
              done: !!li.completedAt,
            })),
          };
        }),
    ),
  );
});

// Builds the stops for one crew's day: schedule rows (job stops) plus
// crew-assigned calendar events, deduped by jobId|date — same keys as the
// portal schedule feed (schedule row id, or "event-<calendarEventId>").
async function buildDayStops(crewId: string, day: string) {
  const [schedRows, eventRows] = await Promise.all([
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.crewLeaderId, crewId),
          eq(schedulesTable.scheduledOn, day),
        ),
      ),
    db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.crewId, crewId),
          eq(calendarEventsTable.eventDate, day),
        ),
      ),
  ]);
  const jobIds = new Set<string>();
  for (const s of schedRows) jobIds.add(s.jobId);
  for (const ev of eventRows) if (ev.jobId) jobIds.add(ev.jobId);
  const jobs = jobIds.size
    ? await db
        .select()
        .from(jobsTable)
        .where(inArray(jobsTable.id, [...jobIds]))
    : [];
  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const propIds = [
    ...new Set(jobs.map((j) => j.propertyId).filter((p): p is string => !!p)),
  ];
  const props = propIds.length
    ? await db
        .select()
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propsById = new Map(props.map((p) => [p.id, p]));

  const stopFor = (job: (typeof jobs)[number] | undefined) => {
    const prop = job?.propertyId ? propsById.get(job.propertyId) : undefined;
    const address = prop
      ? [prop.address, prop.city].filter(Boolean).join(", ") || null
      : null;
    return {
      jobId: job?.id ?? null,
      jobNo: job?.jobNo ?? null,
      propertyName: prop?.name ?? null,
      address,
      unitNo: job?.unitNo ?? null,
      lat: prop?.latitude != null ? Number(prop.latitude) : null,
      lng: prop?.longitude != null ? Number(prop.longitude) : null,
    };
  };

  const stops = schedRows.map((s) => {
    const job = jobsById.get(s.jobId);
    return {
      key: s.id,
      kind: "job",
      title: job?.description || job?.jobNo || "Job",
      windowStart: s.windowStart ?? null,
      status: (s.status ?? null) as string | null,
      ...stopFor(job),
    };
  });
  const scheduledJobDays = new Set(schedRows.map((s) => s.jobId));
  for (const ev of eventRows) {
    if (ev.jobId && scheduledJobDays.has(ev.jobId)) continue;
    const job = ev.jobId ? jobsById.get(ev.jobId) : undefined;
    stops.push({
      key: `event-${ev.id}`,
      kind: "event",
      title: ev.title,
      windowStart: ev.startTime ?? null,
      status: null,
      ...stopFor(job),
    });
  }
  return stops;
}

// Time windows are free text ("9:00 AM", "13:30"); parse to minutes so the
// default order is chronological, with unparseable/missing times last.
function windowMinutes(w: string | null): number {
  if (!w) return Number.MAX_SAFE_INTEGER;
  const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(w.trim());
  if (!m) return Number.MAX_SAFE_INTEGER;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}

// Orders stops by the saved plan: planned keys first (in saved order), then
// unplanned stops by time window, with address-less stops last.
function orderStops(
  stops: Awaited<ReturnType<typeof buildDayStops>>,
  savedKeys: string[],
) {
  const byKey = new Map(stops.map((s) => [s.key, s]));
  const planned = savedKeys
    .filter((k) => byKey.has(k))
    .map((k) => ({ ...byKey.get(k)!, planned: true }));
  const plannedSet = new Set(planned.map((s) => s.key));
  const rest = stops
    .filter((s) => !plannedSet.has(s.key))
    .sort((a, b) => {
      const aCoords = a.lat != null && a.lng != null;
      const bCoords = b.lat != null && b.lng != null;
      if (aCoords !== bCoords) return aCoords ? -1 : 1;
      return windowMinutes(a.windowStart) - windowMinutes(b.windowStart);
    })
    .map((s) => ({ ...s, planned: false }));
  return [...planned, ...rest];
}

router.get("/crews/:id/day-plan/:day", async (req, res): Promise<void> => {
  const { id, day } = GetCrewDayPlanParams.parse(req.params);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id))
    .limit(1);
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const [plan] = await db
    .select()
    .from(crewRoutePlansTable)
    .where(
      and(
        eq(crewRoutePlansTable.crewId, id),
        eq(crewRoutePlansTable.day, day),
      ),
    )
    .limit(1);
  const savedKeys = Array.isArray(plan?.stopKeys)
    ? (plan.stopKeys as string[])
    : [];
  const stops = orderStops(await buildDayStops(id, day), savedKeys);
  res.json(GetCrewDayPlanResponse.parse({ day, crewId: id, stops }));
});

router.put("/crews/:id/day-plan/:day", async (req, res): Promise<void> => {
  const { id, day } = SaveCrewDayPlanParams.parse(req.params);
  const body = SaveCrewDayPlanBody.parse(req.body);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id))
    .limit(1);
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  // Only store keys that actually exist for this crew's day, so junk or
  // stale keys can't accumulate in the plan.
  const stops = await buildDayStops(id, day);
  const valid = new Set(stops.map((s) => s.key));
  const keys = [...new Set(body.stopKeys)].filter((k) => valid.has(k));
  await db
    .insert(crewRoutePlansTable)
    .values({ crewId: id, day, stopKeys: keys, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [crewRoutePlansTable.crewId, crewRoutePlansTable.day],
      set: { stopKeys: keys, updatedAt: new Date() },
    });
  const ordered = orderStops(stops, keys);
  res.json(SaveCrewDayPlanResponse.parse({ day, crewId: id, stops: ordered }));
});

router.get("/crews/:id/checkins", async (req, res): Promise<void> => {
  const { id } = ListCrewCheckinsParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewCheckinsTable)
    .where(eq(crewCheckinsTable.crewId, id))
    .orderBy(desc(crewCheckinsTable.createdAt));
  res.json(ListCrewCheckinsResponse.parse(rows.map((r) => ser(r))));
});

router.get("/crews/:id/documents", async (req, res): Promise<void> => {
  const { id } = ListCrewDocumentsParams.parse(req.params);
  const rows = await db
    .select()
    .from(crewDocumentsTable)
    .where(eq(crewDocumentsTable.crewId, id))
    .orderBy(desc(crewDocumentsTable.createdAt));
  res.json(ListCrewDocumentsResponse.parse(rows.map((r) => ser(r))));
});

// Everything a crew has done, in one call: completed jobs (date, services,
// property), their submitted invoices grouped by property client-side, and
// any bonuses or gift cards recorded as crew payments.
router.get("/crews/:id/work-history", async (req, res): Promise<void> => {
  const { id } = GetCrewWorkHistoryParams.parse(req.params);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id));
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const [jobs, props, invoices, extras] = await Promise.all([
    db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.crewLeaderId, id))
      .orderBy(desc(jobsTable.createdAt)),
    db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable),
    db
      .select()
      .from(crewInvoicesTable)
      .where(eq(crewInvoicesTable.crewId, id))
      .orderBy(desc(crewInvoicesTable.createdAt)),
    db
      .select()
      .from(crewPaymentsTable)
      .where(
        and(
          eq(crewPaymentsTable.crewId, id),
          inArray(crewPaymentsTable.kind, ["bonus", "gift_card"]),
        ),
      )
      .orderBy(desc(crewPaymentsTable.createdAt)),
  ]);
  const propsById = new Map(props.map((p) => [p.id, p.name]));
  // Service names live on job line items, not the job row.
  const jobIds = jobs.map((j) => j.id);
  const lineItems =
    jobIds.length > 0
      ? await db
          .select({ jobId: jobLineItemsTable.jobId, service: jobLineItemsTable.service })
          .from(jobLineItemsTable)
          .where(inArray(jobLineItemsTable.jobId, jobIds))
      : [];
  const servicesByJob = new Map<string, string[]>();
  for (const li of lineItems) {
    if (!li.service) continue;
    const list = servicesByJob.get(li.jobId) ?? [];
    if (!list.includes(li.service)) list.push(li.service);
    servicesByJob.set(li.jobId, list);
  }
  const completed = jobs.filter(
    (j) =>
      j.status === "complete" ||
      j.status === "paid" ||
      j.clearedAt != null ||
      ["completed", "billing", "pay_alert"].includes(j.boardStatus ?? ""),
  );
  res.json(
    GetCrewWorkHistoryResponse.parse({
      jobs: completed.map((j) => ({
        jobId: j.id,
        completedOn: (j.completedAt ?? j.clearedAt ?? j.createdAt)?.toISOString().slice(0, 10) ?? null,
        propertyId: j.propertyId ?? null,
        propertyName: (j.propertyId && propsById.get(j.propertyId)) || "Unknown property",
        unitNo: j.unitNo ?? null,
        services: servicesByJob.get(j.id) ?? [],
      })),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo ?? null,
        propertyId: inv.propertyId ?? null,
        propertyName:
          (inv.propertyId && propsById.get(inv.propertyId)) || inv.propertyAddress || "Unknown property",
        amount: inv.total,
        // A cleared invoice is paid regardless of its review status.
        status: inv.clearedAt ? "paid" : inv.status,
        invoiceDate: inv.invoiceDate ?? null,
      })),
      extras: extras.map((p) => ({ ...ser(p), crewName: null })),
    }),
  );
});

router.get("/crews/:id/invoices", async (req, res): Promise<void> => {
  const { id } = ListCrewInvoicesParams.parse(req.params);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id))
    .limit(1);
  if (!crew) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  const invoices = await db
    .select()
    .from(crewInvoicesTable)
    .where(eq(crewInvoicesTable.crewId, id))
    .orderBy(desc(crewInvoicesTable.createdAt));
  const ids = invoices.map((i) => i.id);
  const items =
    ids.length > 0
      ? await db
          .select()
          .from(crewInvoiceItemsTable)
          .where(inArray(crewInvoiceItemsTable.invoiceId, ids))
      : [];
  const labels = await jobLabelMap(
    invoices.map((i) => i.jobId).filter((v): v is string => !!v),
  );
  res.json(
    ListCrewInvoicesResponse.parse(
      invoices.map((inv) => ({
        ...ser(inv),
        jobLabel: inv.jobId ? (labels.get(inv.jobId) ?? null) : null,
        items: items
          .filter((it) => it.invoiceId === inv.id)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((it) => ser(it)),
      })),
    ),
  );
});

// ---------------------------------------------------------------------------
// Crew A/P queue — all crew invoices across every crew (office view)
// ---------------------------------------------------------------------------
router.get("/crew-invoice-queue", async (req, res): Promise<void> => {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
  const searchRaw = typeof req.query.search === "string" ? req.query.search.trim() : null;

  // Build joined query: crew_invoices ⨝ crews
  const conditions: ReturnType<typeof eq>[] = [];
  if (statusFilter) {
    conditions.push(eq(crewInvoicesTable.status, statusFilter));
  }

  const rows = await db
    .select({
      invoice: crewInvoicesTable,
      crewName: crewsTable.name,
    })
    .from(crewInvoicesTable)
    .innerJoin(crewsTable, eq(crewsTable.id, crewInvoicesTable.crewId))
    .where(
      and(
        ...(conditions.length ? conditions : [sql`1=1`]),
        searchRaw
          ? ilike(crewsTable.name, `%${searchRaw}%`)
          : undefined,
      ),
    )
    // needs_corrections last; submitted first, then approved, paid — newest within each group
    .orderBy(
      sql`CASE ${crewInvoicesTable.status}
        WHEN 'submitted' THEN 1
        WHEN 'approved'  THEN 2
        WHEN 'paid'      THEN 3
        ELSE 4 END`,
      desc(crewInvoicesTable.createdAt),
    );

  const invoiceIds = rows.map((r) => r.invoice.id);
  const allItems =
    invoiceIds.length > 0
      ? await db
          .select()
          .from(crewInvoiceItemsTable)
          .where(inArray(crewInvoiceItemsTable.invoiceId, invoiceIds))
      : [];

  const labels = await jobLabelMap(
    rows.map((r) => r.invoice.jobId).filter((v): v is string => !!v),
  );

  const itemsByInvoice = new Map<string, typeof allItems>();
  for (const it of allItems) {
    const list = itemsByInvoice.get(it.invoiceId) ?? [];
    list.push(it);
    itemsByInvoice.set(it.invoiceId, list);
  }

  res.json(
    GetCrewInvoiceQueueResponse.parse(
      rows.map(({ invoice: inv, crewName }) => ({
        ...ser(inv),
        crewName,
        jobLabel: inv.jobId ? (labels.get(inv.jobId) ?? null) : null,
        items: (itemsByInvoice.get(inv.id) ?? [])
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((it) => ser(it)),
      })),
    ),
  );
});

router.patch("/crew-invoices/:id", async (req, res): Promise<void> => {
  const { id } = ReviewCrewInvoiceParams.parse(req.params);
  const body = ReviewCrewInvoiceBody.parse(req.body);
  const [inv] = await db
    .select()
    .from(crewInvoicesTable)
    .where(eq(crewInvoicesTable.id, id))
    .limit(1);
  if (!inv) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  const now = new Date();
  let updates: Partial<typeof crewInvoicesTable.$inferInsert>;
  let noteText = "";
  if (body.action === "approve") {
    if (inv.status !== "submitted" && inv.status !== "needs_corrections") {
      res.status(409).json({
        error: `Only submitted invoices can be approved (this one is ${inv.status})`,
      });
      return;
    }
    updates = { status: "approved", decidedAt: now, adminNote: null };
  } else if (body.action === "send_back") {
    if (inv.status !== "submitted") {
      res.status(409).json({
        error: `Only submitted invoices can be sent back (this one is ${inv.status})`,
      });
      return;
    }
    const note = body.note?.trim();
    if (!note) {
      res
        .status(400)
        .json({ error: "A note is required when sending back for corrections" });
      return;
    }
    noteText = note;
    updates = { status: "needs_corrections", decidedAt: now, adminNote: note };
  } else if (body.action === "mark_paid") {
    if (inv.status !== "approved") {
      res.status(409).json({
        error: `Only approved invoices can be marked paid (this one is ${inv.status})`,
      });
      return;
    }
    updates = { status: "paid", decidedAt: inv.decidedAt ?? now };
  } else {
    if (inv.status === "submitted") {
      res.status(409).json({
        error: "Review this invoice before clearing it to history",
      });
      return;
    }
    if (inv.clearedAt) {
      res.status(409).json({ error: "This invoice is already in history" });
      return;
    }
    updates = { clearedAt: now };
  }
  const [updated] = await db
    .update(crewInvoicesTable)
    .set(updates)
    .where(eq(crewInvoicesTable.id, id))
    .returning();
  const items = await db
    .select()
    .from(crewInvoiceItemsTable)
    .where(eq(crewInvoiceItemsTable.invoiceId, id));

  if (body.action !== "clear") {
    const [crew] = await db
      .select({ name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, inv.crewId))
      .limit(1);
    const labels: Record<string, string> = {
      approve: "approved",
      send_back: "sent back for corrections",
      mark_paid: "marked paid",
    };
    await db.insert(notificationsTable).values({
      kind: "crew_invoice",
      priority: "normal",
      entityType: "crew",
      entityId: inv.crewId,
      title: `Invoice ${inv.invoiceNo ? `${inv.invoiceNo} ` : ""}from ${crew?.name ?? "crew"} ${labels[body.action]} — $${inv.total.toFixed(2)}`,
      body: noteText || inv.propertyAddress,
    });
  }

  res.json(
    ReviewCrewInvoiceResponse.parse({
      ...ser(updated),
      items: items
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((it) => ser(it)),
    }),
  );
});

router.post("/crews/:id/documents", async (req, res): Promise<void> => {
  const { id } = SendCrewDocumentParams.parse(req.params);
  const body = SendCrewDocumentBody.parse(req.body);
  const [row] = await db
    .insert(crewDocumentsTable)
    .values({
      crewId: id,
      direction: "to_crew",
      name: body.name,
      storagePath: body.storagePath,
      contentType: body.contentType ?? null,
      size: body.size ?? null,
      note: body.note ?? null,
    })
    .returning();
  res.status(201).json(SendCrewDocumentResponse.parse(ser(row)));
});

router.patch("/crews/:id/payment-method", async (req, res): Promise<void> => {
  const { id } = UpdateCrewPaymentMethodParams.parse(req.params);
  const body = UpdateCrewPaymentMethodBody.parse(req.body);
  const [row] = await db
    .update(crewsTable)
    .set({
      preferredPaymentMethod: body.preferredPaymentMethod ?? null,
      paymentDetails: body.paymentDetails ?? null,
    })
    .where(eq(crewsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Crew not found" });
    return;
  }
  res.json(UpdateCrewPaymentMethodResponse.parse(crewDetail(row)));
});

router.get("/crew-payments", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(crewPaymentsTable)
    .orderBy(desc(crewPaymentsTable.createdAt));
  const crews = await db.select().from(crewsTable);
  const names = new Map(crews.map((c) => [c.id, c.name]));
  res.json(
    ListCrewPaymentsResponse.parse(
      rows.map((r) => ({ ...ser(r), crewName: names.get(r.crewId) ?? null })),
    ),
  );
});

router.post("/crew-payments", async (req, res): Promise<void> => {
  const body = CreateCrewPaymentBody.parse(req.body);
  const status = body.status ?? "pending";
  // Idempotency guard: one payment per (job, crew). A double-click or retry
  // should never record the crew as paid twice for the same job.
  if (body.jobId) {
    const existing = await db
      .select()
      .from(crewPaymentsTable)
      .where(
        and(
          eq(crewPaymentsTable.jobId, body.jobId),
          eq(crewPaymentsTable.crewId, body.crewId),
          ne(crewPaymentsTable.status, "cancelled"),
        ),
      );
    const prior =
      existing.find((p) => p.status === "completed") ?? existing[0];
    if (prior) {
      let row = prior;
      if (status === "completed" && prior.status !== "completed") {
        const [updated] = await db
          .update(crewPaymentsTable)
          .set({ status: "completed", paidAt: new Date() })
          .where(eq(crewPaymentsTable.id, prior.id))
          .returning();
        if (updated) row = updated;
      }
      const [crew] = await db
        .select()
        .from(crewsTable)
        .where(eq(crewsTable.id, row.crewId));
      res
        .status(201)
        .json(
          CreateCrewPaymentResponse.parse({
            ...ser(row),
            crewName: crew?.name ?? null,
          }),
        );
      return;
    }
  }
  const [row] = await db
    .insert(crewPaymentsTable)
    .values({
      crewId: body.crewId,
      amount: body.amount,
      method: body.method ?? null,
      status,
      kind: body.kind ?? null,
      note: body.note ?? null,
      jobId: body.jobId ?? null,
      dueOn: body.dueOn ? new Date(body.dueOn) : null,
      paidAt: status === "completed" ? new Date() : null,
    })
    .returning();
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId));
  res
    .status(201)
    .json(
      CreateCrewPaymentResponse.parse({
        ...ser(row),
        crewName: crew?.name ?? null,
      }),
    );
});

router.patch("/crew-payments/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCrewPaymentParams.parse(req.params);
  const body = UpdateCrewPaymentBody.parse(req.body);
  const [existing] = await db
    .select()
    .from(crewPaymentsTable)
    .where(eq(crewPaymentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Payment not found" });
    return;
  }
  const patch: Partial<typeof crewPaymentsTable.$inferInsert> = {};
  if (body.amount != null) patch.amount = body.amount;
  if (body.method !== undefined) patch.method = body.method ?? null;
  if (body.note !== undefined) patch.note = body.note ?? null;
  if (body.dueOn !== undefined)
    patch.dueOn = body.dueOn ? new Date(body.dueOn) : null;
  if (body.status != null) {
    patch.status = body.status;
    if (body.status === "completed" && !existing.paidAt) {
      patch.paidAt = new Date();
    }
    if (body.status === "pending") patch.paidAt = null;
  }
  if (body.paidAt !== undefined)
    patch.paidAt = body.paidAt ? new Date(body.paidAt) : null;
  const [row] = await db
    .update(crewPaymentsTable)
    .set(patch)
    .where(eq(crewPaymentsTable.id, id))
    .returning();
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId));
  res.json(
    UpdateCrewPaymentResponse.parse({
      ...ser(row),
      crewName: crew?.name ?? null,
    }),
  );
});

export default router;
