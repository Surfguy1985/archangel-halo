// Presentation Mode demo data. Seeds a clearly-marked mock property with mock
// crews, jobs, invoices, live crew check-ins, and board cards so the office can
// run a guided, narrated walkthrough of the client dashboard on REAL screens.
// Everything is tagged by the fixed demo property name; teardown deletes only
// rows belonging to the demo property/crews, then rebuilds the ledger so demo
// invoices never linger in the Books.
import { randomBytes } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientAccountsTable,
  clientBoardCardsTable,
  clientCardCommentsTable,
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
} from "@workspace/db";
import { raiseClientCard } from "./clientBoard";
import { buildInvoiceModule, buildCrewMapModule } from "./cardModules";
import { rebuildLedger, withRefLock } from "./ledger";

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
      await tx.delete(crewCheckinsTable).where(inArray(crewCheckinsTable.crewId, crewIds));
      await tx.delete(crewMessagesTable).where(inArray(crewMessagesTable.crewId, crewIds));
      await tx.delete(crewsTable).where(inArray(crewsTable.id, crewIds));
    }
    if (jobIds.length) {
      await tx.delete(jobsTable).where(inArray(jobsTable.id, jobIds));
    }
    await tx.delete(clientBoardCardsTable).where(eq(clientBoardCardsTable.propertyId, pid));
    await tx.delete(clientDashboardCardsTable).where(eq(clientDashboardCardsTable.propertyId, pid));
    await tx.delete(clientDashboardActionsTable).where(eq(clientDashboardActionsTable.propertyId, pid));
    await tx.delete(clientCardCommentsTable).where(eq(clientCardCommentsTable.propertyId, pid));
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
