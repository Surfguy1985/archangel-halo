import { describe, expect, it } from "vitest";
import {
  confidenceFromSample,
  DEFAULT_STAGE_MS,
  isStalledStage,
  medianMs,
  p75Ms,
  p90,
  predictReadyAt,
  remainingStages,
} from "@workspace/db";

describe("stall and ready-date stats", () => {
  it("median and nearest-rank p75 / p90", () => {
    expect(medianMs([])).toBeNull();
    expect(medianMs([10])).toBe(10);
    expect(medianMs([1, 3])).toBe(2);
    expect(p75Ms([1, 2, 3, 4])).toBe(3);
    expect(p90([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(9);
  });

  it("isStalled only when current duration exceeds property p75", () => {
    expect(isStalledStage(3_600_000, null)).toBe(false);
    expect(isStalledStage(3_600_000, 3_600_000)).toBe(false);
    expect(isStalledStage(3_600_001, 3_600_000)).toBe(true);
  });

  it("confidence bands: n≥30 high, n≥10 medium, else low", () => {
    expect(confidenceFromSample(30)).toBe("high");
    expect(confidenceFromSample(10)).toBe("medium");
    expect(confidenceFromSample(9)).toBe("low");
  });

  it("predicts remaining time as median leftover of remaining stages", () => {
    const now = new Date("2026-07-01T15:00:00.000Z");
    const hour = 3_600_000;
    const remaining = remainingStages("qc");
    expect(remaining).toEqual(["qc", "ready"]);

    const pred = predictReadyAt({
      current: "qc",
      now,
      elapsedInCurrentMs: 2 * hour,
      samples: [
        { stage: "qc", durationsMs: [8 * hour, 8 * hour, 8 * hour] },
        { stage: "ready", durationsMs: [0] },
      ],
    });
    expect(pred.remainingMs).toBe(6 * hour);
    expect(pred.predictedReadyAt.getTime()).toBe(now.getTime() + 6 * hour);
    expect(pred.confidence).toBe("low");
    expect(pred.capacityDelayMs).toBe(0);
  });

  it("adds a week of delay when the vendor queue overflows weekly capacity", () => {
    const now = new Date("2026-07-01T15:00:00.000Z");
    const pred = predictReadyAt({
      current: "ready",
      now,
      elapsedInCurrentMs: 0,
      samples: [],
      capacityUnitsPerWeek: 10,
      committedQueue: 20,
    });
    expect(pred.remainingMs).toBe(0);
    expect(pred.capacityDelayMs).toBe(7 * 86_400_000);
    expect(pred.predictedReadyAt.getTime()).toBe(now.getTime() + 7 * 86_400_000);
  });

  it("falls back to DEFAULT_STAGE_MS when a remaining stage has no history", () => {
    const now = new Date("2026-07-01T00:00:00.000Z");
    const pred = predictReadyAt({
      current: "qc",
      now,
      elapsedInCurrentMs: 0,
      samples: [],
    });
    expect(pred.remainingMs).toBe(DEFAULT_STAGE_MS.qc);
    expect(pred.confidence).toBe("low");
  });
});
