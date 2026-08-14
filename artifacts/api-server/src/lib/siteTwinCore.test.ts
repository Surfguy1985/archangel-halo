import { describe, expect, it } from "vitest";
import {
  bboxFromRing,
  fracToLatLng,
  latLngToFrac,
  layoutUnitGrid,
  padBBoxAround,
  snapGpsToFloor,
  unitTitleSummary,
  type FloorUnit,
} from "./siteTwinCore";

const bbox = { south: 32.77, west: -96.81, north: 32.78, east: -96.8 };
const units: FloorUnit[] = [
  { id: "a", label: "8A", x: 0, y: 0, w: 0.5, h: 0.5 },
  { id: "b", label: "8B", x: 0.5, y: 0, w: 0.5, h: 0.5 },
  { id: "c", label: "9A", x: 0, y: 0.5, w: 0.5, h: 0.5 },
  { id: "d", label: "9B", x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
];
const center = { lat: 32.775, lng: -96.805 };

describe("site twin georeference", () => {
  it("maps the NW canvas corner to the north-west of the bbox", () => {
    const p = fracToLatLng(0, 0, bbox);
    expect(p.lat).toBeCloseTo(bbox.north, 8);
    expect(p.lng).toBeCloseTo(bbox.west, 8);
    const back = latLngToFrac(p, bbox);
    expect(back.x).toBeCloseTo(0, 8);
    expect(back.y).toBeCloseTo(0, 8);
  });

  it("snaps GPS inside unit 8A", () => {
    const pt = fracToLatLng(0.25, 0.25, bbox);
    const snap = snapGpsToFloor(pt, bbox, units, center);
    expect(snap.label).toBe("8A");
    expect(snap.confidence).toBe("inside");
  });

  it("titles the live HUD like a mission chip", () => {
    expect(
      unitTitleSummary({
        unitLabel: "8A",
        crewName: "Kyann Brooks",
        trade: "Paint",
        confidence: "inside",
      }),
    ).toBe("UNIT 8A — Kyann Brooks · Paint · in unit");
  });

  it("builds a bbox from an OSM ring", () => {
    const b = bboxFromRing([
      { lat: 32.77, lng: -96.81 },
      { lat: 32.78, lng: -96.81 },
      { lat: 32.78, lng: -96.8 },
      { lat: 32.77, lng: -96.8 },
    ]);
    expect(b?.north).toBeCloseTo(32.78);
    expect(padBBoxAround(center, 40).north).toBeGreaterThan(center.lat);
  });

  it("lays out a unit grid in 0..1 fractions", () => {
    const boxes = layoutUnitGrid(4, 101);
    expect(boxes).toHaveLength(4);
    expect(boxes[0]?.label).toBe("101");
    expect(boxes[3]?.label).toBe("104");
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(1.001);
      expect(b.y + b.h).toBeLessThanOrEqual(1.001);
    }
  });
});
