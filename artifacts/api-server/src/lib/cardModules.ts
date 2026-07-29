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
  crewPhotosTable,
  invoicesTable,
  jobsTable,
  jobSummariesTable,
  paymentRequestsTable,
  paymentRequestJobsTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";

function publicBaseUrl(): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : "";
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
  return {
    type: "invoice",
    invoiceId: inv.id,
    invoiceNo: inv.invoiceNo,
    amount: inv.amount + (inv.taxAmount ?? 0),
    status: inv.status,
    dueDate: localDate(inv.dueAt),
    payUrl: live ? `${publicBaseUrl()}/pay/${live.token}` : null,
    canApprove: inv.status !== "paid",
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
