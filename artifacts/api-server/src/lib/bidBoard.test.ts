/**
 * Segment 7 — bid score math. No DB. At schedule = 100; 2× schedule = 0.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_BID_SCORE_WEIGHTS } from "@workspace/db";
import {
  capacityScore,
  compositeScore,
  normalizeWeights,
  priceVsScheduleScore,
  reworkInvertedScore,
} from "./bidBoard";

describe("bid board scoring", () => {
  it("scores at-schedule as 100 and 2× schedule as 0", () => {
    expect(priceVsScheduleScore(24500n, 24500n)).toBe(100);
    expect(priceVsScheduleScore(49000n, 24500n)).toBe(0);
  });

  it("keeps under-schedule at 100 and interpolates 1.5× to 50", () => {
    expect(priceVsScheduleScore(10000n, 24500n)).toBe(100);
    expect(priceVsScheduleScore(36750n, 24500n)).toBe(50);
  });

  it("inverts rework and caps capacity at 100 (20 pts per unit)", () => {
    expect(reworkInvertedScore(20)).toBe(80);
    expect(reworkInvertedScore(0)).toBe(100);
    expect(capacityScore(3)).toBe(60);
    expect(capacityScore(8)).toBe(100);
  });

  it("composites with open default weights 35/25/20/20", () => {
    const w = normalizeWeights(null);
    expect(w).toEqual({ ...DEFAULT_BID_SCORE_WEIGHTS });
    expect(
      compositeScore(
        { priceVsSchedule: 100, onTime: 80, rework: 90, capacity: 60 },
        w,
      ),
    ).toBe(85);
  });
});
