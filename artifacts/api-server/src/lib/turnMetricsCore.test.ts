import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  computeTurnMetrics,
  datePartsInZone,
  msToHours2,
  renderClientBoardMigrationSql,
  vacancyCostCents,
  yymmddInZone,
  zonedCivilToUtc,
  CLIENT_BOARD_DDL,
} from "@workspace/db";

const CHICAGO = "America/Chicago";

function ev(
  id: string,
  stage: Parameters<typeof computeTurnMetrics>[0]["events"][number]["stage"],
  event: "entered" | "exited",
  at: Date,
) {
  return { id, stage, event, occurredAt: at };
}

describe("property timezone civil dates — never UTC", () => {
  it("keeps July 1 evening in Chicago as July 1, not July 2 UTC", () => {
    // 23:00 CDT = 04:00 UTC the next day
    const at = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 23, 0, 0);
    expect(at.toISOString()).toBe("2026-07-02T04:00:00.000Z");
    expect(yymmddInZone(at, CHICAGO)).toBe("260701");
    expect(datePartsInZone(at, CHICAGO)).toEqual({ year: 2026, month: 7, day: 1 });
  });

  it("counts calendar days across the 2026 spring-forward, not elapsed hours", () => {
    const vacate = zonedCivilToUtc(CHICAGO, 2026, 3, 7, 6, 0, 0);
    const ready = zonedCivilToUtc(CHICAGO, 2026, 3, 10, 6, 0, 0);
    expect(calendarDaysBetween(vacate, ready, CHICAGO)).toBe(3);
    const elapsedHours = (ready.getTime() - vacate.getTime()) / 3_600_000;
    expect(elapsedHours).toBe(71);
  });
});

describe("golden turn metrics (the number you defend in the room)", () => {
  it("six-day client approval: days, dollars, and hours land on the client", () => {
    const vacate = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 10, 0, 0);
    const ready = zonedCivilToUtc(CHICAGO, 2026, 7, 12, 10, 0, 0);
    const approvalIn = zonedCivilToUtc(CHICAGO, 2026, 7, 2, 9, 0, 0);
    const approvalOut = zonedCivilToUtc(CHICAGO, 2026, 7, 8, 9, 0, 0);

    const metrics = computeTurnMetrics({
      timezone: CHICAGO,
      targetTurnDays: 7,
      marketRentCents: 145000n,
      actualVacateAt: vacate,
      readyAt: ready,
      now: ready,
      events: [
        ev("1", "notice", "entered", zonedCivilToUtc(CHICAGO, 2026, 6, 17, 10, 0, 0)),
        ev("2", "notice", "exited", vacate),
        ev("3", "vacated", "entered", vacate),
        ev("4", "vacated", "exited", zonedCivilToUtc(CHICAGO, 2026, 7, 1, 14, 0, 0)),
        ev("5", "walk", "entered", zonedCivilToUtc(CHICAGO, 2026, 7, 1, 14, 0, 0)),
        ev("6", "walk", "exited", zonedCivilToUtc(CHICAGO, 2026, 7, 1, 18, 0, 0)),
        ev("7", "scoped", "entered", zonedCivilToUtc(CHICAGO, 2026, 7, 1, 18, 0, 0)),
        ev("8", "scoped", "exited", approvalIn),
        ev("9", "pending_approval", "entered", approvalIn),
        ev("10", "pending_approval", "exited", approvalOut),
        ev("11", "approved", "entered", approvalOut),
        ev("12", "approved", "exited", zonedCivilToUtc(CHICAGO, 2026, 7, 8, 11, 0, 0)),
        ev("13", "scheduled", "entered", zonedCivilToUtc(CHICAGO, 2026, 7, 8, 11, 0, 0)),
        ev("14", "scheduled", "exited", zonedCivilToUtc(CHICAGO, 2026, 7, 9, 11, 0, 0)),
        ev("15", "in_progress", "entered", zonedCivilToUtc(CHICAGO, 2026, 7, 9, 11, 0, 0)),
        ev("16", "in_progress", "exited", zonedCivilToUtc(CHICAGO, 2026, 7, 11, 11, 0, 0)),
        ev("17", "qc", "entered", zonedCivilToUtc(CHICAGO, 2026, 7, 11, 11, 0, 0)),
        ev("18", "qc", "exited", ready),
        ev("19", "ready", "entered", ready),
      ],
    });

    expect(metrics.daysVacant).toBe(11);
    expect(metrics.overTargetDays).toBe(4);
    expect(metrics.daysInMonth).toBe(31);
    expect(metrics.vacancyCostCents).toBe(vacancyCostCents({
      overTargetDays: 4,
      marketRentCents: 145000n,
      daysInMonth: 31,
    }));
    expect(metrics.vacancyCostCents).toBe(18709n);
    // 6 days pending + 2 hours approved = 146h on the client clock
    expect(metrics.clientOwnedHours).toBe("146.00");
    expect(metrics.clientOwnedMs).toBe(146n * 3_600_000n);
    expect(metrics.vendorOwnedMs).toBeGreaterThan(0n);
    expect(metrics.clientOwnedMs).toBeGreaterThan(metrics.vendorOwnedMs);
  });

  it("month-boundary turn bills against February's day count, not January's", () => {
    const vacate = zonedCivilToUtc(CHICAGO, 2026, 1, 30, 12, 0, 0);
    const ready = zonedCivilToUtc(CHICAGO, 2026, 2, 3, 12, 0, 0);
    const metrics = computeTurnMetrics({
      timezone: CHICAGO,
      targetTurnDays: 2,
      marketRentCents: 145000n,
      actualVacateAt: vacate,
      readyAt: ready,
      now: ready,
      events: [
        ev("a", "vacated", "entered", vacate),
        ev("b", "vacated", "exited", ready),
        ev("c", "ready", "entered", ready),
      ],
    });
    expect(metrics.daysVacant).toBe(4);
    expect(metrics.overTargetDays).toBe(2);
    expect(metrics.daysInMonth).toBe(28);
    expect(metrics.vacancyCostCents).toBe((2n * 145000n) / 28n);
  });

  it("two rework loops sum into in_progress rather than replacing it", () => {
    const t0 = zonedCivilToUtc(CHICAGO, 2026, 8, 1, 8, 0, 0);
    const hour = 3_600_000;
    const at = (h: number) => new Date(t0.getTime() + h * hour);
    const metrics = computeTurnMetrics({
      timezone: CHICAGO,
      targetTurnDays: 7,
      marketRentCents: 145000n,
      actualVacateAt: t0,
      readyAt: at(10),
      now: at(10),
      events: [
        ev("1", "in_progress", "entered", at(0)),
        ev("2", "in_progress", "exited", at(2)),
        ev("3", "qc", "entered", at(2)),
        ev("4", "qc", "exited", at(3)),
        ev("5", "rework", "entered", at(3)),
        ev("6", "rework", "exited", at(4)),
        ev("7", "in_progress", "entered", at(4)),
        ev("8", "in_progress", "exited", at(7)),
        ev("9", "qc", "entered", at(7)),
        ev("10", "qc", "exited", at(8)),
        ev("11", "rework", "entered", at(8)),
        ev("12", "rework", "exited", at(9)),
        ev("13", "in_progress", "entered", at(9)),
        ev("14", "in_progress", "exited", at(10)),
      ],
    });
    expect(metrics.stageDurationsMs.in_progress).toBe(6 * hour);
    expect(metrics.stageDurationsMs.rework).toBe(2 * hour);
    expect(metrics.stageDurationsMs.qc).toBe(2 * hour);
    expect(metrics.vendorOwnedHours).toBe("10.00");
    expect(metrics.clientOwnedMs).toBe(0n);
  });

  it("formats hours the way numeric(12,2) ROUND does", () => {
    expect(msToHours2(3_600_000n)).toBe("1.00");
    expect(msToHours2(0n)).toBe("0.00");
    expect(msToHours2(18_000n)).toBe("0.01");
  });
});

describe("0015 forward migration is real DDL, not SELECT 1", () => {
  it("matches renderClientBoardMigrationSql() so boot-path and psql cannot drift", () => {
    const file = readFileSync(
      path.resolve(process.cwd(), "../../lib/db/migrations/0015_client_board_v1.sql"),
      "utf8",
    );
    expect(file).toBe(renderClientBoardMigrationSql());
    expect(file).not.toMatch(/^SELECT 1;\s*$/m);
    expect(file).toContain("CREATE TABLE IF NOT EXISTS client_turns");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS client_turn_stage_events");
    expect(file).toContain("halo_append_only_guard");
    expect(file).toContain("refresh_client_turn_metrics");
    expect(file).toContain("refresh_open_client_turn_metrics");
    expect(file).toContain("client_turn_outbox");
    expect(file).toContain("is_stalled = EXCLUDED.is_stalled");
    for (const stmt of CLIENT_BOARD_DDL) {
      const needle = stmt.trim().slice(0, 60);
      expect(file).toContain(needle.trim());
    }
  });
});
