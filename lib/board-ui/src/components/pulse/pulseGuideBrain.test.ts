import { describe, expect, it } from "vitest";
import { interpretPulseQuestion, type GuideContext } from "./pulseGuideBrain";

const ctx: GuideContext = {
  title: "North Region",
  vacancyCostCents: "1245000",
  vacancyLabel: "rent lost this month",
  unitsInTurn: 4,
  medianTurnDays: 8,
  sites: [
    {
      propertyId: "paloma",
      name: "CAF Demo — Paloma Creek",
      city: "Little Elm",
      unitsInTurn: 2,
      statusLabel: "Drifting",
      vacancyCostCents: "800000",
    },
  ],
  turns: [{ propertyId: "paloma", propertyName: "Paloma Creek", unitNumber: "214", days: 11 }],
  photoCount: 3,
  attentionCount: 1,
  crew: [
    {
      propertyId: "paloma",
      propertyName: "Paloma Creek",
      unitNumber: "214",
      crewName: "Carlos",
      status: "in_progress",
    },
  ],
};

describe("pulse guide brain", () => {
  it("opens photos and names the Work App count", () => {
    const r = interpretPulseQuestion("show before and after photos", ctx);
    expect(r.actions).toContainEqual({ type: "open", panel: "photos" });
    expect(r.answer).toMatch(/3 units/);
  });

  it("selects a community and opens turns", () => {
    const r = interpretPulseQuestion("what's happening at paloma creek", ctx);
    expect(r.actions).toContainEqual({ type: "select", propertyId: "paloma" });
    expect(r.answer).toMatch(/Paloma/);
  });

  it("opens crew GPS-style presence without a black chat", () => {
    const r = interpretPulseQuestion("where's the crew today", ctx);
    expect(r.actions).toContainEqual({ type: "open", panel: "crew" });
    expect(r.answer).toMatch(/Carlos/);
  });

  it("opens the kanban flow", () => {
    const r = interpretPulseQuestion("open the kanban board", ctx);
    expect(r.actions).toEqual([{ type: "kanban" }]);
  });

  it("finds a unit", () => {
    const r = interpretPulseQuestion("unit 214", ctx);
    expect(r.answer).toMatch(/214/);
    expect(r.actions).toContainEqual({ type: "open", panel: "turns" });
  });
});
