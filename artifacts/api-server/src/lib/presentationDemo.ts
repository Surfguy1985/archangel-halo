// Presentation Mode demo data. Seeds a clearly-marked mock property with mock
// crews, jobs, invoices, live crew check-ins, and board cards so the office can
// run a guided, narrated walkthrough of the client dashboard on REAL screens.
// Everything is tagged by the fixed demo property name; teardown deletes only
// rows belonging to the demo property/crews, then rebuilds the ledger so demo
// invoices never linger in the Books.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientAccountsTable,
  clientBoardCardsTable,
  clientCardCommentsTable,
  clientCardHistoryTable,
  clientBoardNotificationsTable,
  clientDashboardCardsTable,
  clientDashboardActionsTable,
  crewsTable,
  jobsTable,
  invoicesTable,
  invoiceLineItemsTable,
  paymentsTable,
  paymentRequestsTable,
  paymentRequestJobsTable,
  crewCheckinsTable,
  crewMessagesTable,
  crewPhotosTable,
  priceItemsTable,
  workRequestsTable,
  jobSummariesTable,
  activitiesTable,
  notificationsTable,
} from "@workspace/db";
import { raiseClientCard, completeClientCard } from "./clientBoard";
import {
  buildInvoiceModule,
  buildCrewMapModule,
  buildPhotosModule,
  buildTrackerModule,
  buildSummaryModule,
  buildFlagsModule,
} from "./cardModules";
import { acceptWorkRequest } from "../routes/workRequests";
import { applySopToInvoice } from "../routes/sop";
import { resolveTaxAmount } from "../routes/money";
import { recomputeJobFinancials } from "./jobFinance";
import { syncInvoiceLedger } from "./ledger";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";
import { rebuildLedger, withRefLock } from "./ledger";
import { emitBoardEvent } from "./boardEvents";

export const DEMO_PROPERTY_NAME = "Falkon Demo — Skyline Terrace";
// Hard demo marker: the property must ALSO carry this exact brief before
// teardown will touch it — a real property that merely shares the name can
// never be deleted by Presentation Mode.
const DEMO_BRIEF = "Demo property for Presentation Mode. All data on this board is mock data.";

function newToken(): string {
  return randomBytes(18).toString("base64url");
}

function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function findDemoProperty() {
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(and(eq(propertiesTable.name, DEMO_PROPERTY_NAME), eq(propertiesTable.brief, DEMO_BRIEF)))
    .limit(1);
  return prop ?? null;
}

export async function getPresentationDemoState(): Promise<{
  active: boolean;
  dashboardToken: string | null;
  propertyId: string | null;
}> {
  const prop = await findDemoProperty();
  if (!prop) return { active: false, dashboardToken: null, propertyId: null };
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.propertyId, prop.id))
    .limit(1);
  return { active: true, dashboardToken: account?.dashboardToken ?? null, propertyId: prop.id };
}

/** Remove every row belonging to the demo property. Safe when nothing exists. */
export async function teardownPresentationDemo(): Promise<boolean> {
  // Serialize with seeding so concurrent toggles can't race each other.
  return withRefLock("presentation-demo", teardownPresentationDemoInner);
}

async function teardownPresentationDemoInner(): Promise<boolean> {
  const prop = await findDemoProperty();
  if (!prop) return false;
  const pid = prop.id;

  const jobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(eq(jobsTable.propertyId, pid));
  const jobIds = jobs.map((j) => j.id);
  // Demo crews must satisfy BOTH markers: the sentinel email AND being the
  // crew leader of a demo-property job. Never delete on email alone.
  const demoLeaderIds = new Set(
    (await db.select({ crewLeaderId: jobsTable.crewLeaderId }).from(jobsTable).where(eq(jobsTable.propertyId, pid)))
      .map((j) => j.crewLeaderId)
      .filter((x): x is string => !!x),
  );
  const crews = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.email, DEMO_CREW_EMAIL));
  const crewIds = crews.map((c) => c.id).filter((id) => demoLeaderIds.has(id));
  const invoices = await db
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.propertyId, pid));
  const invoiceIds = invoices.map((i) => i.id);
  const requests = await db
    .select({ id: paymentRequestsTable.id })
    .from(paymentRequestsTable)
    .where(eq(paymentRequestsTable.propertyId, pid));
  const requestIds = requests.map((r) => r.id);

  await db.transaction(async (tx) => {
    if (requestIds.length) {
      await tx.delete(paymentRequestJobsTable).where(inArray(paymentRequestJobsTable.requestId, requestIds));
      await tx.delete(paymentRequestsTable).where(inArray(paymentRequestsTable.id, requestIds));
    }
    if (invoiceIds.length) {
      await tx.delete(paymentsTable).where(inArray(paymentsTable.invoiceId, invoiceIds));
      await tx.delete(invoiceLineItemsTable).where(inArray(invoiceLineItemsTable.invoiceId, invoiceIds));
      await tx.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
    }
    if (crewIds.length) {
      await tx.delete(crewPhotosTable).where(inArray(crewPhotosTable.crewId, crewIds));
      await tx.delete(crewCheckinsTable).where(inArray(crewCheckinsTable.crewId, crewIds));
      await tx.delete(crewMessagesTable).where(inArray(crewMessagesTable.crewId, crewIds));
      await tx.delete(crewsTable).where(inArray(crewsTable.id, crewIds));
    }
    if (jobIds.length) {
      // Job summaries + crew photos hang off jobIds (no FKs — delete manually).
      await tx.delete(jobSummariesTable).where(inArray(jobSummariesTable.jobId, jobIds));
      await tx.delete(crewPhotosTable).where(inArray(crewPhotosTable.jobId, jobIds));
      await tx.delete(activitiesTable).where(inArray(activitiesTable.entityId, jobIds));
      await tx.delete(notificationsTable).where(inArray(notificationsTable.entityId, jobIds));
      await tx.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
    }
    // Lifecycle rows the demo steps create, all keyed to the demo propertyId.
    const wrs = await tx
      .select({ id: workRequestsTable.id })
      .from(workRequestsTable)
      .where(eq(workRequestsTable.propertyId, pid));
    const wrIds = wrs.map((w) => w.id);
    if (wrIds.length) {
      await tx.delete(notificationsTable).where(inArray(notificationsTable.entityId, wrIds));
    }
    await tx.delete(activitiesTable).where(eq(activitiesTable.entityId, pid));
    await tx.delete(workRequestsTable).where(eq(workRequestsTable.propertyId, pid));
    await tx.delete(priceItemsTable).where(eq(priceItemsTable.propertyId, pid));
    await tx.delete(clientBoardCardsTable).where(eq(clientBoardCardsTable.propertyId, pid));
    await tx.delete(clientDashboardCardsTable).where(eq(clientDashboardCardsTable.propertyId, pid));
    await tx.delete(clientDashboardActionsTable).where(eq(clientDashboardActionsTable.propertyId, pid));
    await tx.delete(clientCardCommentsTable).where(eq(clientCardCommentsTable.propertyId, pid));
    await tx.delete(clientCardHistoryTable).where(eq(clientCardHistoryTable.propertyId, pid));
    await tx.delete(clientBoardNotificationsTable).where(eq(clientBoardNotificationsTable.propertyId, pid));
    await tx.delete(clientAccountsTable).where(eq(clientAccountsTable.propertyId, pid));
    await tx.delete(propertiesTable).where(eq(propertiesTable.id, pid));
  });
  // Demo invoices/payments must not survive in the Books.
  await rebuildLedger();
  return true;
}

// Demo crews are tagged by a fixed sentinel email so teardown can find them
// without a schema change.
const DEMO_CREW_EMAIL = "demo-crew@falkon.example";

/** Idempotent: tears down any prior demo, then seeds a fresh one. */
export async function seedPresentationDemo(): Promise<{
  dashboardToken: string;
  propertyId: string;
}> {
  // Serialize the whole teardown+seed so concurrent POSTs can't double-seed.
  return withRefLock("presentation-demo", seedPresentationDemoInner);
}

async function seedPresentationDemoInner(): Promise<{
  dashboardToken: string;
  propertyId: string;
}> {
  await teardownPresentationDemoInner();

  const [prop] = await db
    .insert(propertiesTable)
    .values({
      name: DEMO_PROPERTY_NAME,
      pmcName: "Falkon Property Group",
      address: "4800 Skyline Terrace, Los Angeles, CA 90068",
      city: "Los Angeles",
      units: 24,
      latitude: 34.1184,
      longitude: -118.3452,
      brief: "Demo property for Presentation Mode. All data on this board is mock data.",
    })
    .returning();

  const dashboardToken = newToken();
  await db.insert(clientAccountsTable).values({
    propertyId: prop.id,
    tier: "enterprise",
    dashboardToken,
    notes: "Presentation Mode demo account (mock data).",
  });

  // Small price book so the lifecycle demo's client work request can price its
  // line items from the property's own catalog (like a real request would).
  await db.insert(priceItemsTable).values([
    { propertyId: prop.id, service: "Make Ready", detail: "Full unit turnover — make ready", unit: "unit", rate: 850 },
    { propertyId: prop.id, service: "Cleaning", detail: "Move-out deep clean", unit: "unit", rate: 250 },
    { propertyId: prop.id, service: "Paint", detail: "Interior repaint", unit: "unit", rate: 400 },
  ]);

  const crewRows = await db
    .insert(crewsTable)
    .values([
      { name: "Marco Reyes", trade: "Paint & Drywall", phone: "(555) 010-1001", email: DEMO_CREW_EMAIL, isLeader: true, active: true, portalToken: newToken(), agreementAcceptedAt: new Date() },
      { name: "Dana Whitfield", trade: "Plumbing", phone: "(555) 010-1002", email: DEMO_CREW_EMAIL, isLeader: true, active: true, portalToken: newToken(), agreementAcceptedAt: new Date() },
      { name: "Luis Ortega", trade: "Landscaping", phone: "(555) 010-1003", email: DEMO_CREW_EMAIL, isLeader: true, active: true, portalToken: newToken(), agreementAcceptedAt: new Date() },
    ])
    .returning();
  const [marco, dana, luis] = crewRows;

  const today = new Date();
  const in3 = new Date(today.getTime() + 3 * 86400000);
  const jobRows = await db
    .insert(jobsTable)
    .values([
      {
        jobNo: "J-9001",
        propertyId: prop.id,
        unitNo: "204",
        category: "maintenance",
        description: "Full repaint + drywall patch, Unit 204",
        status: "in_progress",
        crewLeaderId: marco.id,
        scheduledOn: localYmd(today),
        scheduledTime: "9:00 AM",
        trackerToken: newToken(),
      },
      {
        jobNo: "J-9002",
        propertyId: prop.id,
        unitNo: "108",
        category: "maintenance",
        description: "Water heater replacement, Unit 108",
        status: "scheduled",
        crewLeaderId: dana.id,
        scheduledOn: localYmd(in3),
        scheduledTime: "8:30 AM",
      },
      {
        jobNo: "J-9003",
        propertyId: prop.id,
        category: "landscaping",
        description: "Courtyard landscaping refresh — hedges, irrigation check",
        status: "open",
        crewLeaderId: luis.id,
      },
      {
        jobNo: "J-9004",
        propertyId: prop.id,
        unitNo: "310",
        category: "turnover",
        description: "Unit turnover — paint, deep clean, fixture swap",
        status: "complete",
        crewLeaderId: marco.id,
        completedAt: new Date(today.getTime() - 2 * 86400000),
      },
    ])
    .returning();
  const [jobPaint, , jobLandscape, jobTurnover] = jobRows;

  // Invoices: one payable (drives the pay-flow demo), one already paid.
  const dueAt = new Date(today.getTime() + 14 * 86400000);
  const [invOpen] = await db
    .insert(invoicesTable)
    .values({
      invoiceNo: "INV-9001",
      jobId: jobTurnover.id,
      propertyId: prop.id,
      amount: 4850,
      status: "sent",
      terms: "Net 14",
      billToName: "Falkon Property Group",
      propertyAddress: prop.address,
      issuedOn: localYmd(today),
      sentAt: new Date(),
      dueAt,
    })
    .returning();
  await db.insert(invoiceLineItemsTable).values([
    { invoiceId: invOpen.id, unitNo: "310", typeOfWork: "Turnover — paint", description: "Full interior repaint, 2BR", qty: 1, unitPrice: 2600, amount: 2600, sortOrder: 0 },
    { invoiceId: invOpen.id, unitNo: "310", typeOfWork: "Deep clean", description: "Move-out deep clean", qty: 1, unitPrice: 950, amount: 950, sortOrder: 1 },
    { invoiceId: invOpen.id, unitNo: "310", typeOfWork: "Fixtures", description: "Bath + kitchen fixture swap", qty: 1, unitPrice: 1300, amount: 1300, sortOrder: 2 },
  ]);
  const [invPaid] = await db
    .insert(invoicesTable)
    .values({
      invoiceNo: "INV-9002",
      jobId: jobPaint.id,
      propertyId: prop.id,
      amount: 1200,
      status: "paid",
      terms: "Net 14",
      billToName: "Falkon Property Group",
      propertyAddress: prop.address,
      issuedOn: localYmd(new Date(today.getTime() - 9 * 86400000)),
      sentAt: new Date(today.getTime() - 9 * 86400000),
      paidAt: new Date(today.getTime() - 2 * 86400000),
    })
    .returning();
  await db.insert(invoiceLineItemsTable).values([
    { invoiceId: invPaid.id, unitNo: "204", typeOfWork: "Drywall repair", description: "Patch + texture, living room", qty: 1, unitPrice: 1200, amount: 1200, sortOrder: 0 },
  ]);
  await db.insert(paymentsTable).values({
    invoiceId: invPaid.id,
    amount: 1200,
    method: "check",
    payerName: "Falkon Property Group",
    receivedAt: new Date(today.getTime() - 2 * 86400000),
  });

  // Live crew presence: Marco is on site right now.
  await db.insert(crewCheckinsTable).values([
    { crewId: marco.id, jobId: jobPaint.id, kind: "site", lat: 34.1181, lng: -118.3449, label: "On site — Unit 204", createdAt: new Date(today.getTime() - 20 * 60000) },
    { crewId: marco.id, jobId: jobPaint.id, kind: "checkin", lat: 34.1184, lng: -118.3452, label: "Arrived", createdAt: new Date(today.getTime() - 3 * 3600000) },
  ]);

  // Before/after photos on the drywall job. The image files are bundled with
  // the server and pushed into object storage on every seed (fixed object
  // names, overwrite-safe), so the photos card uses the exact same
  // /api/storage serving path as real crew photos. Photo upload is
  // best-effort: if object storage is unavailable the rest of the demo still
  // seeds, we just skip the photos card.
  const demoPhotoRows = await seedDemoPhotos(marco.id, jobPaint.id, today);

  await db.insert(crewMessagesTable).values([
    { crewId: marco.id, sender: "crew", body: "Unit 204 prep done, starting first coat after lunch.", createdAt: new Date(today.getTime() - 90 * 60000) },
    { crewId: marco.id, sender: "office", body: "Great — client wants eggshell finish in the living room.", createdAt: new Date(today.getTime() - 60 * 60000) },
  ]);

  // Board cards — same raise path the office uses, so modules/pay links are real.
  const invoiceModule = await buildInvoiceModule(prop.id, invOpen.id);
  await raiseClientCard({
    propertyId: prop.id,
    kind: "invoice",
    title: `Invoice ${invOpen.invoiceNo} — Unit 310 turnover`,
    body: "Turnover complete on Unit 310. Paint, deep clean, and fixture swap — photos and PDF attached.",
    actionLabel: "Review & pay",
    amount: 4850,
    dueDate: localYmd(dueAt),
    links: [{ label: `Invoice ${invOpen.invoiceNo}.pdf`, url: `/api/invoices/${invOpen.id}/pdf`, kind: "pdf" }],
    sourceType: "invoice",
    sourceId: invOpen.id,
    jobId: jobTurnover.id,
    module: invoiceModule,
  });

  const crewMapModule = await buildCrewMapModule(prop.id);
  await raiseClientCard({
    propertyId: prop.id,
    kind: "tracker",
    title: "Live crew on your site",
    body: "Marco's paint crew is on site at Unit 204 right now. Watch them live on the map.",
    actionLabel: "Watch live",
    sourceType: "crewmap",
    sourceId: prop.id,
    module: crewMapModule,
  });

  // NOTE: no manual card for the landscaping job — the open job J-9003 is
  // auto-projected into Requested by the board, and the tour's live-move step
  // targets that projected card (a second manual copy would look duplicated).
  void jobLandscape;

  if (demoPhotoRows > 0) {
    const photosModule = await buildPhotosModule(prop.id, jobPaint.id);
    if (photosModule) {
      await raiseClientCard({
        propertyId: prop.id,
        kind: "photos",
        title: "Before & after — Unit 204 drywall repair",
        body: "Marco's crew documented the repair from first patch to final coat. Tap through the before/after set.",
        actionLabel: "View photos",
        sourceType: "photos",
        sourceId: jobPaint.id,
        jobId: jobPaint.id,
        module: photosModule,
      });
    }
  }

  await raiseClientCard({
    propertyId: prop.id,
    kind: "summary",
    title: "Job recap — Unit 204 drywall repair",
    body: "Drywall patched, textured, and painted. Before/after photos in the recap. Invoice INV-9002 is paid — thank you!",
    sourceType: "job_summary",
    sourceId: `demo-recap-${jobPaint.id}`,
    jobId: jobPaint.id,
  });

  // Keep the demo invoice in the Books consistently until teardown.
  await rebuildLedger();

  return { dashboardToken, propertyId: prop.id };
}

// ---------------------------------------------------------------------------
// Full card-lifecycle walkthrough (Presentation Mode "step" engine)
//
// Each step below is IDEMPOTENT: everything is keyed to fixed demo markers so
// re-running any step (or the whole sequence twice) never duplicates data.
// These run against the DEMO PROPERTY ONLY and must NOT send real emails/SMS —
// they build the same rows the real code paths do (reusing the same helpers)
// but skip the notification side effects.
// ---------------------------------------------------------------------------

// Fixed markers for the lifecycle work request (so it's found, not duplicated).
const LC_UNIT = "204";
const LC_SERVICE = "Make Ready";
const LC_PO = "PO-2044";
const LC_NOTE = "Unit 204 turnover — make ready for new tenant";

export const PRESENTATION_DEMO_STEPS = [
  "reset",
  "request_created",
  "office_accept",
  "assign_schedule",
  "tracker_live",
  "photos",
  "summary_flags",
  "invoice_sent",
  "office_receipt",
] as const;
export type PresentationDemoStep = (typeof PRESENTATION_DEMO_STEPS)[number];

/** The demo crew leader (Marco) — leader of the seeded J-9001 paint job. */
async function demoCrewLeaderId(pid: string): Promise<string | null> {
  const [seedJob] = await db
    .select({ crewLeaderId: jobsTable.crewLeaderId })
    .from(jobsTable)
    .where(and(eq(jobsTable.propertyId, pid), eq(jobsTable.jobNo, "J-9001")))
    .limit(1);
  return seedJob?.crewLeaderId ?? null;
}

/** The lifecycle work request (unit 204 make-ready), if it exists. */
async function findLifecycleRequest(pid: string) {
  const [wr] = await db
    .select()
    .from(workRequestsTable)
    .where(and(eq(workRequestsTable.propertyId, pid), eq(workRequestsTable.poNumber, LC_PO)))
    .limit(1);
  return wr ?? null;
}

/** The lifecycle job created from the request, if it exists. */
async function findLifecycleJob(pid: string) {
  const wr = await findLifecycleRequest(pid);
  if (!wr?.jobId) return null;
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, wr.jobId)).limit(1);
  return job ?? null;
}

/** The lifecycle invoice for the lifecycle job, if it exists. */
async function findLifecycleInvoice(pid: string) {
  const job = await findLifecycleJob(pid);
  if (!job) return null;
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.propertyId, pid), eq(invoicesTable.jobId, job.id)))
    .limit(1);
  return inv ?? null;
}

/**
 * Restore the demo to its post-seed state: delete only the rows the lifecycle
 * steps below create (work request + job + invoice + summary + pushed cards),
 * leaving the base seed (property, account, seeded crews/jobs/invoices) intact.
 */
async function stepReset(pid: string): Promise<void> {
  const wr = await findLifecycleRequest(pid);
  const job = wr?.jobId
    ? (await db.select().from(jobsTable).where(eq(jobsTable.id, wr.jobId)).limit(1))[0]
    : null;
  const jobIds = job ? [job.id] : [];
  const inv = job ? await findLifecycleInvoice(pid) : null;
  // The summary/flags cards are keyed to the job_summary row's id, not the
  // job/request/invoice ids — collect it so reset removes those cards too.
  const summaries = jobIds.length
    ? await db.select({ id: jobSummariesTable.id }).from(jobSummariesTable).where(inArray(jobSummariesTable.jobId, jobIds))
    : [];

  await db.transaction(async (tx) => {
    // Pushed cards created by the steps (keyed to lifecycle sources).
    const sourceIds = [
      wr?.id ?? "",
      ...jobIds,
      inv?.id ?? "",
      ...summaries.map((s) => s.id),
      ...jobIds.map((j) => `demo-receipt-${j}`),
    ].filter(Boolean);
    if (sourceIds.length) {
      await tx
        .delete(clientBoardCardsTable)
        .where(inArray(clientBoardCardsTable.sourceId, sourceIds));
    }
    if (inv) {
      await tx.delete(paymentsTable).where(eq(paymentsTable.invoiceId, inv.id));
      await tx.delete(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, inv.id));
      await tx.delete(invoicesTable).where(eq(invoicesTable.id, inv.id));
    }
    if (jobIds.length) {
      await tx.delete(jobSummariesTable).where(inArray(jobSummariesTable.jobId, jobIds));
      await tx.delete(crewPhotosTable).where(inArray(crewPhotosTable.jobId, jobIds));
      await tx.delete(crewCheckinsTable).where(inArray(crewCheckinsTable.jobId, jobIds));
      await tx.delete(activitiesTable).where(inArray(activitiesTable.entityId, jobIds));
      await tx.delete(notificationsTable).where(inArray(notificationsTable.entityId, jobIds));
      await tx.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
    }
    if (wr) {
      await tx.delete(notificationsTable).where(eq(notificationsTable.entityId, wr.id));
      await tx.delete(workRequestsTable).where(eq(workRequestsTable.id, wr.id));
    }
  });
  // Demo invoice must not linger in the Books after a reset.
  await rebuildLedger();
}

/** Client files the unit-204 make-ready work request. Idempotent by PO. */
async function stepRequestCreated(pid: string): Promise<void> {
  if (await findLifecycleRequest(pid)) return; // already created
  const [makeReady] = await db
    .select()
    .from(priceItemsTable)
    .where(and(eq(priceItemsTable.propertyId, pid), eq(priceItemsTable.service, LC_SERVICE)))
    .limit(1);
  await db.insert(workRequestsTable).values({
    propertyId: pid,
    requesterName: "Skyline Terrace PM",
    serviceId: makeReady?.id ?? null,
    serviceLabel: LC_SERVICE,
    unitNo: LC_UNIT,
    units: [LC_UNIT],
    notes: LC_NOTE,
    emergency: false,
    poNumber: LC_PO,
    // Client's stated budget from the price book (Make Ready + Cleaning + Paint).
    budgetEstimate: (makeReady?.rate ?? 850) + 250 + 400,
    status: "pending",
  });
  // NOTE: no office email/SMS — this is the demo property.
  emitBoardEvent(pid);
}

/** Office accepts the request → job (reuses the shared accept helper). */
async function stepOfficeAccept(pid: string): Promise<void> {
  const wr = await findLifecycleRequest(pid);
  if (!wr) throw new Error("Run request_created first");
  if (wr.status === "accepted" && wr.jobId) return; // already accepted
  await acceptWorkRequest(wr.id, {});
}

/** Assign the demo crew as leader + schedule today so it lands In progress. */
async function stepAssignSchedule(pid: string): Promise<void> {
  const job = await findLifecycleJob(pid);
  if (!job) throw new Error("Run office_accept first");
  const leaderId = await demoCrewLeaderId(pid);
  const today = new Date();
  await db
    .update(jobsTable)
    .set({
      crewLeaderId: leaderId,
      // crewVacatedAt MUST be cleared whenever a crew leader is (re)assigned.
      crewVacatedAt: null,
      status: "in_progress",
      scheduledOn: localYmd(today),
      scheduledTime: "9:00 AM",
      scheduleType: "scheduled",
    })
    .where(eq(jobsTable.id, job.id));
  // A recent on-site check-in projects the card into the In progress lane.
  if (leaderId) {
    const already = await db
      .select({ id: crewCheckinsTable.id })
      .from(crewCheckinsTable)
      .where(and(eq(crewCheckinsTable.jobId, job.id), eq(crewCheckinsTable.kind, "site")))
      .limit(1);
    if (already.length === 0) {
      await db.insert(crewCheckinsTable).values({
        crewId: leaderId,
        jobId: job.id,
        kind: "site",
        lat: 34.1181,
        lng: -118.3449,
        label: `On site — Unit ${LC_UNIT}`,
        createdAt: new Date(today.getTime() - 15 * 60000),
      });
    }
  }
  emitBoardEvent(pid);
}

/** Push the live tracker card for the lifecycle job. */
async function stepTrackerLive(pid: string): Promise<void> {
  const job = await findLifecycleJob(pid);
  if (!job) throw new Error("Run office_accept first");
  // Ensure the job has a tracker token (atomic first-wins like the real flow).
  if (!job.trackerToken) {
    await db
      .update(jobsTable)
      .set({ trackerToken: newToken() })
      .where(and(eq(jobsTable.id, job.id), isNull(jobsTable.trackerToken)));
  }
  const module = await buildTrackerModule(pid, job.id);
  await raiseClientCard({
    propertyId: pid,
    kind: "tracker",
    title: `Live tracker — Unit ${LC_UNIT} make ready`,
    body: "Your crew is on site now. Follow the live GPS tracker and check-ins.",
    actionLabel: "Watch live",
    sourceType: "tracker",
    sourceId: job.id,
    jobId: job.id,
    module,
  });
}

/** Push the before/after photos card, reusing the seeded demo photos. */
async function stepPhotos(pid: string): Promise<void> {
  const job = await findLifecycleJob(pid);
  if (!job) throw new Error("Run office_accept first");
  const leaderId = await demoCrewLeaderId(pid);
  // Attach the four bundled demo photos to the lifecycle job (idempotent —
  // fixed object names, and we only insert when the job has none yet).
  const existing = await db
    .select({ id: crewPhotosTable.id })
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.jobId, job.id))
    .limit(1);
  if (existing.length === 0 && leaderId) {
    await seedDemoPhotos(leaderId, job.id, new Date());
  }
  const module = await buildPhotosModule(pid, job.id);
  if (!module) return; // storage unavailable — degrade gracefully
  await raiseClientCard({
    propertyId: pid,
    kind: "photos",
    title: `Before & after — Unit ${LC_UNIT} make ready`,
    body: "Your crew documented the turnover from first look to final walk. Tap through the before/after set.",
    actionLabel: "View photos",
    sourceType: "photos",
    sourceId: job.id,
    jobId: job.id,
    module,
  });
}

/** Push the work-summary card (result "exceeded") + a flags card (2 items). */
async function stepSummaryFlags(pid: string): Promise<void> {
  const job = await findLifecycleJob(pid);
  if (!job) throw new Error("Run office_accept first");
  const leaderId = await demoCrewLeaderId(pid);
  let leaderName: string | null = null;
  if (leaderId) {
    const [c] = await db.select({ name: crewsTable.name }).from(crewsTable).where(eq(crewsTable.id, leaderId)).limit(1);
    leaderName = c?.name ?? null;
  }
  const flags = [
    { label: "Unit 204 — water stain on bathroom ceiling", checked: true, note: "Likely a slow leak above — recommend a plumbing look." },
    { label: "Hallway 2F — cracked window latch", checked: true, note: "Safety item — replace latch." },
  ];
  // One summary per job (jobId is unique). Upsert-by-lookup for idempotency.
  const [existingSummary] = await db
    .select()
    .from(jobSummariesTable)
    .where(eq(jobSummariesTable.jobId, job.id))
    .limit(1);
  const checklist = [
    {
      section: "Turnover checklist",
      items: [
        { label: "Walls patched & painted", checked: true },
        { label: "Floors cleaned & sealed", checked: true },
        { label: "Fixtures swapped", checked: true },
        { label: "Deep clean complete", checked: true },
        { label: "Final walk-through", checked: true },
      ],
    },
  ];
  let summaryId: string;
  if (existingSummary) {
    summaryId = existingSummary.id;
    await db
      .update(jobSummariesTable)
      .set({ checklist, flags, overallResult: "exceeded", status: "sent", sentAt: new Date(), updatedAt: new Date() })
      .where(eq(jobSummariesTable.id, summaryId));
  } else {
    const [s] = await db
      .insert(jobSummariesTable)
      .values({
        jobId: job.id,
        propertyId: pid,
        token: newToken(),
        title: `Service Recap — Unit ${LC_UNIT}`,
        unitNumber: LC_UNIT,
        serviceDate: localYmd(new Date()),
        crewLead: leaderName,
        checklist,
        flags,
        overallResult: "exceeded",
        observations: "Turnover completed ahead of schedule — unit is rent ready.",
        status: "sent",
        sentAt: new Date(),
      })
      .returning();
    summaryId = s!.id;
  }
  const summaryModule = await buildSummaryModule(pid, summaryId);
  await raiseClientCard({
    propertyId: pid,
    kind: "summary",
    title: `Work summary — Unit ${LC_UNIT} make ready`,
    body: "Turnover complete — every checklist item passed and the crew exceeded scope. Full recap with photos attached.",
    actionLabel: "View recap",
    sourceType: "job_summary",
    sourceId: summaryId,
    jobId: job.id,
    module: summaryModule,
  });
  const flagsModule = await buildFlagsModule(pid);
  await raiseClientCard({
    propertyId: pid,
    kind: "flag",
    title: `⚑ 2 areas flagged — Unit ${LC_UNIT}`,
    body: flags.map((f) => `• ${f.label}${f.note ? ` — ${f.note}` : ""}`).join("\n"),
    actionLabel: "Review flagged areas",
    sourceType: "job_summary_flags",
    sourceId: summaryId,
    jobId: job.id,
    module: flagsModule,
  });
}

/** Create + send a real invoice for the lifecycle job, then push its card. */
async function stepInvoiceSent(pid: string): Promise<void> {
  const job = await findLifecycleJob(pid);
  if (!job) throw new Error("Run office_accept first");
  let inv = await findLifecycleInvoice(pid);
  if (!inv) {
    const items = [
      { typeOfWork: LC_SERVICE, description: "Full unit turnover — make ready", qty: 1, unitPrice: 850, amount: 850 },
      { typeOfWork: "Cleaning", description: "Move-out deep clean", qty: 1, unitPrice: 250, amount: 250 },
      { typeOfWork: "Paint", description: "Interior repaint", qty: 1, unitPrice: 400, amount: 400 },
    ];
    const total = items.reduce((s, i) => s + i.amount, 0);
    const issuedOn = localYmd(new Date());
    const dueAt = new Date(Date.now() + 30 * 86400000);
    // Same enforcement helper every invoice-create path uses. The demo
    // property has no SOP rule, so this is a no-op (returns null) — but wiring
    // it keeps the demo honest with the real POST /invoices contract.
    const sop = await applySopToInvoice(pid, {
      issuedOn,
      poNumber: LC_PO,
      dueProvided: true,
      total,
    });
    if (sop && !sop.ok) throw new Error(sop.error);
    const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, pid)).limit(1);
    const taxAmount = sop && sop.ok ? sop.taxAmount : await resolveTaxAmount(undefined, total);
    const [created] = await db
      .insert(invoicesTable)
      .values({
        invoiceNo: sop && sop.ok && sop.invoiceNo ? sop.invoiceNo : `INV-9${Date.now().toString().slice(-3)}`,
        jobId: job.id,
        propertyId: pid,
        amount: total,
        status: "draft",
        terms: "Net 30",
        poNumber: LC_PO,
        billToName: prop?.pmcName ?? prop?.name ?? "Falkon Property Group",
        propertyAddress: prop?.address ?? null,
        issuedOn,
        dueAt,
        taxAmount: taxAmount ?? 0,
      })
      .returning();
    await db.insert(invoiceLineItemsTable).values(
      items.map((it, i) => ({
        invoiceId: created!.id,
        unitNo: LC_UNIT,
        typeOfWork: it.typeOfWork,
        description: it.description,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.amount,
        sortOrder: i,
      })),
    );
    inv = created!;
  }
  // "Send" the invoice — mirror POST /invoices/:id/send WITHOUT the email.
  if (inv.status === "draft") {
    const [sent] = await db
      .update(invoicesTable)
      .set({ status: "sent", sentAt: new Date() })
      .where(eq(invoicesTable.id, inv.id))
      .returning();
    inv = sent!;
  }
  await recomputeJobFinancials(job.id);
  await syncInvoiceLedger(inv.id);
  const invTotal = inv.amount + (inv.taxAmount ?? 0);
  const module = await buildInvoiceModule(pid, inv.id);
  await raiseClientCard({
    propertyId: pid,
    kind: "invoice",
    title: `Invoice ${inv.invoiceNo} — ${invTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
    body: `Unit ${LC_UNIT} turnover complete — make ready, cleaning, and paint. Review & approve, then pick how you'd like to pay.`,
    actionLabel: "Review & approve",
    amount: invTotal,
    dueDate: inv.dueAt ? localYmd(inv.dueAt) : null,
    links: [{ label: `Invoice ${inv.invoiceNo} (PDF)`, url: `/api/invoices/${inv.id}/pdf`, kind: "pdf" }],
    sourceType: "invoice",
    sourceId: inv.id,
    jobId: job.id,
    module,
  });
}

/** After the client picks "mail a check", raise the OFFICE Done-lane card. */
async function stepOfficeReceipt(pid: string): Promise<void> {
  const job = await findLifecycleJob(pid);
  if (!job) throw new Error("Run office_accept first");
  const sourceId = `demo-receipt-${job.id}`;
  await raiseClientCard({
    propertyId: pid,
    kind: "summary",
    title: `Check approved — Unit ${LC_UNIT}`,
    body: "Payment approved by owner. Check will be issued Net 30.",
    sourceType: "office_receipt",
    sourceId,
    jobId: job.id,
  });
  // Force it into the Done lane (raiseClientCard lands cards in inbox; a
  // completed card projects onto the Done lane on both boards). Idempotent.
  await completeClientCard("office_receipt", sourceId);
}

/**
 * Run one lifecycle step against the active demo property. Serialized with the
 * seed/teardown lock so concurrent drives can't race. Idempotent per step.
 */
export async function runPresentationDemoStep(step: string): Promise<void> {
  if (!(PRESENTATION_DEMO_STEPS as readonly string[]).includes(step)) {
    throw new Error(`Unknown step: ${step}`);
  }
  await withRefLock("presentation-demo", async () => {
    const prop = await findDemoProperty();
    if (!prop) throw new Error("Presentation demo is not active");
    const pid = prop.id;
    switch (step as PresentationDemoStep) {
      case "reset":
        return stepReset(pid);
      case "request_created":
        return stepRequestCreated(pid);
      case "office_accept":
        return stepOfficeAccept(pid);
      case "assign_schedule":
        return stepAssignSchedule(pid);
      case "tracker_live":
        return stepTrackerLive(pid);
      case "photos":
        return stepPhotos(pid);
      case "summary_flags":
        return stepSummaryFlags(pid);
      case "invoice_sent":
        return stepInvoiceSent(pid);
      case "office_receipt":
        return stepOfficeReceipt(pid);
    }
  });
}

// ---------------------------------------------------------------------------
// Demo before/after photos
// ---------------------------------------------------------------------------

const DEMO_PHOTOS: Array<{ file: string; phase: "before" | "after"; note: string }> = [
  { file: "photo-before-1.jpg", phase: "before", note: "Living room wall damage — before" },
  { file: "photo-before-2.jpg", phase: "before", note: "Patch and tape in progress" },
  { file: "photo-after-1.jpg", phase: "after", note: "Repaired and repainted — after" },
  { file: "photo-after-2.jpg", phase: "after", note: "Final coat, eggshell finish" },
];

/**
 * Upload the bundled demo images into object storage under fixed names and
 * insert crew_photos rows for the drywall job. Returns how many photo rows
 * were created (0 when storage is unavailable — the demo degrades gracefully).
 */
async function seedDemoPhotos(crewId: string, jobId: string, today: Date): Promise<number> {
  // The server runs bundled from dist/ (import.meta.dirname = dist), but in
  // other contexts (tests, tsx) it runs from src/lib — probe both layouts plus
  // the working directory so the assets are found regardless of entry point.
  const candidates = [
    path.resolve(import.meta.dirname, "../assets/demo"), // dist/../assets
    path.resolve(import.meta.dirname, "../../assets/demo"), // src/lib/../../assets
    path.resolve(process.cwd(), "assets/demo"),
    path.resolve(process.cwd(), "artifacts/api-server/assets/demo"),
  ];
  const { existsSync } = await import("node:fs");
  const assetsDir = candidates.find((c) => existsSync(path.join(c, DEMO_PHOTOS[0].file)));
  if (!assetsDir) {
    logger.warn({ candidates }, "presentation demo: photo assets not found, skipping photos");
    return 0;
  }
  const storage = new ObjectStorageService();
  let privateDir: string;
  try {
    privateDir = storage.getPrivateObjectDir();
  } catch (err) {
    logger.warn({ err }, "presentation demo: object storage not configured, skipping photos");
    return 0;
  }
  if (!privateDir.endsWith("/")) privateDir = `${privateDir}/`;

  const rows: (typeof crewPhotosTable.$inferInsert)[] = [];
  for (const [i, p] of DEMO_PHOTOS.entries()) {
    try {
      const buf = await readFile(path.join(assetsDir, p.file));
      // Fixed object name → re-seeding overwrites instead of accumulating.
      const objectEntityPath = `${privateDir}demo-board/${p.file}`;
      const parts = objectEntityPath.startsWith("/") ? objectEntityPath.slice(1) : objectEntityPath;
      const [bucketName, ...rest] = parts.split("/");
      await objectStorageClient
        .bucket(bucketName)
        .file(rest.join("/"))
        .save(buf, { contentType: "image/jpeg" });
      rows.push({
        crewId,
        jobId,
        storagePath: `/objects/demo-board/${p.file}`,
        takenOn: localYmd(today),
        phase: p.phase,
        note: p.note,
        sizeBytes: buf.length,
        capturedAt: new Date(today.getTime() - (4 - i) * 3600000),
      });
    } catch (err) {
      logger.warn({ err, file: p.file }, "presentation demo: could not seed photo");
    }
  }
  if (rows.length) await db.insert(crewPhotosTable).values(rows);
  return rows.length;
}
