import type { OverrideInput, OverrideResult } from "./types";
import type { FoundingWingsConfig } from "../config";
import { clamp } from "./math";

export function overrideRateForMonths(months: number, config: FoundingWingsConfig): number {
  if (months < config.overrides.firstPeriodMonths) return config.overrides.firstRate;
  if (months < config.overrides.secondPeriodMonths) return config.overrides.secondRate;
  return config.overrides.legacyRate;
}

export function qualityMultiplierForScore(score: number): number {
  if (score >= 95) return 1.25;
  if (score >= 90) return 1.1;
  if (score >= 85) return 1;
  if (score >= 75) return 0.5;
  return 0;
}

export function calculateOverride(input: OverrideInput, config: FoundingWingsConfig): OverrideResult {
  if (!Number.isSafeInteger(input.allocatedGrossProfitCents) || input.allocatedGrossProfitCents < 0) {
    throw new Error("allocatedGrossProfitCents must be a non-negative safe integer.");
  }

  const reservePercent = clamp(input.reservePercent, 0, 1);
  const baseRate = overrideRateForMonths(input.sponsorRelationshipMonths, config);
  const qualityMultiplier = qualityMultiplierForScore(input.recruitHaloScore);
  const grossOverrideCents = Math.round(input.allocatedGrossProfitCents * baseRate * qualityMultiplier);
  const reserveAmountCents = Math.round(grossOverrideCents * reservePercent);
  const immediateAmountCents = grossOverrideCents - reserveAmountCents;

  return {
    baseRate,
    qualityMultiplier,
    grossOverrideCents,
    immediateAmountCents,
    reserveAmountCents
  };
}
