import { describe, expect, it } from "vitest";
import { answerFromCortex, buildOpsCortex, renderCortexBlock, type OpsFacts } from "./opsCortex";

const facts: OpsFacts = {
  date: "2026-08-15",
  voice: "client",
  vacancyCostCents: "1245000",
  unitsInTurn: 4,
  medianTurnDays: 8,
  communities: 2,
  needs: [
    { kind: "awaiting_approval", propertyName: "CAF Demo — Paloma Creek", unitNumber: "214", days: 4 },
    { kind: "stalled", propertyName: "Paloma Creek", unitNumber: "108", days: 12 },
  ],
  crewToday: [{ crewName: "Carlos", propertyName: "Paloma Creek", unitNumber: "214" }],
  turns: [
    { propertyName: "Paloma Creek", unitNumber: "214", days: 11, status: "pending_approval" },
    { propertyName: "Paloma Creek", unitNumber: "108", days: 12, status: "in_progress" },
  ],
  scheduledTomorrow: [{ propertyName: "Paloma Creek", unitNumber: "220", crewName: "Maya" }],
};

describe("ops cortex", () => {
  it("ranks client-owned waits first and names the next move", () => {
    const c = buildOpsCortex(facts);
    expect(c.needsYou[0]?.headline).toMatch(/214/);
    expect(c.needsYou[0]?.why).toMatch(/waiting on you, 4 days/);
    expect(c.nextMove?.headline).toMatch(/214/);
    expect(c.brief).toMatch(/Carlos/);
    expect(c.brief).toMatch(/\$12,450\.00/);
    expect(c.onFire.some((i) => i.headline.includes("108"))).toBe(true);
  });

  it("predicts the approval wait will still be sitting tomorrow", () => {
    const c = buildOpsCortex(facts);
    expect(c.predictions.some((p) => /214/.test(p.headline) && /waiting on you/.test(p.why))).toBe(true);
    expect(c.predictions.some((p) => /Maya/.test(p.why))).toBe(true);
  });

  it("answers the three morning questions from the brief", () => {
    const c = buildOpsCortex(facts);
    expect(answerFromCortex("what's on fire", facts, c).answer).toMatch(/214/);
    expect(answerFromCortex("who's on site", facts, c).open).toBe("crew");
    expect(answerFromCortex("what do you need from me", facts, c).answer).toMatch(/waiting on you/);
    expect(answerFromCortex("what will be late", facts, c).answer).toMatch(/214|108|220/);
  });

  it("renders a block Claude must not contradict", () => {
    const block = renderCortexBlock(buildOpsCortex(facts));
    expect(block).toContain("Cortex brief");
    expect(block).toContain("214");
    expect(block).toContain("Single next move");
  });
});
