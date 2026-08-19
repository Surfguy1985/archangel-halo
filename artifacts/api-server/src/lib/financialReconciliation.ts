import { and, eq, isNull, inArray } from "drizzle-orm";
import { db, jobsTable, invoicesTable, invoiceLineItemsTable, masterPriceListTable, discrepanciesTable, reconciliationRunsTable } from "@workspace/db";
import { logger } from "./logger";
import { dollars, normalizeServiceCode, classifyLineVariance, validateResolveInput } from "./financialReconciliationCore";
async function getMasterRate(serviceCode: string, unitType = "2br") {
  const rows = await db.select().from(masterPriceListTable).where(and(eq(masterPriceListTable.serviceCode, serviceCode), eq(masterPriceListTable.isActive, true)));
  return rows.find((r) => r.unitType === unitType) || rows.find((r) => r.unitType === "flat") || rows.find((r) => r.unitType === "bid") || null;
}
export async function reconcileJob(jobId: string): Promise<number> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId)).limit(1);
  if (!job) return 0;
  const invoices = await db.select().from(invoicesTable).where(eq(invoicesTable.jobId, jobId));
  const invoice = invoices[0] ?? null;
  let written = 0;
  const push = async (row: any) => {
    const existing = await db.select({ id: discrepanciesTable.id }).from(discrepanciesTable).where(and(
      eq(discrepanciesTable.jobId, jobId), eq(discrepanciesTable.type, row.type),
      row.serviceCode ? eq(discrepanciesTable.serviceCode, row.serviceCode) : isNull(discrepanciesTable.serviceCode),
      eq(discrepanciesTable.status, "open"),
    )).limit(1);
    if (existing.length) return;
    await db.insert(discrepanciesTable).values({
      jobId, invoiceId: invoice?.id ?? null, type: row.type, serviceCode: row.serviceCode ?? null,
      expectedCents: row.expectedCents ?? null, actualCents: row.actualCents ?? null, varianceCents: row.varianceCents ?? null,
      severity: row.severity, status: "open", explanation: row.explanation, suggestedFix: row.suggestedFix ?? null,
    });
    written++;
  };
  if (!invoice && ["complete", "completed", "billing"].includes(job.boardStatus || job.status || "")) {
    await push({ type: "missing_invoice", severity: "high", explanation: "Job is complete but has no invoice." });
  }
  if (invoice) {
    const lines = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, invoice.id));
    for (const line of lines) {
      const serviceCode = normalizeServiceCode(line.typeOfWork || "");
      const actualCents = Math.round((line.unitPrice || 0) * 100);
      const master = await getMasterRate(serviceCode);
      const classified = classifyLineVariance({ actualCents, masterRateCents: master?.rateCents ?? null, masterUnitType: master?.unitType });
      if (!classified) continue;
      if (!master) {
        if (classified.type === "zero_or_missing") await push({ type: classified.type, severity: classified.severity, serviceCode, actualCents: 0, explanation: `Service "${line.typeOfWork}" is $0 and not in Master Price List.` });
        continue;
      }
      await push({
        type: classified.type, severity: classified.severity, serviceCode,
        expectedCents: master.rateCents, actualCents, varianceCents: classified.varianceCents,
        explanation: classified.type === "zero_or_missing" ? `"${master.name}" is $0. Master expects ${dollars(master.rateCents)}.` : `"${master.name}" invoiced at ${dollars(actualCents)}; Master expects ${dollars(master.rateCents)}.`,
        suggestedFix: { recommendedInvoiceCents: master.rateCents },
      });
    }
  }
  return written;
}
export async function runReconciliationForJob(jobId: string) { return reconcileJob(jobId); }
export async function runReconciliation(triggeredBy = "scheduler") {
  const [run] = await db.insert(reconciliationRunsTable).values({ triggeredBy, jobsScanned: 0, discrepanciesFound: 0 }).returning();
  const jobs = await db.select({ id: jobsTable.id }).from(jobsTable).where(inArray(jobsTable.boardStatus, ["completed", "billing", "complete"])).limit(200);
  let total = 0;
  for (const j of jobs) { try { total += await reconcileJob(j.id); } catch (err) { logger.error({ err, jobId: j.id }, "reconcileJob failed"); } }
  await db.update(reconciliationRunsTable).set({ finishedAt: new Date(), jobsScanned: jobs.length, discrepanciesFound: total }).where(eq(reconciliationRunsTable.id, run.id));
  return { jobsScanned: jobs.length, discrepanciesFound: total };
}
export async function resolveDiscrepancy(opts: {
  discrepancyId: string; newInvoiceCents?: number | null; newPayoutCents?: number | null;
  reason: string; resolvedBy: string; mode: "apply" | "pending" | "dismiss";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const [disc] = await db.select().from(discrepanciesTable).where(eq(discrepanciesTable.id, opts.discrepancyId)).limit(1);
  if (!disc) return { ok: false, error: "Discrepancy not found" };
  const validation = validateResolveInput({ mode: opts.mode, reason: opts.reason, newInvoiceCents: opts.newInvoiceCents, newPayoutCents: opts.newPayoutCents, currentStatus: disc.status });
  if (!validation.ok) return validation;
  if (opts.mode === "dismiss") {
    await db.update(discrepanciesTable).set({ status: "dismissed", adminReason: opts.reason, resolvedBy: opts.resolvedBy, resolvedAt: new Date() }).where(eq(discrepanciesTable.id, opts.discrepancyId));
    return { ok: true };
  }
  if (opts.mode === "pending") {
    await db.update(discrepanciesTable).set({ status: "pending_review", adminOverrideCents: opts.newInvoiceCents ?? null, adminReason: opts.reason || null }).where(eq(discrepanciesTable.id, opts.discrepancyId));
    return { ok: true };
  }
  if (disc.invoiceId && opts.newInvoiceCents != null) {
    const lines = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, disc.invoiceId));
    const target = lines.find((l) => normalizeServiceCode(l.typeOfWork || "") === disc.serviceCode) || lines.find((l) => !l.unitPrice || l.unitPrice === 0) || lines[0];
    const dollarsAmt = opts.newInvoiceCents / 100;
    if (target) {
      await db.update(invoiceLineItemsTable).set({ unitPrice: dollarsAmt, amount: dollarsAmt * (target.qty || 1) }).where(eq(invoiceLineItemsTable.id, target.id));
      const all = await db.select().from(invoiceLineItemsTable).where(eq(invoiceLineItemsTable.invoiceId, disc.invoiceId));
      await db.update(invoicesTable).set({ amount: all.reduce((s, l) => s + (l.amount || 0), 0) }).where(eq(invoicesTable.id, disc.invoiceId));
    }
  }
  if (opts.newPayoutCents != null) {
    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, disc.jobId)).limit(1);
    if (job) {
      const crewPay = Array.isArray(job.crewPay) ? [...(job.crewPay as any[])] : [];
      const amt = opts.newPayoutCents / 100;
      if (crewPay.length) crewPay[0] = { ...crewPay[0], amount: amt };
      else crewPay.push({ name: "Adjusted", amount: amt });
      await db.update(jobsTable).set({ crewPay }).where(eq(jobsTable.id, disc.jobId));
    }
  }
  await db.update(discrepanciesTable).set({ status: "adjusted", adminOverrideCents: opts.newInvoiceCents ?? opts.newPayoutCents ?? null, adminReason: opts.reason || "Applied", resolvedBy: opts.resolvedBy, resolvedAt: new Date() }).where(eq(discrepanciesTable.id, opts.discrepancyId));
  return { ok: true };
}
