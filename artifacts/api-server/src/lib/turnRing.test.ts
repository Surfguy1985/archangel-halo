import { describe, expect, it } from "vitest";
import {
  buildTurnRingArcs,
  describeArc,
  formatStageClock,
  polarToCartesian,
  stageVisitsFromEvents,
  type TurnStage,
} from "@workspace/db";

function ev(
  id: string,
  stage: TurnStage,
  event: "entered" | "exited",
  at: Date,
  actorId: string | null = "tech-lee",
) {
  return { id, stage, event, occurredAt: at, actorId };
}

describe("formatStageClock", () => {
  it("writes the client-owned copy as days and hours", () => {
    expect(formatStageClock(4 * 86_400_000 + 6 * 3_600_000)).toBe("4 days, 6 hours");
    expect(formatStageClock(86_400_000)).toBe("1 day");
    expect(formatStageClock(3_600_000)).toBe("1 hour");
    expect(formatStageClock(0)).toBe("0 minutes");
  });
});

describe("Turn Ring geometry", () => {
  it("shares polar math with the SVG path", () => {
    const p = polarToCartesian(22, 22, 16, 0);
    expect(p.x).toBeCloseTo(22);
    expect(p.y).toBeCloseTo(6);
    const d = describeArc(22, 22, 16, 0, 90);
    expect(d).toMatch(/^M /);
    expect(d).toContain(" A 16 16 0 0 1 ");
    expect(describeArc(22, 22, 16, 90, 90)).toBe("");
  });

  it("two rework loops produce two rework arcs and a visitIndex > 0", () => {
    const t0 = new Date("2026-08-01T13:00:00.000Z");
    const hour = 3_600_000;
    const at = (h: number) => new Date(t0.getTime() + h * hour);
    const visits = stageVisitsFromEvents(
      [
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
      at(10),
    );
    const rework = visits.filter((v) => v.stage === "rework");
    expect(rework).toHaveLength(2);
    expect(rework.map((v) => v.visitIndex)).toEqual([0, 1]);
    expect(visits.filter((v) => v.visitIndex > 0).length).toBeGreaterThanOrEqual(2);

    const arcs = buildTurnRingArcs({ visits, predictedRemainingMs: hour });
    const reworkArcs = arcs.filter((a) => a.stage === "rework" && !a.predicted);
    expect(reworkArcs).toHaveLength(2);
    expect(reworkArcs.some((a) => a.visitIndex > 0)).toBe(true);
    expect(reworkArcs.every((a) => a.actorId === "tech-lee")).toBe(true);
    expect(arcs.some((a) => a.predicted && a.stage === "ready" && a.actorId === null)).toBe(true);
    const elapsed = visits.reduce((s, v) => s + Number(v.durationMs), 0);
    expect(elapsed).toBe(10 * hour);
  });
});
