/**
 * Turn stage graph. Rework is a loop: it may only follow qc, then returns to
 * in_progress. Ready is terminal.
 */

import { TURN_STAGES, type TurnStage } from "./clientBoardEnums";

export class IllegalTurnTransitionError extends Error {
  readonly code = "illegal_transition" as const;
  constructor(
    readonly from: TurnStage,
    readonly to: TurnStage,
  ) {
    super(`Cannot move a turn from ${from} to ${to}`);
    this.name = "IllegalTurnTransitionError";
  }
}

export class TerminalTurnError extends Error {
  readonly code = "terminal_turn" as const;
  constructor(readonly from: TurnStage) {
    super("This turn is already ready");
    this.name = "TerminalTurnError";
  }
}

/** Happy path, no rework. */
export const HAPPY_PATH: readonly TurnStage[] = TURN_STAGES.filter((s) => s !== "rework");

const EDGES: Record<TurnStage, readonly TurnStage[]> = {
  notice: ["vacated"],
  vacated: ["walk"],
  walk: ["scoped"],
  scoped: ["pending_approval"],
  pending_approval: ["approved"],
  approved: ["scheduled"],
  scheduled: ["in_progress"],
  in_progress: ["qc"],
  qc: ["ready", "rework"],
  rework: ["in_progress"],
  ready: [],
};

export function legalNextStages(from: TurnStage): readonly TurnStage[] {
  return EDGES[from];
}

export function assertLegalTransition(from: TurnStage, to: TurnStage): void {
  if (from === "ready") throw new TerminalTurnError(from);
  if (!EDGES[from].includes(to)) {
    throw new IllegalTurnTransitionError(from, to);
  }
}

export function isLegalTransition(from: TurnStage, to: TurnStage): boolean {
  return EDGES[from].includes(to);
}

/**
 * Stages still on the clock, including time left in the current stage.
 * Rework inserts the loop back through in_progress → qc → ready.
 */
export function remainingStages(current: TurnStage): TurnStage[] {
  if (current === "ready") return [];
  if (current === "rework") return ["rework", "in_progress", "qc", "ready"];
  const i = HAPPY_PATH.indexOf(current);
  if (i < 0) return [];
  return [...HAPPY_PATH.slice(i)];
}
