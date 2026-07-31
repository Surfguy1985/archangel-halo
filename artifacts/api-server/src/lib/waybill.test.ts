/**
 * Unit tests for the waybill derivation library.
 *
 * The waybill (FLK code + six dots) is REQUIRED on every board card the API
 * ships — these tests pin down the derivation rules so a refactor can't
 * silently ship cards without a valid tracking code.
 */
import { describe, expect, it } from "vitest";
import { deriveLaneWaybill, deriveWaybill, waybillCodeFor } from "./waybill";

const STAGE_ORDER = ["sealed", "routed", "delivered", "opened", "in_review", "settled"];
const FLK_RE = /^FLK-[0-9A-HJKMNP-TV-Z]{5}$/; // Crockford base32 — no I, L, O, U

function assertValidStages(stages: Array<{ stage: string; at: string }>) {
  expect(stages.length).toBeGreaterThan(0);
  // Stages must be a prefix of the canonical order (cumulative lighting).
  expect(stages.map((s) => s.stage)).toEqual(STAGE_ORDER.slice(0, stages.length));
  for (const s of stages) {
    expect(Number.isNaN(new Date(s.at).getTime())).toBe(false);
  }
}

describe("waybillCodeFor", () => {
  it("is deterministic and FLK-formatted", () => {
    const id = "3f1c2f34-1111-4222-8333-944444444444";
    expect(waybillCodeFor(id)).toBe(waybillCodeFor(id));
    expect(waybillCodeFor(id)).toMatch(FLK_RE);
  });

  it("differs per card id", () => {
    expect(waybillCodeFor("a")).not.toBe(waybillCodeFor("b"));
  });

  it("push-prefixed keys must be stripped by callers — prefix changes the code", () => {
    // Guard for the documented gotcha: hashing "push:<id>" gives a DIFFERENT
    // code than "<id>", so serializers must strip the projection prefix.
    expect(waybillCodeFor("push:abc")).not.toBe(waybillCodeFor("abc"));
  });
});

describe("deriveWaybill (feed / office feed, column-based)", () => {
  const base = {
    column: "inbox",
    module: null as Record<string, unknown> | null,
    notifiedAt: null as Date | null,
    completedAt: null as Date | null,
    createdAt: new Date("2026-07-01T10:00:00Z"),
    updatedAt: new Date("2026-07-02T10:00:00Z"),
  };

  it("inbox card is at least sealed", () => {
    const w = deriveWaybill({ ...base } as never);
    assertValidStages(w.stages);
    expect(w.stages[0]!.stage).toBe("sealed");
    expect(w.stages[0]!.at).toBe("2026-07-01T10:00:00.000Z");
    expect(w.holder).toBe("recipient");
  });

  it("done column lights all six dots and settles", () => {
    const w = deriveWaybill({
      ...base,
      column: "done",
      completedAt: new Date("2026-07-03T10:00:00Z"),
    } as never);
    assertValidStages(w.stages);
    expect(w.stages).toHaveLength(6);
    expect(w.stages[5]!.at).toBe("2026-07-03T10:00:00.000Z");
    expect(w.holder).toBe("done");
  });

  it("paid invoice module settles even before Done", () => {
    const w = deriveWaybill({
      ...base,
      column: "in_progress",
      module: { type: "invoice", status: "paid" },
    } as never);
    expect(w.stages.map((s) => s.stage)).toContain("settled");
    expect(w.holder).toBe("done");
  });

  it("stages are cumulative — no gaps in the strip", () => {
    // acknowledgedAt lights "opened" while the card is still in inbox;
    // everything before it must light too.
    const w = deriveWaybill({
      ...base,
      module: { acknowledgedAt: "2026-07-02T12:00:00.000Z" },
    } as never);
    assertValidStages(w.stages);
    expect(w.stages.map((s) => s.stage)).toEqual(["sealed", "routed", "delivered", "opened"]);
  });
});

describe("deriveLaneWaybill (projected boards, lane-based)", () => {
  it("deterministic-timestamp guard: with card timestamps supplied, output never invents 'now'", () => {
    const card = {
      updatedAt: "2026-07-10T08:00:00.000Z",
      scheduledOn: "2026-07-11T08:00:00.000Z",
      completedAt: "2026-07-12T08:00:00.000Z",
      status: "complete",
    };
    const allowed = new Set([card.updatedAt, card.scheduledOn, card.completedAt]);
    for (const lane of ["requested", "scheduled", "in_progress", "done", "planning", "todo", "doing", "billing"]) {
      const a = deriveLaneWaybill(lane, card);
      const b = deriveLaneWaybill(lane, card);
      // Same inputs → byte-identical output, across calls and time.
      expect(b).toEqual(a);
      for (const s of a.stages) {
        expect(allowed.has(s.at), `lane=${lane} stage=${s.stage} leaked a non-card timestamp ${s.at}`).toBe(true);
      }
      assertValidStages(a.stages);
    }
  });

  it("lane rank lights the right dots on both vendor and pm lanes", () => {
    const card = { updatedAt: "2026-07-10T08:00:00.000Z" };
    expect(deriveLaneWaybill("requested", card).stages).toHaveLength(2); // sealed+routed
    expect(deriveLaneWaybill("planning", card).stages).toHaveLength(2);
    expect(deriveLaneWaybill("scheduled", card).stages).toHaveLength(3);
    expect(deriveLaneWaybill("todo", card).stages).toHaveLength(3);
    expect(deriveLaneWaybill("in_progress", card).stages).toHaveLength(5);
    expect(deriveLaneWaybill("doing", card).stages).toHaveLength(5);
    expect(deriveLaneWaybill("billing", card).stages).toHaveLength(5);
    expect(deriveLaneWaybill("done", card).stages).toHaveLength(6);
    expect(deriveLaneWaybill("done", card).holder).toBe("done");
  });

  it("unknown lanes degrade to sealed+routed, never an empty strip", () => {
    const w = deriveLaneWaybill("mystery_lane", { updatedAt: "2026-07-10T08:00:00.000Z" });
    assertValidStages(w.stages);
    expect(w.stages).toHaveLength(2);
  });

  it("paid status settles regardless of lane", () => {
    const w = deriveLaneWaybill("requested", {
      updatedAt: "2026-07-10T08:00:00.000Z",
      status: "PAID",
    });
    expect(w.stages.map((s) => s.stage)).toContain("settled");
    expect(w.holder).toBe("done");
  });
});
