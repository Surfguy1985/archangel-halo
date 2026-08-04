import { limits } from "../lib/rateLimit";
import { Router, type IRouter } from "express";
import { and, count, desc, eq, gt, gte, inArray, isNull, lt, lte, ne, notInArray, sql } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewMessagesTable,
  crewCheckinsTable,
  crewTrackPointsTable,
  crewDocumentsTable,
  crewPhotosTable,
  crewPacketsTable,
  crewInvoicesTable,
  crewInvoiceItemsTable,
  schedulesTable,
  crewRoutePlansTable,
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
  crewBankAccountsTable,
  emergencyPingsTable,
  emergencyPingTargetsTable,
  crewPayHoldsTable,
  crewPaymentsTable,
  crewPayoutsTable,
  crewDispatchAssignmentsTable,
} from "@workspace/db";
import { seedChecklist, jobShortLabel, isUniqueViolation } from "./dispatchBoard";
import {
  GetPortalDispatchParams,
  GetPortalDispatchResponse,
  GetPortalOfficeViewParams,
  GetPortalOfficeViewResponse,
  CheckPortalDispatchItemParams,
  CheckPortalDispatchItemBody,
  CheckPortalDispatchItemResponse,
  RespondPortalDispatchMoveParams,
  RespondPortalDispatchMoveBody,
  RespondPortalDispatchMoveResponse,
} from "@workspace/api-zod";
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
  CreatePortalTrackPointParams,
  CreatePortalTrackPointBody,
  CreatePortalTrackPointResponse,
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
  SubmitPortalBankBody,
  CommitPortalEmergencyResponse,
  GetPortalEarningsResponse,
  GetPortalBankResponse,
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
import { recomputeJobFinancials } from "../lib/jobFinance";
import { emergencySettledKeys, outstandingHoldAmount } from "../lib/emergencySettlement";
import { ser } from "../lib/serialize";
import { buildJobLabel, jobLabelMap } from "../lib/jobLabels";
import { ensurePropertiesGeocoded } from "../lib/geocode";

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

  const [offers, sched, events, messages, packets, documents, emergency, approvals] =
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
      db
        .select({ n: count() })
        .from(emergencyPingTargetsTable)
        .where(
          and(
            eq(emergencyPingTargetsTable.crewId, crew.id),
            eq(emergencyPingTargetsTable.status, "pending"),
            gt(emergencyPingTargetsTable.sentAt, since("emergency")),
          ),
        ),
      // Member moves waiting on this foreman's approval (non-foremen get 0).
      db
        .select({ n: count() })
        .from(crewDispatchAssignmentsTable)
        .where(
          and(
            eq(crewDispatchAssignmentsTable.status, "pending_move"),
            gt(crewDispatchAssignmentsTable.moveRequestedAt, since("approvals")),
            inArray(
              crewDispatchAssignmentsTable.memberId,
              db
                .select({ id: crewsTable.id })
                .from(crewsTable)
                .where(and(eq(crewsTable.leaderId, crew.id), ne(crewsTable.id, crew.id))),
            ),
          ),
        ),
    ]);

  return {
    offers: offers[0]?.n ?? 0,
    schedule: (sched[0]?.n ?? 0) + (events[0]?.n ?? 0),
    messages: messages[0]?.n ?? 0,
    packets: packets[0]?.n ?? 0,
    documents: documents[0]?.n ?? 0,
    emergency: emergency[0]?.n ?? 0,
    approvals: approvals[0]?.n ?? 0,
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
  // Time windows are free text ("9:00 AM", "13:30"); parse to minutes so the
  // fallback order is chronological, unparseable/missing last.
  const windowMinutes = (w: string | null): number => {
    if (!w) return Number.MAX_SAFE_INTEGER;
    const m = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(w.trim());
    if (!m) return Number.MAX_SAFE_INTEGER;
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = m[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return h * 60 + min;
  };
  // Apply the office's saved route order within each day: planned stops first
  // (in saved order), everything else after by time.
  const planRows = await db
    .select()
    .from(crewRoutePlansTable)
    .where(
      and(
        eq(crewRoutePlansTable.crewId, crew.id),
        gte(crewRoutePlansTable.day, weekStart),
        lte(crewRoutePlansTable.day, weekEnd),
      ),
    );
  const orderByDay = new Map<string, Map<string, number>>();
  for (const p of planRows) {
    const keys = Array.isArray(p.stopKeys) ? (p.stopKeys as string[]) : [];
    orderByDay.set(p.day, new Map(keys.map((k, i) => [k, i])));
  }
  const planIdx = (item: { id: string; scheduledOn: string | null }) => {
    const m = item.scheduledOn ? orderByDay.get(item.scheduledOn) : undefined;
    return m?.get(item.id) ?? Number.MAX_SAFE_INTEGER;
  };
  schedule.sort((a, b) => {
    const byDay = (a.scheduledOn ?? "").localeCompare(b.scheduledOn ?? "");
    if (byDay !== 0) return byDay;
    const byPlan = planIdx(a) - planIdx(b);
    if (byPlan !== 0) return byPlan;
    return windowMinutes(a.windowStart) - windowMinutes(b.windowStart);
  });

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

  // Live emergency pings aimed at this crew: pending ones they can commit to,
  // plus their own committed one until the job completes.
  const emergencyTargetRows = await db
    .select()
    .from(emergencyPingTargetsTable)
    .where(
      and(
        eq(emergencyPingTargetsTable.crewId, crew.id),
        inArray(emergencyPingTargetsTable.status, [
          "pending",
          "committed",
          "missed",
          "expired",
        ]),
      ),
    )
    .orderBy(desc(emergencyPingTargetsTable.sentAt));
  const emergencyPingIds = [...new Set(emergencyTargetRows.map((t) => t.pingId))];
  const emergencyPings = emergencyPingIds.length
    ? await db
        .select()
        .from(emergencyPingsTable)
        .where(inArray(emergencyPingsTable.id, emergencyPingIds))
    : [];
  const pingById = new Map(emergencyPings.map((p) => [p.id, p]));
  const emergencyOffers = emergencyTargetRows
    .filter((t) => {
      const ping = pingById.get(t.pingId);
      if (!ping) return false;
      // Manual cancels vanish from the portal; expired pings stay visible
      // briefly as "expired" so the crew knows why the offer is gone.
      if (ping.status === "cancelled" && !ping.expiredAt) return false;
      const job = jobsById.get(ping.jobId);
      if (!job) return false;
      // Drop stale resolved cards once the job is done.
      if (job.status === "complete" || job.clearedAt) return false;
      return true;
    })
    .slice(0, 10)
    .map((t) => {
      const ping = pingById.get(t.pingId)!;
      const job = jobsById.get(ping.jobId)!;
      return {
        id: t.id,
        pingId: ping.id,
        jobId: ping.jobId,
        status: t.status,
        pingStatus: ping.expiredAt ? "expired" : ping.status,
        filledByYou: ping.status === "filled" && ping.filledByCrewId === crew.id,
        payAmount: ping.payAmount,
        bonusAmount: ping.bonusAmount,
        neededBy: ping.neededBy,
        expiresAt: ping.expiresAt ? ping.expiresAt.toISOString() : null,
        note: ping.note,
        jobNo: job.jobNo,
        category: job.category,
        description: job.description,
        unitNo: job.unitNo,
        ...propFields(job.propertyId),
        sentAt: t.sentAt.toISOString(),
      };
    });

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
        isLeader: crew.isLeader ?? null,
        leaderId: crew.leaderId ?? null,
        leaderName: crew.leaderId
          ? ((await db.select().from(crewsTable).where(eq(crewsTable.id, crew.leaderId)))[0]
              ?.name ?? null)
          : null,
      },
      schedule,
      offers,
      emergencyOffers,
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

  const pdfPath = body.pdfStoragePath?.trim() || null;
  const pdfName =
    body.pdfName?.trim() ||
    `invoice-${body.invoiceNo?.trim() || new Date().toISOString().slice(0, 10)}.pdf`;

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
    if (pdfPath) {
      await tx.insert(crewDocumentsTable).values({
        crewId: crew.id,
        direction: "from_crew",
        name: pdfName,
        storagePath: pdfPath,
        contentType: "application/pdf",
        note: `Invoice${inv!.invoiceNo ? ` #${inv!.invoiceNo}` : ""} — ${body.propertyAddress.trim()}`,
      });
      await tx.insert(crewMessagesTable).values({
        crewId: crew.id,
        sender: "crew",
        body: `Sent invoice${inv!.invoiceNo ? ` #${inv!.invoiceNo}` : ""} for ${body.propertyAddress.trim()} — $${subtotal.toFixed(2)}`,
        attachmentName: pdfName,
        attachmentPath: pdfPath,
      });
    }
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

    const pdfPath = body.pdfStoragePath?.trim() || null;
    const pdfName =
      body.pdfName?.trim() ||
      `invoice-${body.invoiceNo?.trim() || new Date().toISOString().slice(0, 10)}.pdf`;

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
      if (pdfPath) {
        await tx.insert(crewDocumentsTable).values({
          crewId: crew.id,
          direction: "from_crew",
          name: pdfName,
          storagePath: pdfPath,
          contentType: "application/pdf",
          note: `Corrected invoice${inv.invoiceNo ? ` #${inv.invoiceNo}` : ""} — ${body.propertyAddress.trim()}`,
        });
        await tx.insert(crewMessagesTable).values({
          crewId: crew.id,
          sender: "crew",
          body: `Resubmitted corrected invoice${inv.invoiceNo ? ` #${inv.invoiceNo}` : ""} for ${body.propertyAddress.trim()} — $${subtotal.toFixed(2)}`,
          attachmentName: pdfName,
          attachmentPath: pdfPath,
        });
      }
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
  // Team members message through their foreman, not the office directly.
  if (crew.leaderId && crew.leaderId !== crew.id) {
    const [foreman] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, crew.leaderId));
    res.status(403).json({
      error: `Messages go through your foreman${foreman ? ` (${foreman.name})` : ""} — talk to them and they'll reach the office.`,
    });
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
  if (kind === "checkout") {
    // Checkout requires after photos. Gate on the job being checked out —
    // explicit jobId, or the job from this crew's latest open check-in.
    let gateJobId = body.jobId ?? null;
    if (!gateJobId) {
      const [lastIn] = await db
        .select()
        .from(crewCheckinsTable)
        .where(eq(crewCheckinsTable.crewId, crew.id))
        .orderBy(desc(crewCheckinsTable.createdAt))
        .limit(1);
      if (lastIn && lastIn.kind !== "checkout") gateJobId = lastIn.jobId;
    }
    if (gateJobId) {
      const [{ n }] = await db
        .select({ n: count() })
        .from(crewPhotosTable)
        .where(
          and(
            eq(crewPhotosTable.jobId, gateJobId),
            eq(crewPhotosTable.crewId, crew.id),
            eq(crewPhotosTable.phase, "after"),
          ),
        );
      if (Number(n) === 0) {
        res.status(409).json({
          error: "Add your after photos before checking out",
          code: "after_photos_required",
        });
        return;
      }
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

// LOCAL date parts, never UTC — see replit.md date handling rules.
function localDayStrOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}
function localDayStr(): string {
  return localDayStrOf(new Date());
}

// 30-second GPS breadcrumb ping while checked in. 409 tells the client to
// stop pinging (not checked in / already checked out).
router.post(
  "/portal/:token/track-points",
  limits.trackPoint,
  async (req, res): Promise<void> => {
    const { token } = CreatePortalTrackPointParams.parse(req.params);
    const crew = await crewByToken(token);
    if (!crew) {
      res.status(404).json({ error: "Invalid portal link" });
      return;
    }
    const body = CreatePortalTrackPointBody.parse(req.body);
    const [last] = await db
      .select()
      .from(crewCheckinsTable)
      .where(eq(crewCheckinsTable.crewId, crew.id))
      .orderBy(desc(crewCheckinsTable.createdAt))
      .limit(1);
    const today = localDayStr();
    const lastDay = last?.createdAt ? localDayStrOf(new Date(last.createdAt)) : null;
    if (!last || last.kind === "checkout" || lastDay !== today) {
      res.status(409).json({ error: "Not checked in" });
      return;
    }
    // Breadcrumbs are attributed ONLY to the job of the open check-in — a
    // client-supplied jobId that disagrees would put the crew's real location
    // on the wrong job's (client-visible) map.
    if (body.jobId && last.jobId && body.jobId !== last.jobId) {
      res.status(409).json({ error: "Checked in on a different job" });
      return;
    }
    await db.insert(crewTrackPointsTable).values({
      crewId: crew.id,
      jobId: last.jobId ?? null,
      lat: body.lat,
      lng: body.lng,
      accuracy: body.accuracy ?? null,
    });
    res.status(201).json(CreatePortalTrackPointResponse.parse({ ok: true }));
  },
);

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

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const [checkins, photos, trailPoints] = await Promise.all([
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
    db
      .select()
      .from(crewTrackPointsTable)
      .where(
        and(
          eq(crewTrackPointsTable.jobId, job.id),
          gte(crewTrackPointsTable.createdAt, dayStart),
        ),
      )
      .orderBy(crewTrackPointsTable.createdAt)
      .limit(3000),
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
      trail: trailPoints.map((p) => ({
        lat: p.lat,
        lng: p.lng,
        at: p.createdAt.toISOString(),
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

import { bankStatusPayload } from "./payhub";

router.get("/portal/:token/bank", async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const [bank] = await db
    .select()
    .from(crewBankAccountsTable)
    .where(eq(crewBankAccountsTable.crewId, crew.id))
    .limit(1);
  res.json(GetPortalBankResponse.parse(bankStatusPayload(bank)));
});

router.post("/portal/:token/bank", limits.bank, async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const parsed = SubmitPortalBankBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  if (!/^\d{9}$/.test(body.routingNumber)) {
    res.status(400).json({ error: "Routing number must be 9 digits" });
    return;
  }
  if (!/^\d{4,17}$/.test(body.accountNumber)) {
    res.status(400).json({ error: "Account number must be 4-17 digits" });
    return;
  }
  // NOTE: Cybrid account verification drops in here — instant-verify stub.
  const values = {
    crewId: crew.id,
    accountKind: body.accountKind,
    holderName: body.holderName,
    businessName: body.businessName ?? null,
    bankName: body.bankName ?? null,
    accountType: body.accountType,
    routingNumber: body.routingNumber,
    accountNumber: body.accountNumber,
    status: "verified",
    verifiedAt: new Date(),
  };
  const [bank] = await db
    .insert(crewBankAccountsTable)
    .values(values)
    .onConflictDoUpdate({
      target: crewBankAccountsTable.crewId,
      set: values,
    })
    .returning();
  await db.insert(notificationsTable).values({
    kind: "crew_bank_connected",
    priority: "normal",
    entityType: "crew",
    entityId: crew.id,
    title: `${crew.name} connected a bank account`,
    body: `${body.accountKind === "business" ? "Business" : "Personal"} ${body.accountType} ••••${body.accountNumber.slice(-4)} — verified for instant ACH payouts`,
  });
  res.json(GetPortalBankResponse.parse(bankStatusPayload(bank))); 
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
          crewVacatedAt: null,
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

// One-tap emergency commit — guarded first-wins claim mirroring the job-board
// fill: the ping flip (open -> filled) is the single-winner gate; losers 409.
// On commit the crew is assigned and pay + bonus lands in their visual bank
// as ON HOLD.
router.post(
  "/portal/:token/emergency/:targetId/commit",
  async (req, res): Promise<void> => {
    const token = String(req.params.token);
    const targetId = String(req.params.targetId);
    const crew = await crewByToken(token);
    if (!crew) {
      res.status(404).json({ error: "Invalid portal link" });
      return;
    }

    let result;
    try {
      result = await db.transaction(async (tx) => {
        const [target] = await tx
          .select()
          .from(emergencyPingTargetsTable)
          .where(
            and(
              eq(emergencyPingTargetsTable.id, targetId),
              eq(emergencyPingTargetsTable.crewId, crew.id),
            ),
          );
        if (!target) return { code: 404 as const, error: "Ping not found" };
        if (target.status !== "pending") {
          return {
            code: 409 as const,
            error: `You already responded to this emergency (${target.status}).`,
          };
        }
        const [ping] = await tx
          .select()
          .from(emergencyPingsTable)
          .where(eq(emergencyPingsTable.id, target.pingId));
        if (!ping) return { code: 404 as const, error: "Ping no longer exists" };
        const [job] = await tx
          .select()
          .from(jobsTable)
          .where(eq(jobsTable.id, ping.jobId));
        if (!job) return { code: 404 as const, error: "Job no longer exists" };

        const now = new Date();

        // Deadline guard: a stale offer can't be accepted past its expiry —
        // the sweep will flip it, but this check closes the gap between
        // deadline and the next sweep tick.
        if (ping.expiresAt && ping.expiresAt.getTime() <= now.getTime()) {
          return {
            code: 409 as const,
            error: "This emergency offer has expired and can no longer be accepted.",
          };
        }

        // FIRST-WINS GATE: guarded UPDATE + row-count. Only one crew can flip
        // the ping from open to filled; everyone else gets "filled".
        const won = await tx
          .update(emergencyPingsTable)
          .set({ status: "filled", filledByCrewId: crew.id, filledAt: now })
          .where(
            and(
              eq(emergencyPingsTable.id, ping.id),
              eq(emergencyPingsTable.status, "open"),
            ),
          )
          .returning({ id: emergencyPingsTable.id });
        if (won.length === 0) {
          return {
            code: 409 as const,
            error: "This emergency was already filled by another crew.",
          };
        }

        await tx
          .update(emergencyPingTargetsTable)
          .set({ status: "committed", respondedAt: now })
          .where(eq(emergencyPingTargetsTable.id, target.id));
        // Everyone else who hadn't answered sees "filled".
        await tx
          .update(emergencyPingTargetsTable)
          .set({ status: "missed", respondedAt: now })
          .where(
            and(
              eq(emergencyPingTargetsTable.pingId, ping.id),
              eq(emergencyPingTargetsTable.status, "pending"),
            ),
          );

        const fmtLocal = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const scheduledOn = fmtLocal(now);

        // Emergency assignment takes the job: guarded so a completed/cleared
        // job can't be claimed.
        const claimed = await tx
          .update(jobsTable)
          .set({
            crewLeaderId: crew.id,
            crewVacatedAt: null,
            status: "scheduled",
            scheduledOn,
            boardStatus: "filled",
            sameDayPay: true,
            emergencyBonus: ping.bonusAmount,
          })
          .where(
            and(
              eq(jobsTable.id, job.id),
              notInArray(jobsTable.status, ["complete", "paid", "cancelled"]),
              isNull(jobsTable.clearedAt),
            ),
          )
          .returning({ id: jobsTable.id });
        if (claimed.length === 0) {
          throw new OfferConflictError("This job is no longer available.");
        }

        await tx.insert(schedulesTable).values({
          jobId: job.id,
          scheduledOn,
          crewLeaderId: crew.id,
        });

        // Visual-bank hold: pay + bonus lands as HELD immediately. The
        // partial unique index (crew,job WHERE HELD) backs this against a
        // double-commit race.
        const holdAmount =
          Math.round((ping.payAmount + ping.bonusAmount) * 100) / 100;
        await tx.insert(crewPayHoldsTable).values({
          crewId: crew.id,
          jobId: job.id,
          pingId: ping.id,
          amount: holdAmount,
          bonusAmount: ping.bonusAmount,
          status: "HELD",
          note: "Emergency job — pay + bonus held until close-out approval",
        });

        return {
          code: 200 as const,
          job,
          holdAmount,
          scheduledOn,
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

    // The bonus is now a job cost — keep stored margins in sync.
    await recomputeJobFinancials(result.job.id);

    const jobLabel = [result.job.jobNo, result.job.category]
      .filter(Boolean)
      .join(" · ");
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: result.job.id,
      kind: "note",
      body: `${crew.name} committed to the emergency — $${result.holdAmount.toFixed(2)} (pay + bonus) now ON HOLD, releases at close-out`,
    });
    await db.insert(notificationsTable).values({
      kind: "emergency_committed",
      priority: "urgent",
      entityType: "job",
      entityId: result.job.id,
      title: `${crew.name} committed to emergency ${jobLabel}`,
      body: `$${result.holdAmount.toFixed(2)} held for same-day payout on approval. Scheduled today.`,
    });

    res.json(
      CommitPortalEmergencyResponse.parse({
        status: "committed",
        holdAmount: result.holdAmount,
        scheduledOn: result.scheduledOn,
        message: `You're committed. $${result.holdAmount.toFixed(2)} is on hold in your bank and releases the moment the job is complete and approved — paid same day.`,
      }),
    );
  },
);

// The crew's visual bank: held, payable, and paid amounts per emergency hold.
router.get("/portal/:token/earnings", async (req, res): Promise<void> => {
  const token = String(req.params.token);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const [holds, payouts, payments, jobs] = await Promise.all([
    db
      .select()
      .from(crewPayHoldsTable)
      .where(eq(crewPayHoldsTable.crewId, crew.id))
      .orderBy(desc(crewPayHoldsTable.heldAt)),
    db
      .select()
      .from(crewPayoutsTable)
      .where(
        and(
          eq(crewPayoutsTable.crewId, crew.id),
          eq(crewPayoutsTable.status, "paid"),
        ),
      ),
    db
      .select()
      .from(crewPaymentsTable)
      .where(eq(crewPaymentsTable.crewId, crew.id)),
    db.select().from(jobsTable),
  ]);
  const jobsById2 = new Map(jobs.map((j) => [j.id, j]));
  // Shared settlement predicate: paid payout or the canonical emergency
  // same-day payment — base-rate crew payments must NOT flip a hold to paid.
  const settled = emergencySettledKeys(payouts, payments);

  let heldTotal = 0;
  let payableTotal = 0;
  let paidTotal = 0;
  const rows = holds.map((h) => {
    const job = jobsById2.get(h.jobId);
    const paid = h.status === "RELEASED" && settled.has(`${h.crewId}|${h.jobId}`);
    // Shared outstanding: prior completed base payments reduce what's
    // still owed on a released hold (same rule as Today + payout queue).
    const owed = outstandingHoldAmount(h.amount, h.crewId, h.jobId, payments);
    let state: "held" | "payable" | "paid" | "cancelled";
    if (h.status === "HELD") {
      state = "held";
      heldTotal += h.amount;
    } else if (h.status === "CANCELLED") {
      state = "cancelled";
    } else if (paid || owed <= 0) {
      state = "paid";
      paidTotal += h.amount;
    } else {
      state = "payable";
      payableTotal += owed;
    }
    return {
      id: h.id,
      jobId: h.jobId,
      jobLabel: job
        ? [job.jobNo, job.category].filter(Boolean).join(" · ")
        : null,
      amount: h.amount,
      bonusAmount: h.bonusAmount,
      state,
      sameDayPay: true,
      heldAt: h.heldAt.toISOString(),
      releasedAt: h.releasedAt ? h.releasedAt.toISOString() : null,
    };
  });

  res.json(
    GetPortalEarningsResponse.parse({
      heldTotal: Math.round(heldTotal * 100) / 100,
      payableTotal: Math.round(payableTotal * 100) / 100,
      paidTotal: Math.round(paidTotal * 100) / 100,
      holds: rows,
    }),
  );
});

router.get("/portal/:token/wings", async (req, res): Promise<void> => {
  const crew = await crewByToken(req.params.token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  if (crew.wingsExcluded === true) {
    // Excluded crews aren't in the program — the portal shows its
    // "not in the program yet" fallback on 404.
    res.status(404).json({ error: "Not enrolled in the Wings Program" });
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
  // ---- Wings Program (quarterly profit share) — simple, deterministic math
  // straight from the printed program sheet:
  //   Wings = (role base + founder bonus) × tenure multiplier × score multiplier
  const haloScore = member?.haloScore ?? 85;
  const ROLE_WINGS: Record<string, number> = {
    crew: 10,
    lead: 15,
    foreman: 25,
    superintendent: 35,
  };
  const roleKey =
    crew.role && ROLE_WINGS[crew.role] !== undefined
      ? crew.role
      : crew.isLeader
        ? "foreman"
        : "crew";
  const baseWings = ROLE_WINGS[roleKey];
  const founderBonus =
    member && member.founderStatus && member.founderStatus !== "NONE" ? 15 : 0;
  let years: number | null = null; // exact — round only for display
  if (crew.hireDate) {
    const [y, m, d] = crew.hireDate.split("-").map(Number);
    years =
      (Date.now() - new Date(y, m - 1, d).getTime()) /
      (365.25 * 24 * 3600 * 1000);
  }
  // Tenure: under 1 yr not eligible; missing start date defaults to ×1.00 so
  // nobody is zeroed out by unfinished office data — flagged as a blocker note.
  const yearsMultiplier =
    years === null
      ? 1
      : years < 1
        ? 0
        : years < 2
          ? 1
          : years < 4
            ? 1.15
            : years < 7
              ? 1.3
              : 1.5;
  const scoreMultiplier =
    haloScore >= 95
      ? 1.3
      : haloScore >= 90
        ? 1.15
        : haloScore >= 80
          ? 1
          : haloScore >= 70
            ? 0.8
            : haloScore >= 60
              ? 0.5
              : 0;
  const blockers: string[] = [];
  if (years !== null && years < 1) blockers.push("under_one_year");
  if (haloScore < 60) blockers.push("score_under_60");
  if (years === null) blockers.push("start_date_missing");
  const wings =
    Math.round((baseWings + founderBonus) * yearsMultiplier * scoreMultiplier * 10) /
    10;
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
    points: (snapshots[0]?.points as Record<string, number> | null) ?? null,
    program: {
      roleKey,
      baseWings,
      founderBonus,
      years: years === null ? null : Math.round(years * 10) / 10,
      yearsMultiplier,
      scoreMultiplier,
      wings,
      eligible: blockers.filter((b) => b !== "start_date_missing").length === 0,
      blockers,
      hireDateSet: years !== null,
    },
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

// ---------- Member dispatch (today's per-member job assignments) ----------

type DispatchChecklistItem = { id: string; text: string; done: boolean };

function readDispatchChecklist(raw: unknown): DispatchChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (i): i is DispatchChecklistItem =>
      !!i && typeof i === "object" && typeof (i as DispatchChecklistItem).text === "string",
  );
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function serPortalDispatchAssignments(
  rows: (typeof crewDispatchAssignmentsTable.$inferSelect)[],
) {
  const jobIds = [
    ...new Set(rows.flatMap((r) => [r.jobId, ...(r.pendingJobId ? [r.pendingJobId] : [])])),
  ];
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const propIds = [...new Set(jobs.map((j) => j.propertyId))];
  const props = propIds.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propIds))
    : [];
  const propById = new Map(props.map((p) => [p.id, p]));
  return rows.map((r) => {
    const job = jobById.get(r.jobId);
    const prop = job ? propById.get(job.propertyId) : undefined;
    return {
      id: r.id,
      day: r.day,
      jobId: r.jobId,
      jobNo: job?.jobNo ?? null,
      description: job?.description ?? null,
      propertyName: prop?.name ?? null,
      propertyAddress: prop?.address ?? null,
      unitNo: job?.unitNo ?? null,
      status: r.status,
      checklist: readDispatchChecklist(r.checklist),
      pendingJobLabel: jobShortLabel(r.pendingJobId ? jobById.get(r.pendingJobId) : null),
    };
  });
}

router.get("/portal/:token/dispatch", async (req, res): Promise<void> => {
  const { token } = GetPortalDispatchParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const day = localToday();
  const mine = await db
    .select()
    .from(crewDispatchAssignmentsTable)
    .where(
      and(
        eq(crewDispatchAssignmentsTable.memberId, crew.id),
        eq(crewDispatchAssignmentsTable.day, day),
      ),
    );
  const assignments = await serPortalDispatchAssignments(mine);

  // Foremen also see their team's assignments and any pending moves to decide.
  let team: unknown = null;
  const members = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.leaderId, crew.id));
  const realMembers = members.filter((m) => m.id !== crew.id);
  if (crew.isLeader && realMembers.length > 0) {
    const memberIds = realMembers.map((m) => m.id);
    const teamRows = await db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(
        and(
          inArray(crewDispatchAssignmentsTable.memberId, memberIds),
          eq(crewDispatchAssignmentsTable.day, day),
        ),
      );
    const serialized = await serPortalDispatchAssignments(teamRows);
    const serById = new Map(serialized.map((s) => [s.id, s]));
    const memberById = new Map(realMembers.map((m) => [m.id, m]));
    team = {
      members: realMembers.map((m) => ({
        id: m.id,
        name: m.name,
        selfiePath: m.selfiePath ?? null,
        assignments: teamRows
          .filter((r) => r.memberId === m.id)
          .map((r) => serById.get(r.id)!),
      })),
      pendingMoves: teamRows
        .filter((r) => r.status === "pending_move" && r.pendingJobId)
        .map((r) => {
          const s = serById.get(r.id)!;
          return {
            assignmentId: r.id,
            memberId: r.memberId,
            memberName: memberById.get(r.memberId)?.name ?? "Crew member",
            fromJobLabel: s.jobNo,
            toJobLabel: s.pendingJobLabel,
            requestedAt: (r.moveRequestedAt ?? r.updatedAt).toISOString(),
          };
        }),
    };
  }
  res.json(GetPortalDispatchResponse.parse({ day, assignments, team }));
});

// Read-only office view for crews with an access grant. Grants live on the
// crew row and are re-evaluated here on every read; the link itself carries
// no permissions and money/client data is never included.
router.get("/portal/:token/office-view", async (req, res): Promise<void> => {
  const { token } = GetPortalOfficeViewParams.parse(req.params);
  const crew = await crewByToken(token);
  if (!crew) {
    res.status(404).json({ error: "Invalid portal link" });
    return;
  }
  const grant = crew.accessGrants as {
    features?: string[];
    propertyScope?: "all" | "selected";
    propertyIds?: string[];
    jobScope?: "all" | "selected";
    jobIds?: string[];
  } | null;
  const features = (grant?.features ?? []).filter((f) =>
    ["schedule", "dispatch", "jobs", "properties"].includes(f),
  );
  type OfficeView = ReturnType<typeof GetPortalOfficeViewResponse.parse>;
  const empty: OfficeView = {
    enabled: false,
    features: [],
    accessSummary: "",
    properties: [],
    jobs: [],
    schedule: [],
    dispatch: [],
  };
  if (!grant || features.length === 0) {
    res.json(GetPortalOfficeViewResponse.parse(empty));
    return;
  }

  const allProps = await db.select().from(propertiesTable);
  const propScope = grant.propertyScope === "selected" ? new Set(grant.propertyIds ?? []) : null;
  const scopedProps = propScope ? allProps.filter((p) => propScope.has(p.id)) : allProps;
  const scopedPropIds = new Set(scopedProps.map((p) => p.id));
  const propName = new Map(allProps.map((p) => [p.id, p.name]));

  const allJobs = await db.select().from(jobsTable);
  const jobScope = grant.jobScope === "selected" ? new Set(grant.jobIds ?? []) : null;
  const scopedJobs = allJobs.filter(
    (j) => scopedPropIds.has(j.propertyId) && (!jobScope || jobScope.has(j.id)),
  );
  const scopedJobIds = new Set(scopedJobs.map((j) => j.id));
  const jobById = new Map(allJobs.map((j) => [j.id, j]));
  const crews = await db.select().from(crewsTable);
  const crewName = new Map(crews.map((c) => [c.id, c.name]));

  const out: typeof empty & { enabled: boolean } = {
    ...empty,
    enabled: true,
    features,
  };

  const featLabels: Record<string, string> = {
    schedule: "Schedule",
    dispatch: "Dispatch",
    jobs: "Jobs",
    properties: "Properties",
  };
  out.accessSummary = [
    features.map((f) => featLabels[f] ?? f).join(", "),
    propScope ? `${scopedProps.length} propert${scopedProps.length === 1 ? "y" : "ies"}` : "all properties",
    jobScope ? `${scopedJobs.length} job${scopedJobs.length === 1 ? "" : "s"}` : "all jobs",
  ].join(" · ");

  if (features.includes("properties")) {
    // Backfill map pins: older properties (or failed geocodes) may lack
    // coordinates. Fire-and-forget the lazy Nominatim geocoder so pins fill
    // in on subsequent loads — never block this response on the 1 req/sec queue.
    void ensurePropertiesGeocoded().catch((err) =>
      logger.warn({ err }, "Background property geocoding failed"),
    );
    const activeStatuses = new Set(["new", "scheduled", "in_progress"]);
    out.properties = scopedProps.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address ?? null,
      city: p.city ?? null,
      units: p.units ?? null,
      latitude: p.latitude ?? null,
      longitude: p.longitude ?? null,
      activeJobs: scopedJobs.filter(
        (j) => j.propertyId === p.id && activeStatuses.has(j.status),
      ).length,
    }));
  }

  if (features.includes("jobs")) {
    const recent = [...scopedJobs]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 200);
    out.jobs = recent.map((j) => ({
      id: j.id,
      jobNo: j.jobNo,
      description: j.description ?? null,
      status: j.status,
      propertyId: j.propertyId ?? null,
      propertyName: propName.get(j.propertyId) ?? null,
      unitNo: j.unitNo ?? null,
      scheduledOn: j.scheduledOn ?? null,
      crewLeaderName: j.crewLeaderId ? (crewName.get(j.crewLeaderId) ?? null) : null,
    }));
  }

  if (features.includes("schedule")) {
    const today = localToday();
    const horizon = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const sched = await db
      .select()
      .from(schedulesTable)
      .where(and(gte(schedulesTable.scheduledOn, today), lte(schedulesTable.scheduledOn, horizon)));
    const items: typeof out.schedule = [];
    for (const s of sched) {
      const j = jobById.get(s.jobId);
      if (!j || !scopedJobIds.has(j.id)) continue;
      items.push({
        date: s.scheduledOn,
        title: `${j.jobNo}${j.description ? ` — ${j.description}` : ""}`,
        propertyName: propName.get(j.propertyId) ?? null,
        unitNo: j.unitNo ?? null,
        time: s.windowStart ?? null,
        kind: "job",
      });
    }
    const events = await db
      .select()
      .from(calendarEventsTable)
      .where(and(gte(calendarEventsTable.eventDate, today), lte(calendarEventsTable.eventDate, horizon)));
    for (const ev of events) {
      // Only events tied to a job inside the granted scope; general office
      // events stay internal.
      if (!ev.jobId || !scopedJobIds.has(ev.jobId)) continue;
      const j = jobById.get(ev.jobId);
      items.push({
        date: ev.eventDate,
        title: ev.title,
        propertyName: j ? (propName.get(j.propertyId) ?? null) : null,
        unitNo: j?.unitNo ?? null,
        time: ev.allDay ? null : (ev.startTime ?? null),
        kind: "event",
      });
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    out.schedule = items;
  }

  if (features.includes("dispatch")) {
    const today = localToday();
    const rows = await db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(eq(crewDispatchAssignmentsTable.day, today));
    out.dispatch = rows
      .filter((r) => scopedJobIds.has(r.jobId))
      .map((r) => {
        const j = jobById.get(r.jobId);
        const checklist = (r.checklist as { done?: boolean }[] | null) ?? [];
        return {
          memberName: crewName.get(r.memberId) ?? "Crew member",
          jobNo: j?.jobNo ?? null,
          propertyName: j ? (propName.get(j.propertyId) ?? null) : null,
          unitNo: j?.unitNo ?? null,
          checklistDone: checklist.filter((i) => i.done).length,
          checklistTotal: checklist.length,
          status: r.status,
        };
      });
  }

  res.json(GetPortalOfficeViewResponse.parse(out));
});

router.post(
  "/portal/:token/dispatch/:assignmentId/check",
  async (req, res): Promise<void> => {
    const { token, assignmentId } = CheckPortalDispatchItemParams.parse(req.params);
    const crew = await crewByToken(token);
    if (!crew) {
      res.status(404).json({ error: "Invalid portal link" });
      return;
    }
    const body = CheckPortalDispatchItemBody.parse(req.body);
    const [a] = await db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(eq(crewDispatchAssignmentsTable.id, assignmentId));
    // Ownership: the member themselves, or their foreman, can check items.
    const isOwner = a && a.memberId === crew.id;
    let isForeman = false;
    if (a && !isOwner) {
      const [member] = await db
        .select()
        .from(crewsTable)
        .where(eq(crewsTable.id, a.memberId));
      isForeman = !!member && member.leaderId === crew.id;
    }
    if (!a || (!isOwner && !isForeman)) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    const checklist = readDispatchChecklist(a.checklist).map((i) =>
      i.id === body.itemId ? { ...i, done: body.done } : i,
    );
    const [row] = await db
      .update(crewDispatchAssignmentsTable)
      .set({ checklist, updatedAt: new Date() })
      .where(eq(crewDispatchAssignmentsTable.id, assignmentId))
      .returning();
    const [out] = await serPortalDispatchAssignments([row]);
    res.json(CheckPortalDispatchItemResponse.parse(out));
  },
);

router.post(
  "/portal/:token/dispatch/:assignmentId/move-response",
  async (req, res): Promise<void> => {
    const { token, assignmentId } = RespondPortalDispatchMoveParams.parse(req.params);
    const crew = await crewByToken(token);
    if (!crew) {
      res.status(404).json({ error: "Invalid portal link" });
      return;
    }
    const body = RespondPortalDispatchMoveBody.parse(req.body);
    const [a] = await db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(eq(crewDispatchAssignmentsTable.id, assignmentId));
    if (!a) {
      res.status(404).json({ error: "Assignment not found" });
      return;
    }
    const [member] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, a.memberId));
    if (!member || member.leaderId !== crew.id) {
      res.status(403).json({ error: "Only this member's foreman can decide the move" });
      return;
    }
    if (a.status !== "pending_move" || !a.pendingJobId) {
      res.status(409).json({ error: "No pending move on this assignment" });
      return;
    }
    const [fromJob] = await db.select().from(jobsTable).where(eq(jobsTable.id, a.jobId));
    const [toJob] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, a.pendingJobId));
    if (body.approve) {
      const checklist = await seedChecklist(a.pendingJobId);
      let moved: unknown[];
      try {
        // Guarded transition: only settles the exact pending move we read, so
        // concurrent approve/decline can't both win.
        moved = await db
          .update(crewDispatchAssignmentsTable)
          .set({
            jobId: a.pendingJobId,
            status: "assigned",
            checklist,
            pendingJobId: null,
            moveRequestedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(crewDispatchAssignmentsTable.id, assignmentId),
              eq(crewDispatchAssignmentsTable.status, "pending_move"),
              eq(crewDispatchAssignmentsTable.pendingJobId, a.pendingJobId),
            ),
          )
          .returning();
      } catch (e) {
        if (isUniqueViolation(e)) {
          // Already has a row on the target job for that day — drop this one.
          await db
            .delete(crewDispatchAssignmentsTable)
            .where(eq(crewDispatchAssignmentsTable.id, assignmentId));
          res.json(RespondPortalDispatchMoveResponse.parse({ ok: true }));
          return;
        }
        throw e;
      }
      if (moved.length === 0) {
        res.status(409).json({ error: "This move was already decided." });
        return;
      }
      await db.insert(activitiesTable).values({
        entityType: "job",
        entityId: a.pendingJobId,
        kind: "assigned",
        body: `Foreman ${crew.name} approved moving ${member.name} to job ${toJob?.jobNo ?? "?"}`,
      });
    } else {
      const declined = await db
        .update(crewDispatchAssignmentsTable)
        .set({
          status: "assigned",
          pendingJobId: null,
          moveRequestedAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(crewDispatchAssignmentsTable.id, assignmentId),
            eq(crewDispatchAssignmentsTable.status, "pending_move"),
            eq(crewDispatchAssignmentsTable.pendingJobId, a.pendingJobId),
          ),
        )
        .returning();
      if (declined.length === 0) {
        res.status(409).json({ error: "This move was already decided." });
        return;
      }
      await db.insert(notificationsTable).values({
        kind: "crew_message",
        priority: "high",
        entityType: "crew",
        entityId: member.id,
        title: `Move declined by foreman ${crew.name}`,
        body: `${member.name} stays on job ${fromJob?.jobNo ?? "?"} — move to ${toJob?.jobNo ?? "?"} was declined.`,
      });
      await db.insert(activitiesTable).values({
        entityType: "job",
        entityId: a.jobId,
        kind: "flag",
        body: `Foreman ${crew.name} declined moving ${member.name} to job ${toJob?.jobNo ?? "?"}`,
      });
    }
    res.json(RespondPortalDispatchMoveResponse.parse({ ok: true }));
  },
);

export default router;
