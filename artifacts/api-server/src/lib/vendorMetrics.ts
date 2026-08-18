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
 */

import { db, purchaseOrdersTable, jobsTable, clientTurnsTable } from "@workspace/db";
import { isNotNull } from "drizzle-orm";

const DAY_MS = 86_400_000;

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

function mean(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((a, b) => a + b, 0);
  return Math.round((total / samples.length) * 10) / 10;
}

/** Elapsed days between two instants, or null if the pair is unusable. */
function spanDays(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / DAY_MS;
}

/**
 * Same shape as the job turn average the Pulse dashboards show: created to
 * completed, cancelled work excluded, negative or half-filled spans dropped.
 */
function jobTurnDays(job: {
  status: string;
  createdAt: Date | null;
  completedAt: Date | null;
}): number | null {
  if (job.status === "cancelled") return null;
  return spanDays(job.createdAt, job.completedAt);
}

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

  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const poDays = new Map<string, number[]>();
  const turnDays = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, value: number) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };

  // A vendor can have several POs against the same job. Each one is its own
  // PO-cycle sample, but the job's duration must only count once or a vendor
  // who orders twice looks like it did two turns.
  const countedJobs = new Set<string>();

  for (const po of pos) {
    if (!po.vendorId) continue;
    const ordered = spanDays(po.createdAt, po.receivedAt);
    if (ordered !== null) push(poDays, po.vendorId, ordered);

    if (!po.jobId) continue;
    const pair = `${po.vendorId}|${po.jobId}`;
    if (countedJobs.has(pair)) continue;
    const job = jobById.get(po.jobId);
    if (!job) continue;
    const turn = jobTurnDays(job);
    if (turn === null) continue;
    countedJobs.add(pair);
    push(turnDays, po.vendorId, turn);
  }

  const inHouse = new Set(inHouseVendorIds);
  if (inHouse.size > 0) {
    // Our own crews' completed work. Jobs with no crew leader were never
    // staffed to anyone, so they say nothing about how fast we turn units.
    const ourTurns: number[] = [];
    for (const job of jobs) {
      if (!job.crewLeaderId) continue;
      const turn = jobTurnDays(job);
      if (turn !== null) ourTurns.push(turn);
    }

    if (ourTurns.length === 0) {
      // No staffed job history yet — fall back to the client turn records,
      // which measure the same thing from the property's side.
      const turns = await db
        .select({
          actualVacateAt: clientTurnsTable.actualVacateAt,
          readyAt: clientTurnsTable.readyAt,
        })
        .from(clientTurnsTable)
        .where(isNotNull(clientTurnsTable.readyAt));
      for (const t of turns) {
        const span = spanDays(t.actualVacateAt, t.readyAt);
        if (span !== null) ourTurns.push(span);
      }
    }

    for (const id of inHouse) {
      if (ourTurns.length > 0) turnDays.set(id, ourTurns);
    }
  }

  const ids = new Set<string>([...poDays.keys(), ...turnDays.keys()]);
  const out = new Map<string, VendorMetrics>();
  for (const id of ids) {
    const po = poDays.get(id) ?? [];
    const turn = turnDays.get(id) ?? [];
    out.set(id, {
      avgPoDays: mean(po),
      avgPoSamples: po.length,
      avgTurnDays: mean(turn),
      avgTurnSamples: turn.length,
    });
  }
  return out;
}
