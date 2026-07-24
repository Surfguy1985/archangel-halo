import { Router, type IRouter } from "express";
import { and, count, desc, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewMessagesTable,
  crewCheckinsTable,
  crewDocumentsTable,
  crewPhotosTable,
  crewPacketsTable,
  crewInvoicesTable,
  crewInvoiceItemsTable,
  schedulesTable,
  jobsTable,
  jobBroadcastsTable,
  priceItemsTable,
  activitiesTable,
  propertiesTable,
  contactsTable,
  calendarEventsTable,
  notificationsTable,
  wingMembersTable,
  wingOverridesTable,
  wingScoreSnapshotsTable,
  wingReserveAccountsTable,
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
  ListPortalJobsParams,
  ListPortalJobsResponse,
  GetPortalW9Params,
  GetPortalW9Response,
  SubmitPortalW9Params,
  SubmitPortalW9Body,
  SubmitPortalW9Response,
  SetPortalPaymentMethodParams,
  SetPortalPaymentMethodBody,
  SetPortalPaymentMethodResponse,
  RespondPortalOfferParams,
  RespondPortalOfferBody,
  RespondPortalOfferResponse,
  ListPortalInvoicesParams,
  ListPortalInvoicesResponse,
  SubmitPortalInvoiceParams,
  SubmitPortalInvoiceBody,
  SubmitPortalInvoiceResponse,
  ResubmitPortalInvoiceParams,
  ResubmitPortalInvoiceBody,
  ResubmitPortalInvoiceResponse,
  MarkPortalSeenParams,
  MarkPortalSeenBody,
  MarkPortalSeenResponse,
  AcceptPortalAgreementParams,
  AcceptPortalAgreementResponse,
  SetPortalSelfieParams,
  SetPortalSelfieBody,
  SetPortalSelfieResponse,
  GetJobTrackerParams,
  GetJobTrackerResponse,
} from "@workspace/api-zod";
import { createHash } from "node:crypto";
import { businessSettingsTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import { logger } from "../lib/logger";
import { ser } from "../lib/serialize";
import { buildJobLabel, jobLabelMap } from "../lib/jobLabels";

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

// Anything the office sent that the crew hasn't looked at yet, per portal section.
// crews.portal_seen stores { section: lastSeenISO }; missing key = never seen.
async function computeUnseen(crew: CrewRow) {
  const seen = (crew.portalSeen as Record<string, string> | null) ?? {};
  const since = (section: string) =>
    seen[section] ? new Date(seen[section]!) : new Date(0);

  const [offers, sched, events, messages, packets, documents] =
    await Promise.all([
      db
        .select({ n: count() })
        .from(jobBroadcastsTable)
        .where(
          and(
            eq(jobBroadcastsTable.crewId, crew.id),
            eq(jobBroadcastsTable.status, "pending"),
            gt(jobBroadcastsTable.sentAt, since("offers")),
          ),
        ),
      db
        .select({ n: count() })
        .from(schedulesTable)
        .where(
          and(
            eq(schedulesTable.crewLeaderId, crew.id),
            gt(schedulesTable.createdAt, since("schedule")),
          ),
        ),
      db
        .select({ n: count() })
        .from(calendarEventsTable)
        .where(
          and(
            eq(calendarEventsTable.crewId, crew.id),
            gt(calendarEventsTable.createdAt, since("schedule")),
          ),
        ),
      db
        .select({ n: count() })
        .from(crewMessagesTable)
        .where(
          and(
            eq(crewMessagesTable.crewId, crew.id),
            eq(crewMessagesTable.sender, "admin"),
            gt(crewMessagesTable.createdAt, since("messages")),
          ),
        ),
      db
        .select({ n: count() })
        .from(crewPacketsTable)
        .where(
          and(
            eq(crewPacketsTable.crewId, crew.id),
            gt(crewPacketsTable.sentAt, since("packets")),
          ),
        ),
      db
        .select({ n: count() })
        .from(crewDocumentsTable)
        .where(
          and(
            eq(crewDocumentsTable.crewId, crew.id),
            eq(crewDocumentsTable.direction, "to_crew"),
            gt(crewDocumentsTable.createdAt, since("documents")),
          ),
        ),
    ]);

  return {
    offers: offers[0]?.n ?? 0,
    schedule: (sched[0]?.n ?? 0) + (events[0]?.n ?? 0),
    messages: messages[0]?.n ?? 0,
    packets: packets[0]?.n ?? 0,
    documents: documents[0]?.n ?? 0,
  };
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

  // Best contact per property: prefer on-site roles with a phone, then any
  // with a phone, then any contact at all (so name/email still show).
  const contactForProp = (propertyId: string | null | undefined) => {
    if (!propertyId) return null;
    const forProp = contacts.filter((c) => c.propertyId === propertyId);
    if (forProp.length === 0) return null;
    const withPhone = forProp.filter((c) => c.phone);
    const onSite = withPhone.find((c) => /on.?site|maint/i.test(c.role ?? ""));
    return onSite ?? withPhone[0] ?? forProp[0]!;
  };

  const propFields = (propertyId: string | null | undefined) => {
    const prop = propertyId ? propsById.get(propertyId) : undefined;
    const contact = contactForProp(propertyId);
    return {
      propertyName: prop?.name ?? null,
      propertyAddress: prop?.address ?? null,
      propertyCity: prop?.city ?? null,
      contactName: contact?.name ?? null,
      contactRole: contact?.role ?? null,
      contactPhone: contact?.phone ?? null,
      contactEmail: contact?.email ?? null,
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

  // Job offers broadcast to this crew (pending first, then recent responses).
  const offerRows = await db
    .select()
    .from(jobBroadcastsTable)
    .where(
      and(
        eq(jobBroadcastsTable.crewId, crew.id),
        inArray(jobBroadcastsTable.status, [
          "pending",
          "approved",
          "declined",
        ]),
      ),
    )
    .orderBy(desc(jobBroadcastsTable.sentAt));

  const offerJobIds = [...new Set(offerRows.map((o) => o.jobId))];
  const offerPropIds = [
    ...new Set(
      offerRows
        .map((o) => jobsById.get(o.jobId)?.propertyId)
        .filter((p): p is string => Boolean(p)),
    ),
  ];
  const [offerPhotos] = await Promise.all([
    offerJobIds.length > 0
      ? db
          .select()
          .from(activitiesTable)
          .where(
            and(
              eq(activitiesTable.entityType, "job"),
              inArray(activitiesTable.entityId, offerJobIds),
            ),
          )
      : Promise.resolve([] as (typeof activitiesTable.$inferSelect)[]),
  ]);

  const offers = offerRows
    .filter((o) => jobsById.has(o.jobId))
    .slice(0, 20)
    .map((o) => {
      const job = jobsById.get(o.jobId)!;
      return {
        id: o.id,
        jobId: o.jobId,
        status: o.status,
        sentAt: o.sentAt ? o.sentAt.toISOString() : null,
        respondedAt: o.respondedAt ? o.respondedAt.toISOString() : null,
        jobNo: job.jobNo,
        category: job.category,
        description: job.description,
        unitNo: job.unitNo,
        scheduledOn: job.scheduledOn,
        ...propFields(job.propertyId),
        scheduleType: job.scheduleType ?? "scheduled",
        flexDueBy: job.flexDueBy,
        crewsNeeded: job.crewsNeeded ?? 1,
        crewsFilled: job.crewsFilled ?? 0,
        filledByOther: job.boardStatus === "filled" && o.status !== "approved",
        tasks: taskify(job.description),
        photos: offerPhotos
          .filter(
            (a) =>
              a.entityId === o.jobId &&
              a.storagePath &&
              (a.kind === "photo_before" || a.kind === "photo_after"),
          )
          .map((a) => ({ kind: a.kind, storagePath: a.storagePath! })),
      };
    });

  const unseen = await computeUnseen(crew);

  res.json(
    GetPortalResponse.parse({
      crew: {
        id: crew.id,
        name: crew.name,
        trade: crew.trade,
        preferredPaymentMethod: crew.preferredPaymentMethod,
        paymentDetails: crew.paymentDetails,
        w9Submitted: crew.w9SubmittedAt != null,
        agreementAcceptedAt: crew.agreementAcceptedAt
          ? crew.agreementAcceptedAt.toISOString()
          : null,
        selfiePath: crew.selfiePath ?? null,
      },
      schedule,
      offers,
      unseen,
    }),
  );
});

router.post("/portal/:token/seen", async (req, res): Promise<void> => {
  const { token } = MarkPortalSeenParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = MarkPortalSeenBody.parse(req.body);
  const seen = (crew.portalSeen as Record<string, string> | null) ?? {};
  seen[body.section] = new Date().toISOString();
  await db
    .update(crewsTable)
    .set({ portalSeen: seen })
    .where(eq(crewsTable.id, crew.id));
  const unseen = await computeUnseen({ ...crew, portalSeen: seen });
  res.json(MarkPortalSeenResponse.parse(unseen));
});

async function invoicesWithItems(crewId: string) {
  const invoices = await db
    .select()
    .from(crewInvoicesTable)
    .where(eq(crewInvoicesTable.crewId, crewId))
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
  return invoices.map((inv) => ({
    ...ser(inv),
    jobLabel: inv.jobId ? (labels.get(inv.jobId) ?? null) : null,
    items: items
      .filter((it) => it.invoiceId === inv.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((it) => ser(it)),
  }));
}

// Resolve an optional job link on a crew invoice. The job must be assigned to
// this crew; propertyId is derived server-side from the job (never trusted
// from the client).
async function resolveInvoiceJobLink(
  crewId: string,
  jobId: string | null | undefined,
): Promise<
  | { ok: true; jobId: string | null; propertyId: string | null; label: string | null }
  | { ok: false; error: string }
> {
  if (!jobId) return { ok: true, jobId: null, propertyId: null, label: null };
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, jobId));
  if (!job) return { ok: false, error: "That job no longer exists" };
  if (job.crewLeaderId !== crewId) {
    return { ok: false, error: "That job isn't assigned to your crew" };
  }
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId));
  return {
    ok: true,
    jobId: job.id,
    propertyId: job.propertyId,
    label: buildJobLabel(job.jobNo, prop?.name, job.unitNo),
  };
}

router.get("/portal/:token/invoices", async (req, res): Promise<void> => {
  const { token } = ListPortalInvoicesParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  res.json(ListPortalInvoicesResponse.parse(await invoicesWithItems(crew.id)));
});

router.post("/portal/:token/invoices", async (req, res): Promise<void> => {
  const { token } = SubmitPortalInvoiceParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = SubmitPortalInvoiceBody.parse(req.body);

  if (!body.fromCompany.trim()) {
    res.status(400).json({ error: "Your company name is required" });
    return;
  }
  if (!body.propertyAddress.trim()) {
    res.status(400).json({ error: "Property address is required" });
    return;
  }
  if (!body.signatureName.trim()) {
    res.status(400).json({ error: "Type your full name to sign" });
    return;
  }
  const items = body.items.filter(
    (it) => it.typeOfWork.trim() || it.qty || it.unitPrice,
  );
  if (items.length === 0) {
    res.status(400).json({ error: "Add at least one line item" });
    return;
  }
  for (const it of items) {
    if (!it.dateOfWork.trim() || !it.typeOfWork.trim()) {
      res
        .status(400)
        .json({ error: "Every line needs a date of work and type of work" });
      return;
    }
    if (
      !Number.isFinite(it.qty) ||
      it.qty <= 0 ||
      !Number.isFinite(it.unitPrice) ||
      it.unitPrice < 0
    ) {
      res.status(400).json({
        error: "Every line needs a quantity above zero and a valid unit price",
      });
      return;
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const lineAmounts = items.map((it) => round2(it.qty * it.unitPrice));
  const subtotal = round2(lineAmounts.reduce((s, a) => s + a, 0));
  const now = new Date();

  const link = await resolveInvoiceJobLink(crew.id, body.jobId);
  if (!link.ok) {
    res.status(400).json({ error: link.error });
    return;
  }

  const created = await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(crewInvoicesTable)
      .values({
        crewId: crew.id,
        jobId: link.jobId,
        propertyId: link.propertyId,
        invoiceNo: body.invoiceNo?.trim() || null,
        poNumber: body.poNumber?.trim() || null,
        invoiceDate: body.invoiceDate,
        terms: body.terms ?? null,
        dueDate: body.dueDate ?? null,
        fromCompany: body.fromCompany.trim(),
        fromTrade: body.fromTrade?.trim() || null,
        fromAddress: body.fromAddress?.trim() || null,
        fromCityStateZip: body.fromCityStateZip?.trim() || null,
        fromContact: body.fromContact?.trim() || null,
        fromPhone: body.fromPhone?.trim() || null,
        fromEmail: body.fromEmail?.trim() || null,
        propertyAddress: body.propertyAddress.trim(),
        subtotal,
        total: subtotal,
        signatureName: body.signatureName.trim(),
        signedAt: now,
        status: "submitted",
      })
      .returning();
    const itemRows = await tx
      .insert(crewInvoiceItemsTable)
      .values(
        items.map((it, idx) => ({
          invoiceId: inv!.id,
          dateOfWork: it.dateOfWork,
          unitNo: it.unitNo?.trim() || null,
          typeOfWork: it.typeOfWork.trim(),
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: lineAmounts[idx]!,
          sortOrder: idx,
        })),
      )
      .returning();
    return { inv: inv!, itemRows };
  });

  await db.insert(notificationsTable).values({
    kind: "crew_invoice",
    priority: "urgent",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} sent an invoice — $${subtotal.toFixed(2)}`,
    body: `${created.inv.invoiceNo ? `Invoice ${created.inv.invoiceNo} · ` : ""}${body.propertyAddress.trim()} · signed by ${body.signatureName.trim()}`,
  });

  res.status(201).json(
    SubmitPortalInvoiceResponse.parse({
      ...ser(created.inv),
      jobLabel: link.label,
      items: created.itemRows.map((it) => ser(it)),
    }),
  );
});

router.patch(
  "/portal/:token/invoices/:invoiceId",
  async (req, res): Promise<void> => {
    const { token, invoiceId } = ResubmitPortalInvoiceParams.parse(req.params);
    const crew = await crewByToken(token);
    if (!crew) {
      res.status(404).json({ error: "Invalid portal link" });
      return;
    }
    const [existing] = await db
      .select()
      .from(crewInvoicesTable)
      .where(eq(crewInvoicesTable.id, invoiceId))
      .limit(1);
    if (!existing || existing.crewId !== crew.id) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (existing.status !== "needs_corrections") {
      res.status(400).json({
        error: "Only invoices sent back for corrections can be resubmitted",
      });
      return;
    }
    const body = ResubmitPortalInvoiceBody.parse(req.body);

    if (!body.fromCompany.trim()) {
      res.status(400).json({ error: "Your company name is required" });
      return;
    }
    if (!body.propertyAddress.trim()) {
      res.status(400).json({ error: "Property address is required" });
      return;
    }
    if (!body.signatureName.trim()) {
      res.status(400).json({ error: "Type your full name to sign" });
      return;
    }
    const items = body.items.filter(
      (it) => it.typeOfWork.trim() || it.qty || it.unitPrice,
    );
    if (items.length === 0) {
      res.status(400).json({ error: "Add at least one line item" });
      return;
    }
    for (const it of items) {
      if (!it.dateOfWork.trim() || !it.typeOfWork.trim()) {
        res
          .status(400)
          .json({ error: "Every line needs a date of work and type of work" });
        return;
      }
      if (
        !Number.isFinite(it.qty) ||
        it.qty <= 0 ||
        !Number.isFinite(it.unitPrice) ||
        it.unitPrice < 0
      ) {
        res.status(400).json({
          error:
            "Every line needs a quantity above zero and a valid unit price",
        });
        return;
      }
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    const lineAmounts = items.map((it) => round2(it.qty * it.unitPrice));
    const subtotal = round2(lineAmounts.reduce((s, a) => s + a, 0));
    const now = new Date();

    const link = await resolveInvoiceJobLink(crew.id, body.jobId);
    if (!link.ok) {
      res.status(400).json({ error: link.error });
      return;
    }

    const updated = await db.transaction(async (tx) => {
      const [inv] = await tx
        .update(crewInvoicesTable)
        .set({
          jobId: link.jobId,
          propertyId: link.propertyId,
          invoiceNo: body.invoiceNo?.trim() || null,
          poNumber: body.poNumber?.trim() || null,
          invoiceDate: body.invoiceDate,
          terms: body.terms ?? null,
          dueDate: body.dueDate ?? null,
          fromCompany: body.fromCompany.trim(),
          fromTrade: body.fromTrade?.trim() || null,
          fromAddress: body.fromAddress?.trim() || null,
          fromCityStateZip: body.fromCityStateZip?.trim() || null,
          fromContact: body.fromContact?.trim() || null,
          fromPhone: body.fromPhone?.trim() || null,
          fromEmail: body.fromEmail?.trim() || null,
          propertyAddress: body.propertyAddress.trim(),
          subtotal,
          total: subtotal,
          signatureName: body.signatureName.trim(),
          signedAt: now,
          status: "submitted",
          adminNote: null,
          decidedAt: null,
        })
        .where(
          and(
            eq(crewInvoicesTable.id, invoiceId),
            eq(crewInvoicesTable.crewId, crew.id),
            eq(crewInvoicesTable.status, "needs_corrections"),
          ),
        )
        .returning();
      if (!inv) {
        return null;
      }
      await tx
        .delete(crewInvoiceItemsTable)
        .where(eq(crewInvoiceItemsTable.invoiceId, invoiceId));
      const itemRows = await tx
        .insert(crewInvoiceItemsTable)
        .values(
          items.map((it, idx) => ({
            invoiceId,
            dateOfWork: it.dateOfWork,
            unitNo: it.unitNo?.trim() || null,
            typeOfWork: it.typeOfWork.trim(),
            qty: it.qty,
            unitPrice: it.unitPrice,
            amount: lineAmounts[idx]!,
            sortOrder: idx,
          })),
        )
        .returning();
      return { inv, itemRows };
    });

    if (!updated) {
      res.status(409).json({
        error: "Only invoices sent back for corrections can be resubmitted",
      });
      return;
    }

    await db.insert(notificationsTable).values({
      kind: "crew_invoice",
      priority: "urgent",
      entityType: "crew",
      entityId: crew.id,
      title: `${crew.name} resubmitted a corrected invoice — $${subtotal.toFixed(2)}`,
      body: `${updated.inv.invoiceNo ? `Invoice ${updated.inv.invoiceNo} · ` : ""}${body.propertyAddress.trim()} · signed by ${body.signatureName.trim()}`,
    });

    res.json(
      ResubmitPortalInvoiceResponse.parse({
        ...ser(updated.inv),
        jobLabel: link.label,
        items: updated.itemRows.map((it) => ser(it)),
      }),
    );
  },
);

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
  const kind = body.kind === "checkout" ? "checkout" : "checkin";
  if (body.jobId) {
    const owned = await jobBelongsToCrew(body.jobId, crew.id);
    if (!owned) {
      res.status(400).json({ error: "That job isn't assigned to this crew" });
      return;
    }
  }
  const [row] = await db
    .insert(crewCheckinsTable)
    .values({
      crewId: crew.id,
      jobId: body.jobId ?? null,
      kind,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      accuracy: body.accuracy ?? null,
      label: body.label ?? null,
      note: body.note ?? null,
    })
    .returning();
  const jobLabel = body.jobId
    ? ((await jobLabelMap([body.jobId])).get(body.jobId) ?? null)
    : null;
  await db.insert(notificationsTable).values({
    kind: "crew_checkin",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title:
      kind === "checkout"
        ? `${crew.name} checked out${jobLabel ? ` — ${jobLabel}` : ""}`
        : `${crew.name} checked in${jobLabel ? ` — ${jobLabel}` : ""}`,
    body:
      body.note ??
      body.label ??
      (body.lat != null ? `${body.lat}, ${body.lng}` : null),
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

async function jobBelongsToCrew(
  jobId: string,
  crewId: string,
): Promise<boolean> {
  const [direct] = await db
    .select({ id: jobsTable.id })
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.crewLeaderId, crewId)))
    .limit(1);
  if (direct) return true;
  const [sched] = await db
    .select({ id: schedulesTable.id })
    .from(schedulesTable)
    .where(
      and(
        eq(schedulesTable.jobId, jobId),
        eq(schedulesTable.crewLeaderId, crewId),
      ),
    )
    .limit(1);
  return !!sched;
}

router.get("/portal/:token/jobs", async (req, res): Promise<void> => {
  const { token } = ListPortalJobsParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const schedules = await db
    .select()
    .from(schedulesTable)
    .where(eq(schedulesTable.crewLeaderId, crew.id));
  const directJobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.crewLeaderId, crew.id));
  const jobIds = Array.from(
    new Set([...schedules.map((s) => s.jobId), ...directJobs.map((j) => j.id)]),
  );
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const propIds = Array.from(new Set(jobs.map((j) => j.propertyId)));
  const props = propIds.length
    ? await db
        .select()
        .from(propertiesTable)
        .where(inArray(propertiesTable.id, propIds))
    : [];
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const sorted = jobs
    .filter((j) => j.status !== "cancelled")
    .sort((a, b) => (b.scheduledOn ?? "").localeCompare(a.scheduledOn ?? ""));
  res.json(
    ListPortalJobsResponse.parse(
      sorted.map((j) => ({
        id: j.id,
        jobNo: j.jobNo,
        label: buildJobLabel(j.jobNo, propName.get(j.propertyId), j.unitNo),
        propertyName: propName.get(j.propertyId) ?? null,
        unitNo: j.unitNo ?? null,
        status: j.status ?? null,
      })),
    ),
  );
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
  const labels = await jobLabelMap(
    rows.map((r) => r.jobId).filter((v): v is string => !!v),
  );
  res.json(
    ListPortalPhotosResponse.parse(
      rows.map((r) => ({
        ...ser(r),
        jobLabel: r.jobId ? (labels.get(r.jobId) ?? null) : null,
      })),
    ),
  );
});

router.post("/portal/:token/photos", async (req, res): Promise<void> => {
  const { token } = UploadPortalPhotoParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = UploadPortalPhotoBody.parse(req.body);
  if (body.jobId) {
    const owned = await jobBelongsToCrew(body.jobId, crew.id);
    if (!owned) {
      res.status(400).json({ error: "That job isn't assigned to this crew" });
      return;
    }
  }
  // Tamper-evidence: fingerprint the uploaded file server-side so the original
  // bytes can always be verified later (SHA-256 + size at time of upload).
  let sha256: string | null = null;
  let sizeBytes: number | null = null;
  try {
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(body.storagePath);
    const [buf] = await file.download();
    sha256 = createHash("sha256").update(buf).digest("hex");
    sizeBytes = buf.length;
  } catch (err) {
    logger.warn({ err }, "Could not fingerprint crew photo");
  }
  const [row] = await db
    .insert(crewPhotosTable)
    .values({
      crewId: crew.id,
      jobId: body.jobId ?? null,
      storagePath: body.storagePath,
      takenOn: body.takenOn,
      note: body.note ?? null,
      phase: body.phase ?? null,
      sha256,
      sizeBytes,
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      accuracy: body.accuracy ?? null,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : null,
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

router.post("/portal/:token/agreement", async (req, res): Promise<void> => {
  const { token } = AcceptPortalAgreementParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  // Idempotent: keep the original acceptance timestamp on repeat calls.
  const acceptedAt = crew.agreementAcceptedAt ?? new Date();
  if (!crew.agreementAcceptedAt) {
    await db
      .update(crewsTable)
      .set({ agreementAcceptedAt: acceptedAt })
      .where(eq(crewsTable.id, crew.id));
    await db.insert(notificationsTable).values({
      kind: "crew_agreement",
      priority: "normal",
      entityType: "crew",
      entityId: crew.id,
      title: `${crew.name} accepted the portal agreement`,
      body: null,
    });
  }
  res.json(
    AcceptPortalAgreementResponse.parse({
      accepted: true,
      acceptedAt: acceptedAt.toISOString(),
    }),
  );
});

router.post("/portal/:token/selfie", async (req, res): Promise<void> => {
  const { token } = SetPortalSelfieParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const body = SetPortalSelfieBody.parse(req.body);
  // Verify the uploaded object actually exists before pointing the profile at it.
  try {
    const storage = new ObjectStorageService();
    await storage.getObjectEntityFile(body.storagePath);
  } catch (err) {
    logger.warn({ err }, "Portal selfie object not found");
    res.status(400).json({ error: "Uploaded photo not found — try again" });
    return;
  }
  await db
    .update(crewsTable)
    .set({ selfiePath: body.storagePath })
    .where(eq(crewsTable.id, crew.id));
  res.json(SetPortalSelfieResponse.parse({ selfiePath: body.storagePath }));
});

// Public, read-only live job tracker for property managers (accountability link).
router.get("/track/:token", async (req, res): Promise<void> => {
  const { token } = GetJobTrackerParams.parse(req.params);
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.trackerToken, token))
    .limit(1);
  if (!job) {
    res.status(404).json({ error: "Invalid tracker link" });
    return;
  }
  const [[property], [settings], schedules] = await Promise.all([
    db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, job.propertyId))
      .limit(1),
    db.select().from(businessSettingsTable).limit(1),
    db.select().from(schedulesTable).where(eq(schedulesTable.jobId, job.id)),
  ]);
  const crewIds = Array.from(
    new Set(
      [
        job.crewLeaderId,
        ...schedules.map((s) => s.crewLeaderId),
      ].filter((v): v is string => !!v),
    ),
  );
  const crews = crewIds.length
    ? await db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
    : [];
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const lead = job.crewLeaderId ? crews.find((c) => c.id === job.crewLeaderId) : null;

  const [checkins, photos] = await Promise.all([
    db
      .select()
      .from(crewCheckinsTable)
      .where(eq(crewCheckinsTable.jobId, job.id))
      .orderBy(crewCheckinsTable.createdAt),
    db
      .select()
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.jobId, job.id))
      .orderBy(crewPhotosTable.createdAt),
  ]);

  res.json(
    GetJobTrackerResponse.parse({
      jobNo: job.jobNo,
      description: job.description ?? null,
      category: job.category ?? null,
      status: job.status,
      unitNo: job.unitNo ?? null,
      propertyName: property?.name ?? null,
      propertyAddress: property?.address ?? null,
      crewName: lead?.name ?? null,
      crewTrade: lead?.trade ?? null,
      scheduledOn: job.scheduledOn ?? null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      businessName: settings?.companyName ?? null,
      checkins: checkins.map((c) => ({
        id: c.id,
        kind: c.kind,
        crewName: crewName.get(c.crewId) ?? null,
        lat: c.lat,
        lng: c.lng,
        accuracy: c.accuracy,
        label: c.label,
        note: c.note,
        createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      })),
      photos: photos.map((p) => ({
        id: p.id,
        url: `/api/storage${p.storagePath}`,
        phase: p.phase,
        note: p.note,
        takenOn: p.takenOn,
        capturedAt: p.capturedAt ? p.capturedAt.toISOString() : null,
        createdAt: p.createdAt ? p.createdAt.toISOString() : null,
        sha256: p.sha256,
        crewName: crewName.get(p.crewId) ?? null,
      })),
      workNotes: checkins
        .filter((c) => c.kind === "checkout" && c.note)
        .map((c) => ({
          note: c.note!,
          crewName: crewName.get(c.crewId) ?? null,
          createdAt: c.createdAt ? c.createdAt.toISOString() : null,
        })),
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

class OfferConflictError extends Error {}

router.post(
  "/portal/:token/offers/:offerId/respond",
  async (req, res): Promise<void> => {
    const { token, offerId } = RespondPortalOfferParams.parse(req.params);
    const crew = await crewByToken(token);
    if (!crew) {
      res.status(404).json({ error: "Invalid portal link" });
      return;
    }
    const body = RespondPortalOfferBody.parse(req.body);
    if (body.decision !== "approved" && body.decision !== "declined") {
      res.status(400).json({ error: "Decision must be approved or declined" });
      return;
    }

    let result;
    try {
      result = await db.transaction(async (tx) => {
      const [offer] = await tx
        .select()
        .from(jobBroadcastsTable)
        .where(
          and(
            eq(jobBroadcastsTable.id, offerId),
            eq(jobBroadcastsTable.crewId, crew.id),
          ),
        );
      if (!offer) {
        return { code: 404 as const, error: "Offer not found" };
      }
      if (offer.status !== "pending") {
        return {
          code: 409 as const,
          error: `You already responded to this job (${offer.status}).`,
        };
      }
      const [job] = await tx
        .select()
        .from(jobsTable)
        .where(eq(jobsTable.id, offer.jobId));
      if (!job) {
        return { code: 404 as const, error: "Job no longer exists" };
      }

      const now = new Date();

      if (body.decision === "declined") {
        await tx
          .update(jobBroadcastsTable)
          .set({ status: "declined", respondedAt: now })
          .where(eq(jobBroadcastsTable.id, offer.id));
        return {
          code: 200 as const,
          job,
          status: "declined" as const,
          scheduledOn: null as string | null,
        };
      }

      // Approve: first crew in wins the job.
      if (job.boardStatus === "filled" || job.status === "complete") {
        return {
          code: 409 as const,
          error: "This job has already been filled.",
        };
      }

      const fmtLocal = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const scheduledOn = job.scheduledOn ?? fmtLocal(now);

      // Guarded: only approve an offer that is still pending — an unlist that
      // withdrew or deleted this offer concurrently must not be re-approved.
      // This runs FIRST so a failure returns before any other write happens.
      const approvedRows = await tx
        .update(jobBroadcastsTable)
        .set({ status: "approved", respondedAt: now })
        .where(
          and(
            eq(jobBroadcastsTable.id, offer.id),
            eq(jobBroadcastsTable.status, "pending"),
          ),
        )
        .returning({ id: jobBroadcastsTable.id });
      if (approvedRows.length === 0) {
        return {
          code: 409 as const,
          error: "This job offer is no longer available.",
        };
      }

      // Guarded slot claim: atomically takes one of the crewsNeeded slots.
      // crews_filled only increments while slots remain (crews_filled <
      // crews_needed), and the job flips to "filled" exactly when the last
      // slot is taken. The affected-row check keeps this race-safe under
      // concurrency. If the claim fails we THROW so the whole transaction
      // (including the offer approval above) rolls back atomically.
      const claimed = await tx
        .update(jobsTable)
        .set({
          crewsFilled: sql`${jobsTable.crewsFilled} + 1`,
          boardStatus: sql`CASE WHEN ${jobsTable.crewsFilled} + 1 >= ${jobsTable.crewsNeeded} THEN 'filled' ELSE ${jobsTable.boardStatus} END`,
          crewLeaderId: sql`COALESCE(${jobsTable.crewLeaderId}, ${crew.id})`,
          status: "scheduled",
          scheduledOn,
        })
        .where(
          and(
            eq(jobsTable.id, job.id),
            lt(jobsTable.crewsFilled, jobsTable.crewsNeeded),
            ne(jobsTable.boardStatus, "filled"),
            ne(jobsTable.boardStatus, "removed"),
            ne(jobsTable.status, "complete"),
          ),
        )
        .returning({
          id: jobsTable.id,
          crewsFilled: jobsTable.crewsFilled,
          crewsNeeded: jobsTable.crewsNeeded,
        });
      if (claimed.length === 0) {
        throw new OfferConflictError("This job is no longer available.");
      }
      const slots = claimed[0]!;

      await tx.insert(schedulesTable).values({
        jobId: job.id,
        scheduledOn,
        crewLeaderId: crew.id,
      });

      return {
        code: 200 as const,
        job,
        status: "approved" as const,
        scheduledOn,
        crewsFilled: slots.crewsFilled,
        crewsNeeded: slots.crewsNeeded,
      };
      });
    } catch (err) {
      if (err instanceof OfferConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      throw err;
    }

    if (result.code !== 200) {
      res.status(result.code).json({ error: result.error });
      return;
    }

    const jobLabel = [result.job.jobNo, result.job.category]
      .filter(Boolean)
      .join(" · ");
    await db.insert(notificationsTable).values({
      kind: result.status === "approved" ? "job_filled" : "job_declined",
      priority: result.status === "approved" ? "urgent" : "normal",
      entityType: "job",
      entityId: result.job.id,
      title:
        result.status === "approved"
          ? `${crew.name} accepted ${jobLabel}`
          : `${crew.name} declined ${jobLabel}`,
      body:
        result.status === "approved"
          ? result.crewsFilled != null &&
            result.crewsNeeded != null &&
            result.crewsFilled < result.crewsNeeded
            ? `Scheduled for ${result.scheduledOn}. ${result.crewsFilled} of ${result.crewsNeeded} crew spots filled.`
            : `Scheduled for ${result.scheduledOn}. Job is now filled.`
          : "You can re-broadcast this job from the job board.",
    });

    res.json(
      RespondPortalOfferResponse.parse({
        status: result.status,
        scheduledOn: result.scheduledOn,
        message:
          result.status === "approved"
            ? `You're confirmed for this job on ${result.scheduledOn}. It's on your schedule.`
            : "You declined this job.",
      }),
    );
  },
);

router.get("/portal/:token/wings", async (req, res): Promise<void> => {
  const crew = await crewByToken(req.params.token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const [member] = await db
    .select()
    .from(wingMembersTable)
    .where(eq(wingMembersTable.crewId, crew.id));
  const crews = await db
    .select({ id: crewsTable.id, name: crewsTable.name })
    .from(crewsTable);
  const nameOf = new Map(crews.map((c) => [c.id, c.name]));
  const [recruits, overrides, snapshots, accounts] = await Promise.all([
    db
      .select()
      .from(wingMembersTable)
      .where(eq(wingMembersTable.sponsorCrewId, crew.id)),
    db
      .select()
      .from(wingOverridesTable)
      .where(eq(wingOverridesTable.sponsorCrewId, crew.id))
      .orderBy(desc(wingOverridesTable.createdAt)),
    db
      .select()
      .from(wingScoreSnapshotsTable)
      .where(eq(wingScoreSnapshotsTable.crewId, crew.id))
      .orderBy(desc(wingScoreSnapshotsTable.createdAt))
      .limit(1),
    db
      .select()
      .from(wingReserveAccountsTable)
      .where(eq(wingReserveAccountsTable.crewId, crew.id)),
  ]);
  const jobIds = [...new Set(overrides.map((o) => o.jobId))];
  const overrideJobs = jobIds.length
    ? await db
        .select({ id: jobsTable.id, jobNo: jobsTable.jobNo })
        .from(jobsTable)
        .where(inArray(jobsTable.id, jobIds))
    : [];
  const jobNo = new Map(overrideJobs.map((j) => [j.id, j.jobNo]));
  const account = accounts[0];
  res.json({
    haloScore: member?.haloScore ?? 85,
    tier: member?.tier ?? "TRAINING",
    membershipStatus: member?.membershipStatus ?? "PENDING_APPROVAL",
    founderStatus: member?.founderStatus ?? "NONE",
    founderNumber: member?.founderNumber ?? null,
    scoreConfidence: member?.scoreConfidence ?? 0,
    scoreUpdatedAt: member?.scoreUpdatedAt
      ? member.scoreUpdatedAt.toISOString()
      : null,
    scoreReasons: (snapshots[0]?.reasons as string[] | null) ?? null,
    sponsorName: member?.sponsorCrewId
      ? (nameOf.get(member.sponsorCrewId) ?? null)
      : null,
    recruits: recruits.map((r) => ({
      crewName: nameOf.get(r.crewId) ?? "Crew",
      tier: r.tier,
      haloScore: r.haloScore,
    })),
    overrides: overrides.map((o) => ({
      id: o.id,
      jobId: o.jobId,
      jobNo: jobNo.get(o.jobId) ?? null,
      sponsorCrewId: o.sponsorCrewId,
      sponsorName: nameOf.get(o.sponsorCrewId) ?? null,
      recruitCrewId: o.recruitCrewId,
      recruitName: nameOf.get(o.recruitCrewId) ?? null,
      allocatedGrossProfit: o.allocatedGrossProfit,
      baseRate: o.baseRate,
      qualityMultiplier: o.qualityMultiplier,
      grossOverride: o.grossOverride,
      immediateAmount: o.immediateAmount,
      reserveAmount: o.reserveAmount,
      reserveBonus: o.reserveBonus,
      reserveDebit: o.reserveDebit,
      status: o.status,
      immediateStatus: o.immediateStatus,
      qualityWindowEndsAt: o.qualityWindowEndsAt
        ? o.qualityWindowEndsAt.toISOString()
        : null,
      reserveReleasedAt: o.reserveReleasedAt
        ? o.reserveReleasedAt.toISOString()
        : null,
      createdAt: o.createdAt.toISOString(),
    })),
    reserve: {
      held: account?.heldBalance ?? 0,
      released: account?.releasedBalance ?? 0,
      debited: account?.debitedBalance ?? 0,
    },
  });
});

export default router;
