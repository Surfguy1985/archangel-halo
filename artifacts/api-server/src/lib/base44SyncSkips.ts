/**
 * Skip tracker for the Base44 → HALO sync.
 *
 * Sync guard clauses used to `continue` silently, so upstream rows the Work
 * App was still serving (including paid crew jobs) disappeared on every run
 * with no error, no log and no count — undetected across 881 runs. Every
 * guard must call `noteSkip` instead of bailing bare, so unplaced rows are
 * counted per run and rolled into the sync result.
 *
 * Pure state, no I/O — kept separate from base44Sync.ts so tests can lock the
 * accounting behaviour in without a database.
 */

/**
 * An upstream row the sync could not place — missing id, unresolvable
 * property, and so on.
 */
export interface SyncSkip {
  resource: string;
  base44Id: string | null;
  reason: string;
}

/**
 * Cap on retained skip detail. Counts are always exact; only the per-row
 * detail is bounded, so a malformed or vastly expanded snapshot can't pin
 * every skipped row in memory and dump it into the status response.
 */
export const MAX_SKIP_DETAIL = 200;

let skipLog: SyncSkip[] = [];
let skipCount = 0;
let skipByResource: Record<string, number> = {};
let skipByReason: Record<string, number> = {};

/** Clear all per-run skip state. Called at the start of each sync run. */
export function resetSkips(): void {
  skipLog = [];
  skipCount = 0;
  skipByResource = {};
  skipByReason = {};
}

/** Record an unplaceable upstream row. Counts are exact; detail is capped. */
export function noteSkip(resource: string, base44Id: string | null, reason: string): void {
  skipCount += 1;
  skipByResource[resource] = (skipByResource[resource] ?? 0) + 1;
  const key = `${resource}:${reason}`;
  skipByReason[key] = (skipByReason[key] ?? 0) + 1;
  if (skipLog.length < MAX_SKIP_DETAIL) skipLog.push({ resource, base44Id, reason });
}

/**
 * Unplaced rows from the most recent run, for the sync status surface.
 * Returns copies — callers must not be able to mutate operational state.
 */
export function getLastSyncSkips(): SyncSkip[] {
  return skipLog.map((s) => ({ ...s }));
}

export interface SkipSummary {
  /** Exact total, never capped. */
  total: number;
  /** Exact per-resource counts, never capped. */
  byResource: Record<string, number>;
  /** Exact per-`resource:reason` counts, never capped. */
  byReason: Record<string, number>;
  /** True when `total` exceeds the retained detail list. */
  detailTruncated: boolean;
}

/**
 * Exact skip accounting for the current run.
 * Returns copies — callers must not be able to mutate operational state.
 */
export function getSkipSummary(): SkipSummary {
  return {
    total: skipCount,
    byResource: { ...skipByResource },
    byReason: { ...skipByReason },
    detailTruncated: skipCount > skipLog.length,
  };
}

/**
 * Fold unplaced-row counts into per-resource sync stats so they show up next
 * to the counts they were missing from, and return the exact grand total.
 * Driven by the exact counters, not the capped detail list.
 */
export function foldSkipsIntoResources(
  resources: Record<string, { created: number; updated: number; errors: number; skipped?: number }>,
): number {
  for (const [resource, count] of Object.entries(skipByResource)) {
    const bucket = (resources[resource] ??= { created: 0, updated: 0, errors: 0 });
    bucket.skipped = (bucket.skipped ?? 0) + count;
  }
  return skipCount;
}
