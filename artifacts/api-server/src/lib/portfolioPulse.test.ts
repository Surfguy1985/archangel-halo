import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeTurnMetrics,
  vacancyCostCents,
  zonedCivilToUtc,
} from "@workspace/db";
import {
  classifyTileStatus,
  countUnitsInTurn,
  parseCivilDate,
  resolvePulseWindow,
  turnOverlapsWindow,
  vacancyCostInWindow,
  PulseRangeError,
  centsString,
} from "./portfolioPulse";

describe("Portfolio Pulse pure helpers", () => {
  it("never imports the raw stage-event table", () => {
    const src = readFileSync(new URL("./portfolioPulse.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/clientTurnStageEventsTable/);
    expect(src).not.toMatch(/from\("client_turn_stage_events"\)/);
  });

  it("formats cents as a decimal string, never a float", () => {
    expect(centsString(0n)).toBe("0");
    expect(centsString(12_450_00n)).toBe("1245000");
    expect(centsString(-90n)).toBe("-90");
  });

  it("rejects non-civil from/to", () => {
    expect(() => parseCivilDate("2026-08-14T00:00:00Z")).toThrow(PulseRangeError);
  });

  it("this_month prior window is last month through the same day-of-month", () => {
    const now = new Date("2026-08-14T17:00:00Z");
    const w = resolvePulseWindow({ range: "this_month" }, "America/Chicago", now);
    expect(w.fromCivil).toBe("2026-08-01");
    expect(w.toCivil).toBe("2026-08-14");
    expect(w.priorLabel).toBe("last month, same day");
    expect(w.headlineLabel).toContain("this month");
  });

  it("custom range requires from and to", () => {
    expect(() =>
      resolvePulseWindow({ range: "custom" }, "America/Chicago", new Date("2026-08-14T17:00:00Z")),
    ).toThrow(/from and to/);
  });

  it("classifies status with a label so color is never the only signal", () => {
    expect(classifyTileStatus({ medianTurnDays: 6, targetTurnDays: 7, stalledCount: 0 })).toEqual({
      status: "on_target",
      statusLabel: "On target",
    });
    expect(classifyTileStatus({ medianTurnDays: 8, targetTurnDays: 7, stalledCount: 0 })).toEqual({
      status: "drifting",
      statusLabel: "Drifting",
    });
    expect(classifyTileStatus({ medianTurnDays: 9, targetTurnDays: 7, stalledCount: 0 }).status).toBe(
      "at_risk",
    );
    expect(classifyTileStatus({ medianTurnDays: 6, targetTurnDays: 7, stalledCount: 1 }).status).toBe(
      "at_risk",
    );
  });

  it("counts units in turn from vacate/ready stamps, not events", () => {
    const weekStart = new Date("2026-08-10T05:00:00Z");
    const weekEnd = new Date("2026-08-17T05:00:00Z");
    const turns = [
      {
        actualVacateAt: new Date("2026-08-01T05:00:00Z"),
        noticeGivenAt: null,
        createdAt: new Date("2026-07-20T05:00:00Z"),
        readyAt: null,
      },
      {
        actualVacateAt: new Date("2026-07-01T05:00:00Z"),
        noticeGivenAt: null,
        createdAt: new Date("2026-06-20T05:00:00Z"),
        readyAt: new Date("2026-08-01T05:00:00Z"),
      },
      {
        actualVacateAt: new Date("2026-08-18T05:00:00Z"),
        noticeGivenAt: null,
        createdAt: new Date("2026-08-18T05:00:00Z"),
        readyAt: null,
      },
    ];
    expect(countUnitsInTurn(turns, weekStart, weekEnd)).toBe(1);
  });

  it("attributes over-target days inside the window, not lifetime MV cost", () => {
    const CHICAGO = "America/Chicago";
    const now = new Date("2026-08-14T17:00:00Z");
    const vacate = zonedCivilToUtc(CHICAGO, 2026, 7, 1);
    const window = resolvePulseWindow({ range: "this_month" }, CHICAGO, now);
    const rent = 180000n;
    const common = {
      vacateAt: vacate,
      readyAt: null,
      targetTurnDays: 7,
      targetReadyAt: null,
      marketRentCents: rent,
      timezone: CHICAGO,
      now,
    };
    const thisMonth = vacancyCostInWindow({
      ...common,
      windowFrom: window.fromAt,
      windowToExclusive: window.toExclusive,
    });
    const lastMonth = vacancyCostInWindow({
      ...common,
      windowFrom: window.priorFromAt,
      windowToExclusive: window.priorToExclusive,
    });
    const lifetime = computeTurnMetrics({
      timezone: CHICAGO,
      targetTurnDays: 7,
      marketRentCents: rent,
      actualVacateAt: vacate,
      readyAt: null,
      now,
      events: [],
    }).vacancyCostCents;

    // Aug 1 → as-of Aug 14 noon CT = 13 over-target days in August (target was Jul 8).
    expect(thisMonth).toBe(vacancyCostCents({ overTargetDays: 13, marketRentCents: rent, daysInMonth: 31 }));
    // Last month, same day: Jul 8–14 (7 days), not the full lifetime bill.
    expect(lastMonth).toBe(vacancyCostCents({ overTargetDays: 7, marketRentCents: rent, daysInMonth: 31 }));
    expect(lastMonth).not.toBe(lifetime);
    expect(thisMonth).not.toBe(lifetime);
    expect(thisMonth + lastMonth < lifetime).toBe(true);
  });

  it("overlap uses vacate/ready, so a ready-before-window turn is out", () => {
    const from = new Date("2026-08-01T05:00:00Z");
    const to = new Date("2026-09-01T05:00:00Z");
    expect(
      turnOverlapsWindow(
        {
          actualVacateAt: new Date("2026-07-01T05:00:00Z"),
          noticeGivenAt: null,
          createdAt: new Date("2026-07-01T05:00:00Z"),
          readyAt: new Date("2026-07-20T05:00:00Z"),
        },
        from,
        to,
      ),
    ).toBe(false);
  });
});
