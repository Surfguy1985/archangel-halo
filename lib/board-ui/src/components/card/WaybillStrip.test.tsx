/**
 * UI contract for the waybill dot strip's ping behaviour (useStagePings):
 *
 *   - first render lights already-done dots QUIETLY (no ping storm)
 *   - a refetch that returns the same stages (new array identity!) never pings
 *   - a stage that newly appears fires a one-shot ping on that dot only,
 *     and the ping clears itself after the animation window
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { WaybillStrip, type WaybillStageEntryView } from "./WaybillStrip";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const at = "2026-07-10T08:00:00.000Z";
const stages = (...names: string[]): WaybillStageEntryView[] =>
  names.map((stage) => ({ stage, at, byLabel: null }));

const pingedDots = (el: HTMLElement) => el.querySelectorAll(".fkw-dot.ping");
const litDots = (el: HTMLElement) => el.querySelectorAll(".fkw-dot.on");

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WaybillStrip pings", () => {
  it("mounts with lit dots but no ping", () => {
    const { container } = render(
      <WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed", "delivered")} />,
    );
    expect(litDots(container)).toHaveLength(3);
    expect(pingedDots(container)).toHaveLength(0);
  });

  it("does not ping on an unchanged refetch (fresh array identity)", () => {
    const { container, rerender } = render(
      <WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed")} />,
    );
    // Simulate SSE→refetch delivering the same payload as a brand-new array.
    act(() => {
      rerender(<WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed")} />);
    });
    act(() => {
      rerender(<WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed")} />);
    });
    expect(pingedDots(container)).toHaveLength(0);
    expect(litDots(container)).toHaveLength(2);
  });

  it("pings exactly once when a stage newly lights, then clears", () => {
    const { container, rerender } = render(
      <WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed")} />,
    );
    act(() => {
      rerender(
        <WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed", "delivered")} />,
      );
    });
    const pinged = pingedDots(container);
    expect(pinged).toHaveLength(1);
    expect(litDots(container)).toHaveLength(3);

    // The ping is one-shot: it clears after the animation window…
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(pingedDots(container)).toHaveLength(0);

    // …and the SAME stage arriving again on a later refetch stays quiet.
    act(() => {
      rerender(
        <WaybillStrip code="FLK-TEST1" stages={stages("sealed", "routed", "delivered")} />,
      );
    });
    expect(pingedDots(container)).toHaveLength(0);
  });
});
