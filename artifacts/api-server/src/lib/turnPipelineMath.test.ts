/**
 * Segment 8 forecast math — numbers a human can reproduce from the comments.
 */
import { describe, expect, it } from "vitest";
import {
  applySeasonalDays,
  crunchRatio,
  FORECAST_METHOD,
  isCrunch,
  noticeConversionRate,
  seasonalIndex,
  spendBand,
  tradeFromCategory,
} from "@workspace/db";

describe("turn pipeline math", () => {
  it("computes on-schedule conversion and will not assume 100%", () => {
    // 10 notices vacated; 7 landed on the scheduled civil day → 0.7
    expect(noticeConversionRate(7, 10)).toBe(0.7);
    expect(noticeConversionRate(0, 0)).toBe(0);
  });

  it("indexes a month against the overall mean duration", () => {
    // August 8.0 days vs overall 10.0 → 0.8
    expect(seasonalIndex(8, 10)).toBe(0.8);
    expect(applySeasonalDays(10, 0.8)).toBe(8);
    expect(seasonalIndex(0, 10)).toBe(1);
  });

  it("builds a spend band a human can check by hand", () => {
    // 2 scheduled 1br turns at $1,000.00 = 200000 cents
    // 4 notice 1br turns at $1,000.00 = 400000 cents
    // conversion 0.70 → converted notices = 280000
    // low 200000 / mid 480000 / high 600000
    const band = spendBand({
      scheduledCostCents: 200000n,
      noticeCostCents: 400000n,
      conversionRate: 0.7,
    });
    expect(band).toEqual({
      lowCents: "200000",
      midCents: "480000",
      highCents: "600000",
    });
    expect(FORECAST_METHOD.toLowerCase()).toContain("conversion");
  });

  it("flags a week as crunch only when demand exceeds capacity", () => {
    expect(crunchRatio(4, 5)).toBe(0.8);
    expect(isCrunch(0.8)).toBe(false);
    expect(crunchRatio(6, 5)).toBe(1.2);
    expect(isCrunch(1.2)).toBe(true);
    expect(crunchRatio(3, 0)).toBe(2);
    expect(isCrunch(2)).toBe(true);
  });

  it("maps price-list categories onto the six trades", () => {
    expect(tradeFromCategory("Paint")).toBe("paint");
    expect(tradeFromCategory("Flooring")).toBe("flooring");
    expect(tradeFromCategory("HVAC")).toBe("hvac");
    expect(tradeFromCategory("marble")).toBeNull();
  });
});
