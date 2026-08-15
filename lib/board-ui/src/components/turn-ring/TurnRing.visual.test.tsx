import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { TurnRingDocument } from "@workspace/api-client-react";
import { TurnRing } from "./TurnRing";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const SIZES = [44, 120, 280] as const;

function fixture(kind: "vendor" | "client" | "rework"): TurnRingDocument {
  const vendor = {
    stage: "in_progress" as const,
    owner: "vendor" as const,
    visitIndex: 0,
    startDeg: 10,
    endDeg: 80,
    durationMs: 86_400_000,
    overP75: false,
    predicted: false,
    actorId: "seed:crew.lead",
  };
  const client = {
    stage: "pending_approval" as const,
    owner: "client" as const,
    visitIndex: 0,
    startDeg: 90,
    endDeg: 160,
    durationMs: 172_800_000,
    overP75: false,
    predicted: false,
    actorId: "seed:regional.north",
  };
  const rework = {
    stage: "rework" as const,
    owner: "vendor" as const,
    visitIndex: 1,
    startDeg: 200,
    endDeg: 300,
    durationMs: 43_200_000,
    overP75: true,
    predicted: false,
    actorId: "seed:crew.lead",
  };
  const arcs =
    kind === "vendor" ? [vendor] : kind === "client" ? [client] : [vendor, rework];
  return {
    daysVacant: 9,
    predictedReadyAt: null,
    confidence: "medium",
    remainingPredictedMs: 0,
    arcs,
  };
}

describe("Turn Ring visual regression (3 sizes × 3 states)", () => {
  for (const size of SIZES) {
    it(`vendor gold at ${size}px`, () => {
      const { container } = render(
        <TurnRing ring={fixture("vendor")} size={size} center="daysVacant" />,
      );
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.getAttribute("width")).toBe(String(size));
      expect(svg?.innerHTML).toContain("#E8C36A");
      expect(svg?.innerHTML).not.toContain("#F07167");
    });

    it(`client hatched/outlined at ${size}px`, () => {
      const { container } = render(
        <TurnRing ring={fixture("client")} size={size} center="daysVacant" />,
      );
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      if (size === 44) {
        expect(svg?.innerHTML).toMatch(/stroke-width="1.5"/);
      } else {
        expect(svg?.innerHTML).toContain("pattern");
        expect(svg?.innerHTML).toContain("rotate(35)");
      }
    });

    it(`rework + over-p75 coral at ${size}px`, () => {
      const { container } = render(
        <TurnRing ring={fixture("rework")} size={size} center="daysVacant" />,
      );
      const svg = container.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg?.innerHTML).toContain("#F07167");
      expect(svg?.innerHTML).toContain("#E8C36A");
    });
  }
});
