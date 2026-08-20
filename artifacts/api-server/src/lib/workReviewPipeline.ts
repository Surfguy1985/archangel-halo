
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  db, jobsTable, workReviewsTable, workReportCardsTable,
  invoicesTable, invoiceLineItemsTable, masterPriceListTable, crewPayoutMasterTable,
} from "@workspace/db";
import { logger } from "./logger";
import { buildWorkVerification } from "./workVerification";
import { ensureWorkReviewsSchema } from "./ensureWorkReviewsSchema";
import { pushPricingAlertToBase44 } from "./base44Write";
import { normalizeServiceCode } from "./financialReconciliationCore";
import { recomputeJobFinancials } from "./jobFinance";

export type MarginLine = { serviceCode: string; label: string; invoiceCents: number; crewCents: number; marginCents: number; marginPct: number | null };
export type MarginReport = { lines: MarginLine[]; invoiceTotalCents: number; crewTotalCents: number; marginTotalCents: number; marginPct: number | null; currency: "USD"; generatedAt: string };

async function ensure() { await ensureWorkReviewsSchema(); }

export async function saveReportCard(opts: {
  reviewId?: string | null; jobId: string; jobNo?: string | null; unitNo?: string | null;
  stage: string; title: string; summary?: string; card: any; marginReport?: any; actor?: string | null;
}) {
  await ensure();
  const [row] = await db.insert(workReportCardsTable).values({
    reviewId: opts.reviewId || null, jobId: opts.jobId, jobNo: opts.jobNo || null, unitNo: opts.unitNo || null,
    stage: opts.stage, title: opts.title, summary: opts.summary || null, card: opts.card,
    marginReport: opts.marginReport || null, actor: opts.actor || null,
  }).returning();
  logger.info({ id: row.id, stage: opts.stage, jobId: opts.jobId }, "report card saved to history");
  return row;
}

async function getMasterInvoice(code: string) {
  const rows = await db.select().from(masterPriceListTable).where(eq(masterPriceListTable.serviceCode, code));
  return rows.find((r) => r.unitType === "2br") || rows.find((r) => r.unitType === "flat") || rows[0] || null;
}
async function getMasterCrew(code: string) {
  const rows = await db.select().from(crewPayoutMasterTable).where(eq(crewPayoutMasterTable.serviceCode, code));
  return rows.find((r) => r.unitType === "2br") || rows.find((r) => r.unitType === "flat") || rows[0] || null;
}

export async function buildMarginReport(jobId: string, fieldEdits?: any): Promise<MarginReport> {
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.jobId, jobId));
  const invoice = invoices[0];
  const invLines = invoice ? await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id)) : [];
  const priceOverride = new Map((fieldEdits?.linePrices || []).map((p: any) => [normalizeServiceCode(p.serviceCode), p.invoiceCents]));
  const lines: MarginLine[] = [];
  for (const line of invLines) {
    const code = normalizeServiceCode(line.typeOfWork || line.description || "");
    const label = line.typeOfWork || line.description || code;
    let invoiceCents = (priceOverride.get(code) as number | undefined) ?? Math.round((Number(line.unitPrice) || 0) * 100);
    const mi = await getMasterInvoice(code);
    if (invoiceCents === 0 && mi?.rateCents) invoiceCents = mi.rateCents;
    const crewCents = (await getMasterCrew(code))?.rateCents ?? 0;
    lines.push({ serviceCode: code, label, invoiceCents, crewCents, marginCents: invoiceCents - crewCents, marginPct: invoiceCents > 0 ? (invoiceCents - crewCents) / invoiceCents : null });
  }
  for (const [code, cents] of priceOverride) {
    if (lines.some((l) => l.serviceCode === code)) continue;
    const c = cents as number;
    const crewCents = (await getMasterCrew(code as string))?.rateCents ?? 0;
    lines.push({ serviceCode: code as string, label: code as string, invoiceCents: c, crewCents, marginCents: c - crewCents, marginPct: c > 0 ? (c - crewCents) / c : null });
  }
  const invoiceTotalCents = lines.reduce((s, l) => s + l.invoiceCents, 0);
  const crewTotalCents = lines.reduce((s, l) => s + l.crewCents, 0);
  return { lines, invoiceTotalCents, crewTotalCents, marginTotalCents: invoiceTotalCents - crewTotalCents, marginPct: invoiceTotalCents > 0 ? (invoiceTotalCents - crewTotalCents) / invoiceTotalCents : null, currency: "USD", generatedAt: new Date().toISOString() };
}

async function applyBotMoney(jobId: string, margin: MarginReport, fieldEdits?: any) {
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.jobId, jobId));
  const invoice = invoices[0];
  if (invoice) {
    const invLines = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id));
    for (const line of invLines) {
      const code = normalizeServiceCode(line.typeOfWork || line.description || "");
      const m = margin.lines.find((l) => l.serviceCode === code);
      if (!m) continue;
      const d = m.invoiceCents / 100;
      await db.update(invoiceLineItemsTable).set({ unitPrice: d, amount: d * (line.qty || 1) }).where(eq(invoiceLineItemsTable.id, line.id));
    }
    const all = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id));
    await db.update(invoicesTable).set({ amount: all.reduce((s, l) => s + (Number(l.amount) || 0), 0) }).where(eq(invoicesTable.id, invoice.id));
  }
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (job) {
    const crewPay = margin.lines.filter((l) => l.crewCents > 0).map((l) => {
      const a = (fieldEdits?.crewAssignments || []).find((c: any) => normalizeServiceCode(c.serviceCode) === l.serviceCode);
      return { name: a?.crewName || l.label, serviceCode: l.serviceCode, amount: l.crewCents / 100, crewId: a?.crewId || null };
    });
    const crewRate = crewPay.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    await db.update(jobsTable).set({ crewPay, crewRate }).where(eq(jobsTable.id, jobId));
    try { await recomputeJobFinancials(jobId); } catch { /* */ }
  }
}

export async function openFieldReview(jobId: string, trigger = "dispatch_scan") {
  await ensure();
  const verification = await buildWorkVerification(jobId);
  const existing = await db.select().from(workReviewsTable).where(and(eq(workReviewsTable.jobId, jobId), inArray(workReviewsTable.status, ["pending_field", "needs_fix"]))).orderBy(desc(workReviewsTable.createdAt)).limit(1);
  const saveOpen = async (reviewId: string) => {
    await saveReportCard({
      reviewId, jobId, jobNo: verification?.jobNo, unitNo: verification?.unitNo, stage: "field_opened",
      title: `Field accuracy card · ${verification?.jobNo || jobId.slice(0, 8)}`, summary: verification?.summary || "Field review opened", actor: "bot",
      card: { version: 1, stage: "field_opened", jobId, jobNo: verification?.jobNo, unitNo: verification?.unitNo, reviewId, verification, crew: (verification?.lines || []).map((l: any) => ({ service: l.label, crewName: l.assignedCrewName })), services: (verification?.lines || []).map((l: any) => l.label), prices: (verification?.lines || []).map((l: any) => ({ service: l.label, invoiceCents: l.actualInvoiceCents, masterCents: l.expectedInvoiceCents })), actor: "bot", timestamps: { openedAt: new Date().toISOString() } },
    });
  };
  if (existing[0]) {
    await db.update(workReviewsTable).set({ verificationSnapshot: verification as any, updatedAt: new Date(), fieldNotifiedAt: new Date() }).where(eq(workReviewsTable.id, existing[0].id));
    await saveOpen(existing[0].id);
    if (verification) await pushPricingAlertToBase44({ jobId, jobNo: verification.jobNo, verification: { ...verification, reviewId: existing[0].id, requiresFieldAck: true } as any }).catch(() => null);
    return { reviewId: existing[0].id, verification, alreadyOpen: true };
  }
  const [row] = await db.insert(workReviewsTable).values({ jobId, status: "pending_field", trigger, verificationSnapshot: verification as any, fieldNotifiedAt: new Date() }).returning();
  await saveOpen(row.id);
  if (verification) await pushPricingAlertToBase44({ jobId, jobNo: verification.jobNo, verification: { ...verification, reviewId: row.id, requiresFieldAck: true } as any }).catch(() => null);
  return { reviewId: row.id, verification, alreadyOpen: false };
}

export async function scanDispatchForReview(limit = 50) {
  await ensure();
  const jobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(or(inArray(jobsTable.boardStatus, ["completed", "complete", "billing", "done"]), inArray(jobsTable.status, ["complete", "completed"]))).orderBy(desc(jobsTable.createdAt)).limit(limit);
  let opened = 0, refreshed = 0; const jobIds: string[] = [];
  for (const j of jobs) {
    const done = await db.select({ id: workReviewsTable.id }).from(workReviewsTable).where(and(eq(workReviewsTable.jobId, j.id), inArray(workReviewsTable.status, ["sent_to_invoice", "margin_ready"]))).limit(1);
    if (done.length) continue;
    const r = await openFieldReview(j.id, "dispatch_scan");
    jobIds.push(j.id); if (r.alreadyOpen) refreshed++; else opened++;
  }
  return { scanned: jobs.length, opened, refreshed, jobIds };
}

export async function submitFieldReview(opts: { reviewId: string; submittedBy?: string; edits?: any }) {
  await ensure();
  const [review] = await db.select().from(workReviewsTable).where(eq(workReviewsTable.id, opts.reviewId)).limit(1);
  if (!review) return { ok: false as const, error: "Review not found" };
  if (!["pending_field", "needs_fix"].includes(review.status)) return { ok: false as const, error: `Review is ${review.status}` };
  await db.update(workReviewsTable).set({ status: "field_submitted", fieldEdits: opts.edits || { confirmAccurate: true }, fieldSubmittedAt: new Date(), fieldSubmittedBy: opts.submittedBy || "field", updatedAt: new Date() }).where(eq(workReviewsTable.id, opts.reviewId));
  const v = review.verificationSnapshot as any;
  await saveReportCard({
    reviewId: review.id, jobId: review.jobId, jobNo: v?.jobNo, unitNo: v?.unitNo, stage: "field_submitted",
    title: `Field submitted · ${v?.jobNo || review.jobId.slice(0, 8)}`, summary: "Field confirmed accuracy with edits", actor: opts.submittedBy || "field",
    card: { version: 1, stage: "field_submitted", jobId: review.jobId, reviewId: review.id, fieldEdits: opts.edits, verification: v, actor: opts.submittedBy || "field", timestamps: { fieldSubmittedAt: new Date().toISOString() } },
  });
  return botFinalizeReview(opts.reviewId);
}

export async function botFinalizeReview(reviewId: string) {
  await ensure();
  const [review] = await db.select().from(workReviewsTable).where(eq(workReviewsTable.id, reviewId)).limit(1);
  if (!review) return { ok: false as const, error: "Review not found" };
  await db.update(workReviewsTable).set({ status: "bot_reviewing", updatedAt: new Date() }).where(eq(workReviewsTable.id, reviewId));
  const verification = await buildWorkVerification(review.jobId);
  const fieldEdits = review.fieldEdits as any;
  const margin = await buildMarginReport(review.jobId, fieldEdits);
  const blocking = (verification?.suggestions || []).filter((s) => s.action !== "confirm_clean" && s.action !== "create_invoice" && (s.severity === "high" || s.severity === "critical"));
  if (blocking.length > 0 && margin.invoiceTotalCents === 0) {
    const notes = `Bot held: ${blocking.map((b) => b.title).join("; ")}`;
    await db.update(workReviewsTable).set({ status: "needs_fix", botDecision: "needs_fix", botNotes: notes, botFinalSnapshot: verification as any, marginReport: margin as any, updatedAt: new Date() }).where(eq(workReviewsTable.id, reviewId));
    await saveReportCard({ reviewId, jobId: review.jobId, jobNo: verification?.jobNo, stage: "needs_fix", title: `Bot held · ${verification?.jobNo || review.jobId.slice(0, 8)}`, summary: notes, marginReport: margin, actor: "bot", card: { version: 1, stage: "needs_fix", jobId: review.jobId, reviewId, marginReport: margin, botNotes: notes, actor: "bot" } });
    return { ok: true as const, decision: "needs_fix", notes, marginReport: margin, reviewId };
  }
  try { await applyBotMoney(review.jobId, margin, fieldEdits); } catch (err) { logger.error({ err, reviewId }, "applyBotMoney failed"); }
  const notes = `Bot final: invoice $${(margin.invoiceTotalCents / 100).toFixed(2)} · crew $${(margin.crewTotalCents / 100).toFixed(2)} · margin ${margin.marginPct != null ? (margin.marginPct * 100).toFixed(1) + "%" : "—"}`;
  await db.update(workReviewsTable).set({ status: "margin_ready", botDecision: "approve", botNotes: notes, botFinalSnapshot: verification as any, marginReport: margin as any, updatedAt: new Date() }).where(eq(workReviewsTable.id, reviewId));
  await saveReportCard({ reviewId, jobId: review.jobId, jobNo: verification?.jobNo, stage: "bot_final", title: `Bot final + margin · ${verification?.jobNo || review.jobId.slice(0, 8)}`, summary: notes, marginReport: margin, actor: "bot", card: { version: 1, stage: "bot_final", jobId: review.jobId, reviewId, marginReport: margin, verification, fieldEdits, botNotes: notes, totals: { invoiceCents: margin.invoiceTotalCents, crewCents: margin.crewTotalCents, marginCents: margin.marginTotalCents, marginPct: margin.marginPct }, actor: "bot" } });
  await saveReportCard({ reviewId, jobId: review.jobId, jobNo: verification?.jobNo, stage: "margin_ready", title: `Margin report · ${verification?.jobNo || review.jobId.slice(0, 8)}`, summary: `Overall margin ${margin.marginPct != null ? (margin.marginPct * 100).toFixed(1) + "%" : "—"}`, marginReport: margin, actor: "bot", card: { version: 1, stage: "margin_ready", jobId: review.jobId, reviewId, marginReport: margin, totals: { invoiceCents: margin.invoiceTotalCents, crewCents: margin.crewTotalCents, marginCents: margin.marginTotalCents, marginPct: margin.marginPct }, actor: "bot" } });
  return { ok: true as const, decision: "margin_ready", notes, marginReport: margin, reviewId };
}

export async function completeReviewToInvoice(reviewId: string, actor = "office") {
  await ensure();
  const [review] = await db.select().from(workReviewsTable).where(eq(workReviewsTable.id, reviewId)).limit(1);
  if (!review) return { ok: false as const, error: "Review not found" };
  if (!["margin_ready", "approved_for_invoice"].includes(review.status)) return { ok: false as const, error: `Must be margin_ready (is ${review.status})` };
  await db.update(workReviewsTable).set({ status: "sent_to_invoice", invoiceQueuedAt: new Date(), updatedAt: new Date() }).where(eq(workReviewsTable.id, reviewId));
  const margin = review.marginReport as any;
  const v = review.botFinalSnapshot as any;
  await saveReportCard({ reviewId, jobId: review.jobId, jobNo: v?.jobNo, stage: "completed_to_invoice", title: `Completed → invoicing · ${v?.jobNo || review.jobId.slice(0, 8)}`, summary: "Full report card locked and sent to invoicing queue", marginReport: margin, actor, card: { version: 1, stage: "completed_to_invoice", jobId: review.jobId, reviewId, marginReport: margin, verification: v, fieldEdits: review.fieldEdits, botNotes: review.botNotes, actor, timestamps: { completedAt: new Date().toISOString() } } });
  return { ok: true as const, status: "sent_to_invoice", jobId: review.jobId, marginReport: review.marginReport };
}

export async function listReportCards(opts?: { jobId?: string; stage?: string; limit?: number }) {
  await ensure();
  const limit = opts?.limit || 50;
  if (opts?.jobId) return db.select().from(workReportCardsTable).where(eq(workReportCardsTable.jobId, opts.jobId)).orderBy(desc(workReportCardsTable.createdAt)).limit(limit);
  if (opts?.stage) return db.select().from(workReportCardsTable).where(eq(workReportCardsTable.stage, opts.stage)).orderBy(desc(workReportCardsTable.createdAt)).limit(limit);
  return db.select().from(workReportCardsTable).orderBy(desc(workReportCardsTable.createdAt)).limit(limit);
}
export async function getReportCard(id: string) {
  await ensure();
  const [r] = await db.select().from(workReportCardsTable).where(eq(workReportCardsTable.id, id)).limit(1);
  return r || null;
}
export async function listReviews(status?: string) {
  await ensure();
  if (status) return db.select().from(workReviewsTable).where(eq(workReviewsTable.status, status)).orderBy(desc(workReviewsTable.updatedAt)).limit(100);
  return db.select().from(workReviewsTable).orderBy(desc(workReviewsTable.updatedAt)).limit(100);
}
export async function getReview(id: string) {
  await ensure();
  const [r] = await db.select().from(workReviewsTable).where(eq(workReviewsTable.id, id)).limit(1);
  return r || null;
}
export async function getOpenFieldReviewForJob(jobId: string) {
  await ensure();
  const [r] = await db.select().from(workReviewsTable).where(and(eq(workReviewsTable.jobId, jobId), inArray(workReviewsTable.status, ["pending_field", "needs_fix", "margin_ready"]))).orderBy(desc(workReviewsTable.createdAt)).limit(1);
  return r || null;
}
export async function runReviewAutopilot() {
  const scan = await scanDispatchForReview(40);
  await ensure();
  const stuck = await db.select().from(workReviewsTable).where(eq(workReviewsTable.status, "field_submitted")).limit(30);
  for (const r of stuck) await botFinalizeReview(r.id);
  return { scan, finalized: stuck.length };
}
