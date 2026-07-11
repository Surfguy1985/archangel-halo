import { Router, type IRouter } from "express";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewMessagesTable,
  crewCheckinsTable,
  crewDocumentsTable,
  crewPhotosTable,
  schedulesTable,
  jobsTable,
  propertiesTable,
  contactsTable,
  calendarEventsTable,
  notificationsTable,
} from "@workspace/db";
import {
  GetPortalParams,
  GetPortalResponse,
  ListPortalMessagesParams,
  ListPortalMessagesResponse,
  SendPortalMessageParams,
  SendPortalMessageBody,
  SendPortalMessageResponse,
  CreatePortalCheckinParams,
  CreatePortalCheckinBody,
  CreatePortalCheckinResponse,
  ListPortalDocumentsParams,
  ListPortalDocumentsResponse,
  UploadPortalDocumentParams,
  UploadPortalDocumentBody,
  UploadPortalDocumentResponse,
  ListPortalPhotosParams,
  ListPortalPhotosResponse,
  UploadPortalPhotoParams,
  UploadPortalPhotoBody,
  UploadPortalPhotoResponse,
  GetPortalW9Params,
  GetPortalW9Response,
  SubmitPortalW9Params,
  SubmitPortalW9Body,
  SubmitPortalW9Response,
  SetPortalPaymentMethodParams,
  SetPortalPaymentMethodBody,
  SetPortalPaymentMethodResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";

const router: IRouter = Router();

type CrewRow = typeof crewsTable.$inferSelect;

// Split a free-form description into a short task list for the crew.
function taskify(...texts: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    const parts = text
      .split(/\r?\n|•|;/)
      .map((p) => p.replace(/^[-*\u2013\u2022]\s*/, "").trim())
      .filter((p) => p.length > 0);
    out.push(...parts);
  }
  return out.slice(0, 8);
}

// "HH:MM" (24h) -> "8:00 AM" for display alongside free-form windowStart values.
function to12h(hhmm: string | null | undefined): string | null {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return hhmm;
  let hour = parseInt(m[1]!, 10);
  const mer = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${hour}:${m[2]} ${mer}`;
}

async function crewByToken(token: string): Promise<CrewRow | null> {
  if (!token) return null;
  const [row] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.portalToken, token));
  return row ?? null;
}

router.get("/portal/:token", async (req, res): Promise<void> => {
  const { token } = GetPortalParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }

  const now = new Date();
  const dow = now.getDay();
  const diffToMon = (dow + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekStart = fmtDate(monday);
  const weekEnd = fmtDate(sunday);

  const [schedRows, eventRows, jobs, props, contacts] = await Promise.all([
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.crewLeaderId, crew.id),
          gte(schedulesTable.scheduledOn, weekStart),
          lte(schedulesTable.scheduledOn, weekEnd),
        ),
      )
      .orderBy(schedulesTable.scheduledOn),
    db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          eq(calendarEventsTable.crewId, crew.id),
          gte(calendarEventsTable.eventDate, weekStart),
          lte(calendarEventsTable.eventDate, weekEnd),
        ),
      )
      .orderBy(calendarEventsTable.eventDate),
    db.select().from(jobsTable),
    db.select().from(propertiesTable),
    db.select().from(contactsTable),
  ]);

  const jobsById = new Map(jobs.map((j) => [j.id, j]));
  const propsById = new Map(props.map((p) => [p.id, p]));

  // Best phone contact per property: prefer on-site roles, then any with a phone.
  const contactForProp = (propertyId: string | null | undefined) => {
    if (!propertyId) return null;
    const forProp = contacts.filter(
      (c) => c.propertyId === propertyId && c.phone,
    );
    if (forProp.length === 0) return null;
    const onSite = forProp.find((c) => /on.?site|maint/i.test(c.role ?? ""));
    return onSite ?? forProp[0]!;
  };

  const propFields = (propertyId: string | null | undefined) => {
    const prop = propertyId ? propsById.get(propertyId) : undefined;
    const contact = contactForProp(propertyId);
    return {
      propertyName: prop?.name ?? null,
      propertyAddress: prop?.address ?? null,
      propertyCity: prop?.city ?? null,
      contactName: contact?.name ?? null,
      contactPhone: contact?.phone ?? null,
    };
  };

  const schedule = schedRows.map((s) => {
    const job = jobsById.get(s.jobId);
    return {
      id: s.id,
      kind: "job",
      jobNo: job?.jobNo ?? null,
      description: job?.description ?? null,
      ...propFields(job?.propertyId),
      unitNo: job?.unitNo ?? null,
      scheduledOn: s.scheduledOn ?? null,
      windowStart: s.windowStart ?? null,
      status: (s.status ?? null) as string | null,
      tasks: taskify(job?.description),
    };
  });

  // Calendar events assigned to this crew also show up in their portal.
  const scheduledJobDays = new Set(
    schedRows.map((s) => `${s.jobId}|${s.scheduledOn}`),
  );
  for (const ev of eventRows) {
    if (ev.jobId && scheduledJobDays.has(`${ev.jobId}|${ev.eventDate}`)) {
      continue; // already represented by the job schedule row
    }
    const job = ev.jobId ? jobsById.get(ev.jobId) : undefined;
    schedule.push({
      id: `event-${ev.id}`,
      kind: "event",
      jobNo: job?.jobNo ?? null,
      description: ev.title,
      ...propFields(job?.propertyId),
      unitNo: job?.unitNo ?? null,
      scheduledOn: ev.eventDate,
      windowStart: to12h(ev.startTime),
      status: null,
      tasks: ev.notes ? taskify(ev.notes) : taskify(job?.description),
    });
  }
  schedule.sort((a, b) =>
    (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? ""),
  );

  res.json(
    GetPortalResponse.parse({
      crew: {
        id: crew.id,
        name: crew.name,
        trade: crew.trade,
        preferredPaymentMethod: crew.preferredPaymentMethod,
        paymentDetails: crew.paymentDetails,
        w9Submitted: crew.w9SubmittedAt != null,
      },
      schedule,
    }),
  );
});

router.get("/portal/:token/messages", async (req, res): Promise<void> => {
  const { token } = ListPortalMessagesParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const rows = await db
    .select()
    .from(crewMessagesTable)
    .where(eq(crewMessagesTable.crewId, crew.id))
    .orderBy(crewMessagesTable.createdAt);
  res.json(ListPortalMessagesResponse.parse(rows.map((r) => ser(r))));
});

router.post("/portal/:token/messages", async (req, res): Promise<void> => {
  const { token } = SendPortalMessageParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = SendPortalMessageBody.parse(req.body);
  const [row] = await db
    .insert(crewMessagesTable)
    .values({ crewId: crew.id, sender: "crew", body: body.body })
    .returning();
  await db.insert(notificationsTable).values({
    kind: "crew_message",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `New message from ${crew.name}`,
    body: body.body.slice(0, 200),
  });
  res.status(201).json(SendPortalMessageResponse.parse(ser(row)));
});

router.post("/portal/:token/checkins", async (req, res): Promise<void> => {
  const { token } = CreatePortalCheckinParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = CreatePortalCheckinBody.parse(req.body);
  const [row] = await db
    .insert(crewCheckinsTable)
    .values({
      crewId: crew.id,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      accuracy: body.accuracy ?? null,
      label: body.label ?? null,
      note: body.note ?? null,
    })
    .returning();
  await db.insert(notificationsTable).values({
    kind: "crew_checkin",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} checked in`,
    body: body.label ?? (body.lat != null ? `${body.lat}, ${body.lng}` : null),
  });
  res.status(201).json(CreatePortalCheckinResponse.parse(ser(row)));
});

router.get("/portal/:token/documents", async (req, res): Promise<void> => {
  const { token } = ListPortalDocumentsParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const rows = await db
    .select()
    .from(crewDocumentsTable)
    .where(eq(crewDocumentsTable.crewId, crew.id))
    .orderBy(desc(crewDocumentsTable.createdAt));
  res.json(ListPortalDocumentsResponse.parse(rows.map((r) => ser(r))));
});

router.post("/portal/:token/documents", async (req, res): Promise<void> => {
  const { token } = UploadPortalDocumentParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = UploadPortalDocumentBody.parse(req.body);
  const [row] = await db
    .insert(crewDocumentsTable)
    .values({
      crewId: crew.id,
      direction: "from_crew",
      name: body.name,
      storagePath: body.storagePath,
      contentType: body.contentType ?? null,
      size: body.size ?? null,
      note: body.note ?? null,
    })
    .returning();
  await db.insert(notificationsTable).values({
    kind: "crew_document",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} uploaded a document`,
    body: body.name,
  });
  res.status(201).json(UploadPortalDocumentResponse.parse(ser(row)));
});

router.get("/portal/:token/photos", async (req, res): Promise<void> => {
  const { token } = ListPortalPhotosParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const rows = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.crewId, crew.id))
    .orderBy(desc(crewPhotosTable.createdAt));
  res.json(ListPortalPhotosResponse.parse(rows.map((r) => ser(r))));
});

router.post("/portal/:token/photos", async (req, res): Promise<void> => {
  const { token } = UploadPortalPhotoParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = UploadPortalPhotoBody.parse(req.body);
  const [row] = await db
    .insert(crewPhotosTable)
    .values({
      crewId: crew.id,
      storagePath: body.storagePath,
      takenOn: body.takenOn,
      note: body.note ?? null,
    })
    .returning();
  await db.insert(notificationsTable).values({
    kind: "crew_photo",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} sent a photo`,
    body: body.note ?? `Daily activity photo for ${body.takenOn}`,
  });
  res.status(201).json(UploadPortalPhotoResponse.parse(ser(row)));
});

router.get("/portal/:token/w9", async (req, res): Promise<void> => {
  const { token } = GetPortalW9Params.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  res.json(
    GetPortalW9Response.parse({
      submitted: crew.w9SubmittedAt != null,
      submittedAt: crew.w9SubmittedAt ? crew.w9SubmittedAt.toISOString() : null,
      data: (crew.w9 as Record<string, unknown> | null) ?? null,
    }),
  );
});

router.put("/portal/:token/w9", async (req, res): Promise<void> => {
  const { token } = SubmitPortalW9Params.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = SubmitPortalW9Body.parse(req.body);
  const now = new Date();
  await db
    .update(crewsTable)
    .set({ w9: body, w9SubmittedAt: now })
    .where(eq(crewsTable.id, crew.id));
  await db.insert(notificationsTable).values({
    kind: "crew_w9",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} submitted a W-9`,
    body: null,
  });
  res.json(
    SubmitPortalW9Response.parse({
      submitted: true,
      submittedAt: now.toISOString(),
      data: body,
    }),
  );
});

router.put("/portal/:token/payment-method", async (req, res): Promise<void> => {
  const { token } = SetPortalPaymentMethodParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = SetPortalPaymentMethodBody.parse(req.body);
  await db
    .update(crewsTable)
    .set({
      preferredPaymentMethod: body.preferredPaymentMethod ?? null,
      paymentDetails: body.paymentDetails ?? null,
    })
    .where(eq(crewsTable.id, crew.id));
  await db.insert(notificationsTable).values({
    kind: "crew_payment_method",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} updated their payment details`,
    body: body.preferredPaymentMethod
      ? `Preferred method: ${body.preferredPaymentMethod}`
      : null,
  });
  res.json(
    SetPortalPaymentMethodResponse.parse({
      preferredPaymentMethod: body.preferredPaymentMethod ?? null,
      paymentDetails: body.paymentDetails ?? null,
    }),
  );
});

export default router;
