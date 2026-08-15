/**
 * Segment 8 — honest, non-ML pipeline forecast math.
 *
 * Vacate volume = scheduled vacates + notices × on-schedule conversion.
 * Duration = property×bedroom historical vacate-to-ready × month seasonal index.
 * Spend band: low = scheduled only; mid = scheduled + converted notices;
 * high = scheduled + all notices. Money stays bigint cents.
 */

import { PIPELINE_TRADES } from "./clientBoardEnums";

export const FORECAST_METHOD =
  "Vacate volume = scheduled vacates + notices × on-schedule conversion. Duration = property×bedroom historical vacate-to-ready × month seasonal index. Spend = those units × historical average turn cost by bedroom. Band: low = scheduled only; mid = scheduled + converted notices; high = scheduled + all notices.";

/** Notices that actually vacated on the scheduled civil day / all notices that vacated. */
export function noticeConversionRate(onScheduleCount: number, vacatedNoticeCount: number): number {
  if (vacatedNoticeCount <= 0) return 0;
  return onScheduleCount / vacatedNoticeCount;
}

/** Month's mean duration / overall mean duration. 1.0 when either side is empty. */
export function seasonalIndex(monthMeanDays: number, overallMeanDays: number): number {
  if (overallMeanDays <= 0 || monthMeanDays <= 0) return 1;
  return monthMeanDays / overallMeanDays;
}

export function applySeasonalDays(baseDays: number, index: number): number {
  return Math.max(0, baseDays * index);
}

/**
 * Crunch ratio. Zero capacity with positive demand is treated as 2.0 so the
 * heatmap still paints as a crunch instead of dividing by zero.
 */
export function crunchRatio(demandUnits: number, declaredCapacityUnits: number): number {
  if (declaredCapacityUnits <= 0) return demandUnits > 0 ? 2 : 0;
  return demandUnits / declaredCapacityUnits;
}

export function isCrunch(ratio: number): boolean {
  return ratio > 1;
}

export type SpendBand = {
  lowCents: string;
  midCents: string;
  highCents: string;
};

/**
 * low = scheduled (high-confidence) cost.
 * mid = scheduled + conversion-weighted notice cost.
 * high = scheduled + every notice at 100% conversion.
 */
export function spendBand(args: {
  scheduledCostCents: bigint;
  noticeCostCents: bigint;
  conversionRate: number;
}): SpendBand {
  const rate = Math.min(1, Math.max(0, args.conversionRate));
  const converted = (args.noticeCostCents * BigInt(Math.round(rate * 10_000))) / 10000n;
  const low = args.scheduledCostCents;
  const mid = args.scheduledCostCents + converted;
  const high = args.scheduledCostCents + args.noticeCostCents;
  return {
    lowCents: low.toString(),
    midCents: mid.toString(),
    highCents: high.toString(),
  };
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, n) => s + n, 0) / values.length;
}

export function tradeFromCategory(category: string | null | undefined): (typeof PIPELINE_TRADES)[number] | null {
  const raw = (category ?? "").trim().toLowerCase();
  if (raw === "paint") return "paint";
  if (raw === "flooring" || raw === "floor") return "flooring";
  if (raw === "clean" || raw === "cleaning") return "clean";
  if (raw === "drywall") return "drywall";
  if (raw === "hvac") return "hvac";
  if (raw === "punch") return "punch";
  return null;
}
