/**
 * Pure stats for stall detection and ready-date prediction.
 * No I/O. Segment 2's DB layer feeds these samples.
 */

import type { TurnStage } from "./clientBoardEnums";
import { remainingStages } from "./turnGraph";

export type PredictionConfidence = "high" | "medium" | "low";

export function medianMs(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Nearest-rank percentile in (0, 1]. */
export function percentileNearestRank(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/** Nearest-rank p75. */
export function p75Ms(values: number[]): number | null {
  return percentileNearestRank(values, 0.75);
}

export function p90(values: number[]): number | null {
  return percentileNearestRank(values, 0.9);
}

export function isStalledStage(currentDurationMs: number, stageP75Ms: number | null): boolean {
  if (stageP75Ms == null || stageP75Ms <= 0) return false;
  return currentDurationMs > stageP75Ms;
}

export function confidenceFromSample(n: number): PredictionConfidence {
  if (n >= 30) return "high";
  if (n >= 10) return "medium";
  return "low";
}

/** Fallback durations when a property×bedroom has no history for a stage. */
export const DEFAULT_STAGE_MS: Record<TurnStage, number> = {
  notice: 14 * 86_400_000,
  vacated: 4 * 3_600_000,
  walk: 8 * 3_600_000,
  scoped: 8 * 3_600_000,
  pending_approval: 24 * 3_600_000,
  approved: 2 * 3_600_000,
  scheduled: 24 * 3_600_000,
  in_progress: 72 * 3_600_000,
  qc: 8 * 3_600_000,
  rework: 24 * 3_600_000,
  ready: 0,
};

export type StageSample = {
  stage: TurnStage;
  durationsMs: number[];
};

export type ReadyPrediction = {
  predictedReadyAt: Date;
  confidence: PredictionConfidence;
  sampleSize: number;
  remainingMs: number;
  capacityDelayMs: number;
  method: string;
};

/**
 * Baseline: median remaining stage durations (property × bedroom, caller-filtered).
 * Capacity: extra wait = max(0, queue - weeklyCap) / max(weeklyCap, 1) * 7 days.
 */
export function predictReadyAt(input: {
  current: TurnStage;
  now: Date;
  elapsedInCurrentMs: number;
  samples: StageSample[];
  capacityUnitsPerWeek?: number | null;
  committedQueue?: number | null;
}): ReadyPrediction {
  const remaining = remainingStages(input.current);
  const byStage = new Map(input.samples.map((s) => [s.stage, s.durationsMs]));
  let remainingMs = 0;
  let minN = remaining.length === 0 ? 0 : Infinity;

  for (const stage of remaining) {
    const hist = byStage.get(stage) ?? [];
    minN = Math.min(minN, hist.length);
    const median = medianMs(hist) ?? DEFAULT_STAGE_MS[stage];
    if (stage === input.current) {
      remainingMs += Math.max(0, median - input.elapsedInCurrentMs);
    } else {
      remainingMs += median;
    }
  }
  if (remaining.length === 0) minN = 0;
  if (!Number.isFinite(minN)) minN = 0;

  const cap = input.capacityUnitsPerWeek ?? 0;
  const queue = input.committedQueue ?? 0;
  const overflow = cap > 0 ? Math.max(0, queue - cap) : 0;
  const capacityDelayMs =
    cap > 0 && overflow > 0 ? Math.round((overflow / cap) * 7 * 86_400_000) : 0;

  const totalMs = remainingMs + capacityDelayMs;
  return {
    predictedReadyAt: new Date(input.now.getTime() + totalMs),
    confidence: confidenceFromSample(minN === Infinity ? 0 : minN),
    sampleSize: minN === Infinity ? 0 : minN,
    remainingMs,
    capacityDelayMs,
    method:
      "median remaining-stage duration (property × bedroom, 90d) + queue overflow / weekly capacity × 7d",
  };
}
