// ---------------------------------------------------------------------------
// Client board card modules — self-contained interactive payloads.
//
// A module is a kind-specific structured snapshot built at push time, stored
// on the card (client_board_cards.module) and rendered identically on the
// client board and the office mirror. It carries everything the client needs
// to act — pay link, approve state, live GPS tracker URL, flagged items by
// unit with a schedule-work action, referral form — so each card behaves like
// a tiny standalone app.
//
// Client action state (approvedAt, requestedAt...) is written into the same
// object by the board action endpoint and survives module refreshes on
// re-send (see pickActionState in clientBoard.ts).
// ---------------------------------------------------------------------------

import {
  db,
  bidsTable,
  bidLineItemsTable,
  crewCheckinsTable,
  crewPhotosTable,
  crewsTable,
  invoicesTable,
  jobsTable,
  jobSummariesTable,
  paymentRequestsTable,
  paymentRequestJobsTable,
  propertiesTable,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";

function publicBaseUrl(): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : "";
}

// PayHub module guarantee: an invoice card must always ship with a working
// pay link. When no live (unpaid, unreturned) payment request covers the
// invoice, mint one on the spot — same shape the Pay Hub composer creates.
async function createPayLinkForInvoice(
  inv: typeof invoicesTable.$inferSelect,
): Promise<string | null> {
  if (inv.status === "paid") return null;
  const total = inv.amount + (inv.taxAmount ?? 0);
  if (!(total > 0)) return null;
  const token = randomBytes(18).toString("base64url");
  const finalToken = await db.transaction(async (tx) => {
    // Serialize per-invoice so concurrent pushes can't mint duplicate requests.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"paylink:" + inv.id}))`);
    const [existing] = await tx
      .select({ token: paymentRequestsTable.token })
      .from(paymentRequestJobsTable)
      .innerJoin(paymentRequestsTable, eq(paymentRequestJobsTable.requestId, paymentRequestsTable.id))
      .where(
        and(
          eq(paymentRequestJobsTable.invoiceId, inv.id),
          notInArray(paymentRequestsTable.status, ["paid", "returned"]),
        ),
      )
      .orderBy(desc(paymentRequestsTable.createdAt))
      .limit(1);
    if (existing) return existing.token;
    // Serialize request numbering globally — count-based PR numbers collide
    // under concurrency otherwise.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('payhub:request_no'))`);
    const count = (await tx.select({ id: paymentRequestsTable.id }).from(paymentRequestsTable)).length;
    const [row] = await tx
      .insert(paymentRequestsTable)
      .values({
        requestNo: `PR-${1001 + count}`,
        token,
        propertyId: inv.propertyId,
        total,
        memo: `Invoice ${inv.invoiceNo}`,
        // The card is the delivery: live immediately, stamped as sent via board.
        status: "sent",
        sentVia: "board",
        sentAt: new Date(),
        attachments: [
          {
            kind: "invoice" as const,
            invoiceId: inv.id,
            label: `Invoice ${inv.invoiceNo}.pdf`,
            url: `/api/invoices/${inv.id}/pdf`,
          },
        ],
      })
      .returning();
    await tx.insert(paymentRequestJobsTable).values({
      requestId: row!.id,
      jobId: inv.jobId ?? null,
      invoiceId: inv.id,
      label: `Invoice ${inv.invoiceNo}`,
      amount: total,
    });
    return token;
  });
  return `${publicBaseUrl()}/pay/${finalToken}`;
}

function localDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Invoice module: real invoice snapshot + pay link + approve action. */
export async function buildInvoiceModule(
  propertyId: string,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  const [inv] = await db
    .select()
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.propertyId, propertyId)));
  if (!inv) return null;
  // Latest unpaid payment request covering this invoice → pay page URL.
  const linkRows = await db
    .select({
      token: paymentRequestsTable.token,
      status: paymentRequestsTable.status,
    })
    .from(paymentRequestJobsTable)
    .innerJoin(paymentRequestsTable, eq(paymentRequestJobsTable.requestId, paymentRequestsTable.id))
    .where(eq(paymentRequestJobsTable.invoiceId, inv.id))
    .orderBy(desc(paymentRequestsTable.createdAt));
  const live = linkRows.find((r) => r.status !== "paid" && r.status !== "returned");
  const payUrl = live
    ? `${publicBaseUrl()}/pay/${live.token}`
    : await createPayLinkForInvoice(inv);
  return {
    type: "invoice",
    invoiceId: inv.id,
    invoiceNo: inv.invoiceNo,
    amount: inv.amount + (inv.taxAmount ?? 0),
    status: inv.status,
    dueDate: localDate(inv.dueAt),
    payUrl,
    pdfUrl: `/api/invoices/${inv.id}/pdf`,
    canApprove: inv.status !== "paid",
  };
}

/** Invoice batch module: several invoices on one card — totals, pay links, PDFs. */
export async function buildInvoiceBatchModule(
  propertyId: string,
  invoiceIds: string[],
): Promise<Record<string, unknown> | null> {
  const ids = [...new Set(invoiceIds)].filter(Boolean).slice(0, 25);
  if (ids.length === 0) return null;
  const rows = await db
    .select()
    .from(invoicesTable)
    .where(and(inArray(invoicesTable.id, ids), eq(invoicesTable.propertyId, propertyId)));
  if (rows.length === 0) return null;
  // One pay-link lookup for the whole batch.
  const linkRows = await db
    .select({
      invoiceId: paymentRequestJobsTable.invoiceId,
      token: paymentRequestsTable.token,
      status: paymentRequestsTable.status,
      createdAt: paymentRequestsTable.createdAt,
    })
    .from(paymentRequestJobsTable)
    .innerJoin(paymentRequestsTable, eq(paymentRequestJobsTable.requestId, paymentRequestsTable.id))
    .where(inArray(paymentRequestJobsTable.invoiceId, rows.map((r) => r.id)))
    .orderBy(desc(paymentRequestsTable.createdAt));
  const payByInvoice = new Map<string, string>();
  for (const r of linkRows) {
    if (!r.invoiceId || r.status === "paid" || r.status === "returned") continue;
    if (!payByInvoice.has(r.invoiceId)) payByInvoice.set(r.invoiceId, `${publicBaseUrl()}/pay/${r.token}`);
  }
  const ordered = ids
    .map((id) => rows.find((r) => r.id === id))
    .filter((r): r is (typeof rows)[number] => !!r);
  const invoices = [];
  for (const inv of ordered) {
    let payUrl = payByInvoice.get(inv.id) ?? null;
    if (!payUrl) payUrl = await createPayLinkForInvoice(inv);
    invoices.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      amount: inv.amount + (inv.taxAmount ?? 0),
      status: inv.status,
      dueDate: localDate(inv.dueAt),
      payUrl,
      pdfUrl: `/api/invoices/${inv.id}/pdf`,
    });
  }
  return {
    type: "invoice_batch",
    invoiceIds: invoices.map((i) => i.invoiceId), // refresh source
    invoices,
    count: invoices.length,
    totalAmount: invoices.reduce((s, i) => s + i.amount, 0),
    unpaidAmount: invoices.filter((i) => i.status !== "paid").reduce((s, i) => s + i.amount, 0),
  };
}

/** Bid module: proposal snapshot + line items + PDF view. */
export async function buildBidModule(
  propertyId: string,
  bidId: string,
): Promise<Record<string, unknown> | null> {
  const [bid] = await db
    .select()
    .from(bidsTable)
    .where(and(eq(bidsTable.id, bidId), eq(bidsTable.propertyId, propertyId)));
  if (!bid) return null;
  const items = await db
    .select()
    .from(bidLineItemsTable)
    .where(eq(bidLineItemsTable.bidId, bid.id));
  return {
    type: "bid",
    bidId: bid.id,
    bidNo: bid.bidNo,
    amount: bid.amount,
    status: bid.status,
    unitNo: bid.unitNo ?? null,
    scope: bid.scope ?? null,
    lineItems: items.slice(0, 20).map((i) => ({
      service: i.service,
      description: i.description ?? null,
      qty: i.qty,
      amount: i.amount,
    })),
    lineItemCount: items.length,
    pdfUrl: `/api/bids/${bid.id}/pdf`,
  };
}

/** Document module: a PDF/file the client can view inline. */
export function buildDocumentModule(
  url: string | null,
  label: string | null,
): Record<string, unknown> | null {
  if (!url) return null;
  return { type: "document", url, label: label ?? "Document", isPdf: /\.pdf($|\?)/i.test(url) || url.includes("/pdf") };
}

/**
 * Crew map module: snapshot of live crew activity on this property — pins with
 * GPS from the latest check-ins, scope, units, check-in/out state, tracker
 * links. The client's full-bleed popup uses the LIVE /board/map endpoint; this
 * snapshot keeps the card meaningful even as a static tile.
 */
export async function buildCrewMapModule(
  propertyId: string,
): Promise<Record<string, unknown> | null> {
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (!prop) return null;
  const activeJobs = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.propertyId, propertyId), isNull(jobsTable.clearedAt)));
  const active = activeJobs.filter((j) => j.status !== "complete");
  const crewIds = [...new Set(active.map((j) => j.crewLeaderId).filter((x): x is string => !!x))];
  const jobIds = active.map((j) => j.id);
  const [crews, checkins] = await Promise.all([
    crewIds.length
      ? db.select().from(crewsTable).where(inArray(crewsTable.id, crewIds))
      : Promise.resolve([]),
    jobIds.length
      ? db
          .select()
          .from(crewCheckinsTable)
          .where(inArray(crewCheckinsTable.jobId, jobIds))
          .orderBy(desc(crewCheckinsTable.createdAt))
          .limit(200)
      : Promise.resolve([]),
  ]);
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const lastByJob = new Map<string, (typeof checkins)[number]>();
  for (const c of checkins) {
    if (c.jobId && !lastByJob.has(c.jobId)) lastByJob.set(c.jobId, c);
  }
  const now = Date.now();
  const crewsOut = active
    .filter((j) => j.crewLeaderId)
    .map((j) => {
      const crew = crewById.get(j.crewLeaderId!);
      const last = lastByJob.get(j.id);
      const onSite =
        !!last && last.kind !== "checkout" && now - new Date(last.createdAt).getTime() < 4 * 3_600_000;
      return {
        crewName: crew?.name ?? "Crew",
        crewTrade: crew?.trade ?? null,
        selfieUrl: crew?.selfiePath ? `/api/storage${crew.selfiePath}` : null,
        jobNo: j.jobNo,
        scope: j.description ?? null,
        unitNo: j.unitNo ?? null,
        onSite,
        lastCheckinKind: last?.kind ?? null,
        lastCheckinAt: last ? last.createdAt.toISOString() : null,
        trackerUrl: j.trackerToken ? `${publicBaseUrl()}/track/${j.trackerToken}` : null,
        lat: last?.lat ?? null,
        lng: last?.lng ?? null,
      };
    });
  return {
    type: "crewmap",
    propertyName: prop.name,
    propertyAddress: prop.address ?? null,
    lat: prop.latitude ?? null,
    lng: prop.longitude ?? null,
    crews: crewsOut,
    onSiteCount: crewsOut.filter((c) => c.onSite).length,
    snapshotAt: new Date().toISOString(),
    // Client opens the live full-bleed map (board/map endpoint) from this card.
    live: true,
  };
}

/** Tracker module: live crew GPS page + scope for one job. */
export async function buildTrackerModule(
  propertyId: string,
  jobId: string,
): Promise<Record<string, unknown> | null> {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.propertyId, propertyId)));
  if (!job || !job.trackerToken) return null;
  return {
    type: "tracker",
    jobId: job.id,
    jobNo: job.jobNo,
    unitNo: job.unitNo ?? null,
    scope: job.description ?? null,
    trackerUrl: `${publicBaseUrl()}/track/${job.trackerToken}`,
  };
}

/** Flags module: checked flags across this property's job summaries, by unit. */
export async function buildFlagsModule(
  propertyId: string,
): Promise<Record<string, unknown>> {
  const summaries = await db
    .select()
    .from(jobSummariesTable)
    .where(eq(jobSummariesTable.propertyId, propertyId));
  const jobIds = summaries.map((s) => s.jobId).filter((x): x is string => !!x);
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const unitByJob = new Map(jobs.map((j) => [j.id, j.unitNo ?? null]));
  const items: { unit: string | null; label: string }[] = [];
  for (const s of summaries) {
    const flagged = (s.flags ?? []).filter((f) => f.checked);
    for (const f of flagged) {
      items.push({
        unit: (s.jobId ? unitByJob.get(s.jobId) : null) ?? null,
        label: f.label,
      });
    }
  }
  // Stable, unit-grouped order; cap so a card stays a snapshot, not a report.
  items.sort((a, b) => (a.unit ?? "~").localeCompare(b.unit ?? "~"));
  return { type: "flags", items: items.slice(0, 12), totalCount: items.length, canSchedule: true };
}

/** Summary module: job recap snapshot + public recap page link. */
export async function buildSummaryModule(
  propertyId: string,
  summaryId: string,
): Promise<Record<string, unknown> | null> {
  const [s] = await db
    .select()
    .from(jobSummariesTable)
    .where(and(eq(jobSummariesTable.id, summaryId), eq(jobSummariesTable.propertyId, propertyId)));
  if (!s) return null;
  const checked = (s.checklist ?? []).flatMap((sec) => sec.items ?? []).filter((i) => i.checked).length;
  const totalItems = (s.checklist ?? []).flatMap((sec) => sec.items ?? []).length;
  return {
    type: "summary",
    summaryId: s.id,
    title: s.title,
    unitNo: s.unitNumber ?? null,
    serviceDate: s.serviceDate ?? null,
    crewLead: s.crewLead ?? null,
    result: s.overallResult,
    checkedCount: checked,
    itemCount: totalItems,
    flagCount: (s.flags ?? []).filter((f) => f.checked).length,
    photoCount: (s.photos ?? []).length,
    summaryUrl: `${publicBaseUrl()}/summary/${s.token}`,
    // Full before/after photo set — the client views these right on the card.
    photos: (s.photos ?? []).slice(0, 24).map((p) => ({
      phase: p.phase,
      url: `/api/storage${p.path}`,
    })),
    // Flagged attention items with crew notes, viewable inline.
    flaggedItems: (s.flags ?? [])
      .filter((f) => f.checked)
      .slice(0, 12)
      .map((f) => ({ label: f.label, note: f.note || null })),
    observations: s.observations ?? null,
    // Full task list for the expanded card view (capped — card stays a snapshot).
    taskSections: (s.checklist ?? []).slice(0, 8).map((sec) => ({
      title: sec.section,
      items: (sec.items ?? []).slice(0, 12).map((i) => ({ label: i.label, checked: !!i.checked })),
    })),
  };
}

/** Photos module: job photo set (crew photos), thumbnail strip + count. */
export async function buildPhotosModule(
  propertyId: string,
  jobId: string,
): Promise<Record<string, unknown> | null> {
  const [job] = await db
    .select()
    .from(jobsTable)
    .where(and(eq(jobsTable.id, jobId), eq(jobsTable.propertyId, propertyId)));
  if (!job) return null;
  const photos = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.jobId, job.id))
    .orderBy(desc(crewPhotosTable.createdAt));
  if (photos.length === 0) return null;
  return {
    type: "photos",
    jobId: job.id,
    jobNo: job.jobNo,
    unitNo: job.unitNo ?? null,
    totalCount: photos.length,
    // Thumbnail strip stays a snapshot — the card links to the full set.
    photoUrls: photos.slice(0, 6).map((p) => `/api/storage${p.storagePath}`),
    phases: [...new Set(photos.map((p) => p.phase).filter(Boolean))],
  };
}

/** Simple link module (photos / summary / manual with a link). */
export function buildLinkModule(
  type: "photos" | "link",
  url: string | null,
  label: string | null,
): Record<string, unknown> | null {
  if (!url) return null;
  return { type, url, label: label ?? "Open" };
}

/** Referral module: client fills a mini form, office gets notified. */
export function buildReferralModule(): Record<string, unknown> {
  return { type: "referral", canRefer: true };
}
