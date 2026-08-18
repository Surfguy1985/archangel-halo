/**
 * Pure (DB-free) computation for vendor performance metrics.
 *
 * Extracted so every arithmetic rule can be covered by unit tests without
 * standing up a database. `vendorMetrics.ts` owns the DB fetches and calls
 * `computeVendorMetricsFromData` with the raw rows.
 */

import type { VendorMetrics } from "./vendorMetrics";

export type PoRow = {
  vendorId: string | null;
  jobId: string | null;
  createdAt: Date | null;
  receivedAt: Date | null;
};

export type JobRow = {
  id: string;
  status: string;
  crewLeaderId: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
};

export type ClientTurnRow = {
  actualVacateAt: Date | null;
  readyAt: Date | null;
};

const DAY_MS = 86_400_000;

export function mean(samples: number[]): number | null {
  if (samples.length === 0) return null;
  const total = samples.reduce((a, b) => a + b, 0);
  return Math.round((total / samples.length) * 10) / 10;
}

/** Elapsed days between two instants, or null if the pair is unusable. */
export function spanDays(from: Date | null, to: Date | null): number | null {
  if (!from || !to) return null;
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / DAY_MS;
}

/**
 * Same shape as the job turn average the Pulse dashboards show: created to
 * completed, cancelled work excluded, negative or half-filled spans dropped.
 */
export function jobTurnDays(job: {
  status: string;
  createdAt: Date | null;
  completedAt: Date | null;
}): number | null {
  if (job.status === "cancelled") return null;
  return spanDays(job.createdAt, job.completedAt);
}

/**
 * Pure computation of vendor metrics from already-fetched rows.
 *
 * Rules:
 * - A vendor with multiple POs against the same job gets one turn sample for
 *   that job (job duration counted once), but each PO is its own PO-cycle
 *   sample (created→received).
 * - Cancelled jobs and negative / half-filled spans are excluded.
 * - No received POs → avgPoDays is null (never 0).
 * - No completed attributable jobs → avgTurnDays is null (never 0).
 * - In-house vendors fall back to clientTurns only when there are no staffed
 *   completed jobs.
 */
export function computeVendorMetricsFromData(
  pos: PoRow[],
  jobs: JobRow[],
  clientTurns: ClientTurnRow[],
  inHouseVendorIds: string[],
): Map<string, VendorMetrics> {
  // Only completed jobs contribute to turn averages.
  const completedJobs = jobs.filter((j) => j.completedAt !== null);
  const jobById = new Map(completedJobs.map((j) => [j.id, j]));

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
    for (const job of completedJobs) {
      if (!job.crewLeaderId) continue;
      const turn = jobTurnDays(job);
      if (turn !== null) ourTurns.push(turn);
    }

    if (ourTurns.length === 0) {
      // No staffed job history yet — fall back to the client turn records,
      // which measure the same thing from the property's side.
      for (const t of clientTurns) {
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
