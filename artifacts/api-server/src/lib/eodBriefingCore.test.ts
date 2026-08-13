import { describe, expect, it } from "vitest";
import {
  easternDayWindow,
  fallbackSummary,
  inWindow,
  jobIsOpen,
  localDateInEastern,
  type EodBriefingMetrics,
} from "./eodBriefingCore";

const empty: EodBriefingMetrics = {
  date: "2026-08-13",
  jobsCompleted: 0,
  jobsStillOpen: 4,
  jobsScheduledToday: 0,
  checkins: 0,
  checkouts: 0,
  crewsActive: 0,
  photos: 0,
  base44Freshness: "current",
  base44EvidenceFresh: 0,
  base44EvidenceStale: 2,
};

describe("ops.eod_briefing fallback", () => {
  it("always produces a readable recap without a model", () => {
    const quiet = fallbackSummary(empty);
    expect(quiet).toContain("2026-08-13");
    expect(quiet).toContain("No field completions");
    expect(quiet).toContain("stale");

    const busy = fallbackSummary({
      ...empty,
      jobsCompleted: 3,
      jobsScheduledToday: 5,
      jobsStillOpen: 8,
      checkins: 4,
      checkouts: 3,
      crewsActive: 2,
      photos: 11,
    });
    expect(busy).toContain("3 jobs completed");
    expect(busy).toContain("2 crews punched");
    expect(busy).not.toContain("No field completions");
  });

  it("treats complete/closed/cancelled as not open", () => {
    expect(jobIsOpen("open")).toBe(true);
    expect(jobIsOpen("complete")).toBe(false);
    expect(jobIsOpen("cancelled")).toBe(false);
  });
});

describe("Eastern day window", () => {
  it("uses EDT in August and EST in January", () => {
    expect(easternDayWindow("2026-08-13").start.toISOString()).toBe("2026-08-13T04:00:00.000Z");
    expect(easternDayWindow("2026-08-13").end.toISOString()).toBe("2026-08-14T04:00:00.000Z");
    expect(easternDayWindow("2026-01-15").start.toISOString()).toBe("2026-01-15T05:00:00.000Z");
  });

  it("includes start and excludes end", () => {
    const { start, end } = easternDayWindow("2026-08-13");
    expect(inWindow(start, start, end)).toBe(true);
    expect(inWindow(end, start, end)).toBe(false);
  });

  it("formats today as YYYY-MM-DD", () => {
    expect(localDateInEastern(new Date("2026-08-13T12:00:00-04:00"))).toBe("2026-08-13");
  });
});
