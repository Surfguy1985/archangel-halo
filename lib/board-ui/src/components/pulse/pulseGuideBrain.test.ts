import { describe, expect, it } from "vitest";
import { inventGuard, reasonAsk } from "./askReason";
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
      latitude: 33.162,
      longitude: -96.937,
    },
  ],
  photos: [
    {
      propertyId: "paloma",
      propertyName: "Paloma Creek",
      unitNumber: "214",
      beforeUrl: "https://example.com/before.jpg",
      afterUrl: "https://example.com/after.jpg",
    },
  ],
  turns: [{ propertyId: "paloma", propertyName: "Paloma Creek", unitNumber: "214", days: 11 }],
  photoCount: 3,
  attentionCount: 1,
  needs: [
    { kind: "awaiting_approval", propertyId: "paloma", propertyName: "Paloma Creek", unitNumber: "214", days: 4 },
  ],
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
  it("opens photos and names the unit count", () => {
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

  it("briefs what's on fire and attaches proof cards", () => {
    const r = interpretPulseQuestion("what's on fire", ctx);
    expect(r.answer).toMatch(/214/);
    expect(r.answer).toMatch(/waiting on you/);
    expect(r.answer.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(4);
    expect(r.cards?.some((c) => c.kind === "pair" || c.kind === "map")).toBe(true);
    expect(r.followUps?.length).toBeGreaterThan(0);
    expect(r.citations?.some((c) => /vacancy|rank|clock/i.test(c.label + c.detail))).toBe(true);
    expect(r.why?.length).toBeGreaterThan(0);
  });

  it("puts before/after in a focused card, not a paragraph", () => {
    const r = interpretPulseQuestion("show before and after photos", ctx);
    expect(r.cards?.some((c) => c.kind === "pair" && c.before && c.after)).toBe(true);
    expect(r.answer.length).toBeLessThan(80);
  });

  it("predicts the approval wait will still sit tomorrow", () => {
    const r = interpretPulseQuestion("what will be late", ctx);
    expect(r.answer).toMatch(/214/);
    expect(r.actions).toContainEqual({ type: "open", panel: "attention" });
  });

  it("names what the PM must sign", () => {
    const r = interpretPulseQuestion("what do you need from me", ctx);
    expect(r.answer).toMatch(/214/);
    expect(r.actions).toContainEqual({ type: "open", panel: "attention" });
  });

  it("explains why a unit ranks first and cites the clock", () => {
    const r = reasonAsk("why is 214 first", ctx);
    expect(r.intent).toBe("why");
    expect(r.answer).toMatch(/214/);
    expect(r.why.some((w) => /clock|approval|own/i.test(w))).toBe(true);
    expect(r.citations.some((c) => /days|vacancy|rank/i.test(c.label))).toBe(true);
  });

  it("resolves that unit from memory", () => {
    const first = reasonAsk("unit 214", ctx);
    const next = reasonAsk("why is that still vacant", ctx, first.memory);
    expect(next.intent).toBe("why");
    expect(next.answer).toMatch(/214/);
    expect(next.focus.unitNumber).toBe("214");
  });

  it("compares two communities on the same clock", () => {
    const two: GuideContext = {
      ...ctx,
      sites: [
        ...ctx.sites,
        {
          propertyId: "redbud",
          name: "CAF Demo — Redbud Trail",
          city: "McKinney",
          unitsInTurn: 1,
          statusLabel: "On pace",
          vacancyCostCents: "200000",
          latitude: 33.2,
          longitude: -96.6,
        },
      ],
    };
    const r = reasonAsk("compare paloma and redbud", two);
    expect(r.intent).toBe("compare");
    expect(r.answer).toMatch(/Paloma/);
    expect(r.answer).toMatch(/Redbud/);
    expect(r.citations.some((c) => /vacancy|clock|ready/i.test(`${c.label} ${c.detail}`))).toBe(true);
  });

  it("rejects a narrated unit that is not on the board", () => {
    expect(inventGuard("Unit 214 is waiting on you.", ctx)).toBe(true);
    expect(inventGuard("Unit 999 is on fire.", ctx)).toBe(false);
    expect(inventGuard("Vacancy this window is $12,450.00.", ctx)).toBe(true);
  });
});
