import { describe, expect, it } from "vitest";
import {
  assertLegalTransition,
  IllegalTurnTransitionError,
  TerminalTurnError,
  isLegalTransition,
  legalNextStages,
  remainingStages,
} from "@workspace/db";

describe("TurnStateMachine graph", () => {
  it("allows only the happy-path edges plus qc → rework → in_progress", () => {
    expect(legalNextStages("notice")).toEqual(["vacated"]);
    expect(legalNextStages("vacated")).toEqual(["walk"]);
    expect(legalNextStages("walk")).toEqual(["scoped"]);
    expect(legalNextStages("scoped")).toEqual(["pending_approval"]);
    expect(legalNextStages("pending_approval")).toEqual(["approved"]);
    expect(legalNextStages("approved")).toEqual(["scheduled"]);
    expect(legalNextStages("scheduled")).toEqual(["in_progress"]);
    expect(legalNextStages("in_progress")).toEqual(["qc"]);
    expect(legalNextStages("qc")).toEqual(["ready", "rework"]);
    expect(legalNextStages("rework")).toEqual(["in_progress"]);
    expect(legalNextStages("ready")).toEqual([]);
  });

  it("forbids skipping stages and forbids rework except after qc", () => {
    expect(() => assertLegalTransition("notice", "walk")).toThrow(IllegalTurnTransitionError);
    expect(() => assertLegalTransition("in_progress", "rework")).toThrow(IllegalTurnTransitionError);
    expect(() => assertLegalTransition("in_progress", "ready")).toThrow(IllegalTurnTransitionError);
    expect(() => assertLegalTransition("pending_approval", "scheduled")).toThrow(
      IllegalTurnTransitionError,
    );
    expect(isLegalTransition("qc", "rework")).toBe(true);
    expect(isLegalTransition("qc", "ready")).toBe(true);
    expect(() => assertLegalTransition("ready", "in_progress")).toThrow(TerminalTurnError);
  });

  it("remaining stages from rework loop back through in_progress", () => {
    expect(remainingStages("ready")).toEqual([]);
    expect(remainingStages("qc")).toEqual(["qc", "ready"]);
    expect(remainingStages("rework")).toEqual(["rework", "in_progress", "qc", "ready"]);
    expect(remainingStages("pending_approval")[0]).toBe("pending_approval");
    expect(remainingStages("pending_approval").at(-1)).toBe("ready");
  });
});
