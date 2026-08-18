import { describe, expect, it } from "vitest";
import {
  answerFromCortex,
  buildOpsCortex,
  cortexProposals,
  renderCortexBlock,
  turnBaseline,
  type OpsFacts,
} from "./opsCortex";

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

  it("returns a structured answer, not a prose blob", () => {
    const c = buildOpsCortex(facts);
    const a = answerFromCortex("what do you need from me", facts, c);
    expect(a.structured.headline).toMatch(/waiting on you/i);
    expect(a.structured.bullets.length).toBeGreaterThan(0);
    expect(a.structured.speech).not.toMatch(/•/);
    expect(JSON.stringify(a.structured)).not.toContain("**");
  });
});

describe("turn-time baseline", () => {
  it("falls back to the fixed 7/12 thresholds with no completed history", () => {
    const b = turnBaseline({ turnBaselineDays: null, turnBaselineSample: 0 });
    expect(b.measured).toBe(false);
    expect(b.flagAt).toBe(7);
    expect(b.urgentAt).toBe(12);
  });

  it("ignores an average drawn from too few turns", () => {
    const b = turnBaseline({ turnBaselineDays: 3, turnBaselineSample: 2 });
    expect(b.measured).toBe(false);
    expect(b.flagAt).toBe(7);
  });

  it("flags a 5-day unit against a measured 3-day average", () => {
    const b = turnBaseline({ turnBaselineDays: 3, turnBaselineSample: 8 });
    expect(b.measured).toBe(true);
    expect(b.days).toBe(3);
    expect(b.flagAt).toBe(5);
    expect(5).toBeGreaterThanOrEqual(b.flagAt);
    expect(5).toBeLessThan(b.urgentAt);
  });

  it("moves the flag with a slower operation instead of a hardcoded day count", () => {
    const fast = turnBaseline({ turnBaselineDays: 3, turnBaselineSample: 8 });
    const slow = turnBaseline({ turnBaselineDays: 10, turnBaselineSample: 8 });
    expect(slow.flagAt).toBeGreaterThan(fast.flagAt);
    expect(slow.urgentAt).toBeGreaterThan(slow.flagAt);
  });
});

describe("predictive proposals", () => {
  const measured: OpsFacts = {
    ...facts,
    turnBaselineDays: 3,
    turnBaselineSample: 9,
    turns: [
      { propertyName: "Paloma Creek", unitNumber: "111", days: 5, status: "in_progress", jobId: "job-111", jobNo: "J-111" },
      { propertyName: "Paloma Creek", unitNumber: "112", days: 2, status: "in_progress", jobId: "job-112" },
    ],
  };

  it("phrases a slow unit as a decision quoting the operation's own average", () => {
    const c = buildOpsCortex(measured);
    const flag = c.predictions.find((p) => p.headline.includes("111"));
    expect(flag?.decision).toBe("Unit 111 is 5 days into a 3-day average turn — move it to the top of the priority list?");
    expect(flag?.proposal?.kind).toBe("prioritize_job");
    expect(flag?.proposal?.entityId).toBe("job-111");
  });

  it("does not flag a unit that is inside the operation's normal turn", () => {
    const c = buildOpsCortex(measured);
    expect(c.predictions.some((p) => p.headline.includes("112"))).toBe(false);
  });

  it("never offers a suggestion it cannot execute", () => {
    const c = buildOpsCortex({
      ...measured,
      turns: [{ propertyName: "Paloma Creek", unitNumber: "111", days: 9, status: "in_progress" }],
    });
    const flag = c.predictions.find((p) => p.headline.includes("111"));
    expect(flag).toBeDefined();
    expect(flag?.proposal).toBeUndefined();
    expect(flag?.decision).toBeUndefined();
  });

  it("proposes crew broadcast for an uncrewed job and a reminder for an overdue invoice", () => {
    const c = buildOpsCortex({
      ...measured,
      needs: [
        { kind: "uncrewed", propertyName: "Paloma Creek", unitNumber: "300", label: "J-300", entityId: "job-300" },
        { kind: "overdue_invoice", propertyName: "Oak Park", days: 21, label: "INV-9", entityId: "inv-9" },
      ],
    });
    const kinds = cortexProposals(c).map((p) => p.kind);
    expect(kinds).toContain("rebroadcast_job");
    expect(kinds).toContain("send_invoice_reminder");
  });

  it("deduplicates proposals so the same entity is only offered once", () => {
    const c = buildOpsCortex({
      ...measured,
      needs: [
        { kind: "uncrewed", propertyName: "Paloma Creek", unitNumber: "300", entityId: "job-300" },
        { kind: "uncrewed", propertyName: "Paloma Creek", unitNumber: "300", entityId: "job-300" },
      ],
    });
    const ids = cortexProposals(c).filter((p) => p.entityId === "job-300");
    expect(ids).toHaveLength(1);
  });
});
