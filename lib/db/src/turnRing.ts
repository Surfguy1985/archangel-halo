/**
 * Turn Ring geometry. SVG draws these arcs; this module owns the math so a
 * two-rework-loop fixture is testable without a DOM.
 */

import type { StageOwner, TurnStage } from "./clientBoardEnums";
import type { StageVisit } from "./turnMetrics";

export type TurnRingArc = {
  stage: TurnStage;
  owner: StageOwner;
  visitIndex: number;
  startDeg: number;
  endDeg: number;
  durationMs: number;
  overP75: boolean;
  predicted: boolean;
};

export function polarToCartesian(
  cx: number,
  cy: number,
  r: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

export function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const sweep = endDeg - startDeg;
  if (sweep <= 0 || r <= 0) return "";
  const start = polarToCartesian(cx, cy, r, startDeg);
  const end = polarToCartesian(cx, cy, r, endDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
}

export function buildTurnRingArcs(args: {
  visits: StageVisit[];
  predictedRemainingMs: number;
  stageP75Ms?: Partial<Record<TurnStage, number | null>>;
}): TurnRingArc[] {
  const elapsed = args.visits.reduce((s, v) => s + Number(v.durationMs), 0);
  const remaining = Math.max(0, args.predictedRemainingMs);
  const total = elapsed + remaining;
  if (total <= 0) return [];

  const arcs: TurnRingArc[] = [];
  let cursor = 0;
  for (const visit of args.visits) {
    const ms = Number(visit.durationMs);
    const sweep = (ms / total) * 360;
    const p75 = args.stageP75Ms?.[visit.stage];
    arcs.push({
      stage: visit.stage,
      owner: visit.owner,
      visitIndex: visit.visitIndex,
      startDeg: cursor,
      endDeg: cursor + sweep,
      durationMs: ms,
      overP75: typeof p75 === "number" && p75 > 0 && ms > p75,
      predicted: false,
    });
    cursor += sweep;
  }
  if (remaining > 0 && cursor < 360) {
    arcs.push({
      stage: "ready",
      owner: "shared",
      visitIndex: 0,
      startDeg: cursor,
      endDeg: 360,
      durationMs: remaining,
      overP75: false,
      predicted: true,
    });
  }
  return arcs;
}
