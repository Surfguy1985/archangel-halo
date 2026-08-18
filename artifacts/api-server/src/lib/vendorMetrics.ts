/**
 * Per-vendor performance numbers for the vendors module.
 *
 * Two averages, both deliberately explicit about having no data: the module
 * shows "No data yet" rather than a 0 or a dash that reads like a real
 * measurement, so `null` here means "nothing attributable", never "zero days".
 *
 * Attribution: vendors do not touch jobs directly — they reach them through
 * their purchase orders. So a sub's turn time is measured over the jobs its
 * POs point at, and a vendor with POs but no completed job simply has no turn
 * sample. Our own organization has no POs, so its work is measured from the
 * jobs our crews completed, falling back to the client turn records when
 * there are no such jobs.
 *
 * Pure computation lives in vendorMetricsCore.ts and is covered by unit tests
 * there. This module owns the DB fetches only.
 */

import { db, purchaseOrdersTable, jobsTable, clientTurnsTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";
import { computeVendorMetricsFromData, jobTurnDays } from "./vendorMetricsCore";

export type VendorMetrics = {
  /** Mean days from PO created to received. Null when nothing is received. */
  avgPoDays: number | null;
  avgPoSamples: number;
  /** Mean days a piece of work took. Null when nothing is attributable. */
  avgTurnDays: number | null;
  avgTurnSamples: number;
};

export const NO_VENDOR_METRICS: VendorMetrics = {
  avgPoDays: null,
  avgPoSamples: 0,
  avgTurnDays: null,
  avgTurnSamples: 0,
};

/**
 * Computes both averages for every vendor in one pass.
 *
 * @param inHouseVendorIds vendors that are our own organization — they are
 *   measured from our crews' jobs instead of through purchase orders.
 */
export async function computeVendorMetrics(
  inHouseVendorIds: string[],
): Promise<Map<string, VendorMetrics>> {
  const [pos, jobs] = await Promise.all([
    db
      .select({
        vendorId: purchaseOrdersTable.vendorId,
        jobId: purchaseOrdersTable.jobId,
        createdAt: purchaseOrdersTable.createdAt,
        receivedAt: purchaseOrdersTable.receivedAt,
      })
      .from(purchaseOrdersTable),
    db
      .select({
        id: jobsTable.id,
        status: jobsTable.status,
        crewLeaderId: jobsTable.crewLeaderId,
        createdAt: jobsTable.createdAt,
        completedAt: jobsTable.completedAt,
      })
      .from(jobsTable)
      .where(isNotNull(jobsTable.completedAt)),
  ]);

  // In-house vendor falls back to client turns when no staffed completed jobs.
  // Fetch lazily only if needed (in-house vendor present and no staffed jobs).
  const inHouse = new Set(inHouseVendorIds);
  let clientTurns: { actualVacateAt: Date | null; readyAt: Date | null }[] = [];
  if (inHouse.size > 0) {
    // Match the core's valid-staffed-turn predicate exactly: crewLeaderId
    // present AND the span is non-null (non-cancelled, non-negative,
    // fully-filled). A job that passes only the crewLeaderId check but is
    // cancelled or half-filled will be excluded by the core, so we must
    // still fetch client turns to use as the fallback.
    const hasStaffed = jobs.some(
      (j) => j.crewLeaderId !== null && jobTurnDays(j) !== null,
    );
    if (!hasStaffed) {
      clientTurns = await db
        .select({
          actualVacateAt: clientTurnsTable.actualVacateAt,
          readyAt: clientTurnsTable.readyAt,
        })
        .from(clientTurnsTable)
        .where(isNotNull(clientTurnsTable.readyAt));
    }
  }

  return computeVendorMetricsFromData(pos, jobs, clientTurns, inHouseVendorIds);
}
