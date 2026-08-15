import { describe, expect, it } from "vitest";
import {
  computePresenceDay,
  downsampleTrail,
  humanMinutes,
  padBBoxAround,
  type FloorUnit,
  type TrackPing,
} from "./siteTwinCore.js";

// A 90m box around a site with two units side by side, so a ping can be placed
// squarely inside one of them.
const CENTER = { lat: 32.9, lng: -96.8 };
const BBOX = padBBoxAround(CENTER, 45);

const UNITS: FloorUnit[] = [
  { id: "u1", label: "101", x: 0.05, y: 0.05, w: 0.4, h: 0.4 },
  { id: "u2", label: "102", x: 0.55, y: 0.05, w: 0.4, h: 0.4 },
];

/** Centre of a unit box, in real coordinates. */
function centerOf(unit: FloorUnit): { lat: number; lng: number } {
  const x = unit.x + unit.w / 2;
  const y = unit.y + unit.h / 2;
  return {
    lat: BBOX.north - y * (BBOX.north - BBOX.south),
    lng: BBOX.west + x * (BBOX.east - BBOX.west),
  };
}

function pingsAt(unit: FloorUnit, startMs: number, count: number, everyMs = 30_000): TrackPing[] {
  const c = centerOf(unit);
  return Array.from({ length: count }, (_, i) => ({
    lat: c.lat,
    lng: c.lng,
    at: new Date(startMs + i * everyMs).toISOString(),
  }));
}

const T0 = Date.parse("2026-08-14T14:00:00.000Z");

describe("computePresenceDay", () => {
  it("returns an empty day when there are no pings", () => {
    const day = computePresenceDay([], BBOX, UNITS, CENTER);
    expect(day.visits).toEqual([]);
    expect(day.onSiteMinutes).toBe(0);
    expect(day.firstSeenAt).toBeNull();
  });

  it("collapses a long stay into a single visit with real minutes", () => {
    // 30s cadence for an hour.
    const day = computePresenceDay(pingsAt(UNITS[0]!, T0, 121), BBOX, UNITS, CENTER);
    expect(day.visits).toHaveLength(1);
    expect(day.visits[0]!.unitId).toBe("u1");
    expect(day.visits[0]!.minutes).toBe(60);
    expect(day.minutesByUnit.u1).toBe(60);
  });

  it("splits a move between units into two visits", () => {
    const day = computePresenceDay(
      [...pingsAt(UNITS[0]!, T0, 20), ...pingsAt(UNITS[1]!, T0 + 20 * 30_000, 20)],
      BBOX,
      UNITS,
      CENTER,
    );
    expect(day.visits.map((v) => v.unitId)).toEqual(["u1", "u2"]);
    expect(day.visits.every((v) => v.minutes >= 9)).toBe(true);
  });

  it("does not let a single jittery ping split one stay in two", () => {
    // Ten minutes in 101, one stray ping that lands in 102, then back to 101.
    const stray = pingsAt(UNITS[1]!, T0 + 20 * 30_000, 1);
    const day = computePresenceDay(
      [
        ...pingsAt(UNITS[0]!, T0, 20),
        ...stray,
        ...pingsAt(UNITS[0]!, T0 + 21 * 30_000, 20),
      ],
      BBOX,
      UNITS,
      CENTER,
    );
    const inU1 = day.visits.filter((v) => v.unitId === "u1");
    expect(inU1).toHaveLength(1);
    expect(inU1[0]!.minutes).toBeGreaterThanOrEqual(19);
    // The stray blip was too short to count as a visit of its own.
    expect(day.visits.some((v) => v.unitId === "u2")).toBe(false);
  });

  it("ends a visit when the phone goes quiet for a long stretch", () => {
    const morning = pingsAt(UNITS[0]!, T0, 20);
    const afternoon = pingsAt(UNITS[0]!, T0 + 4 * 3_600_000, 20);
    const day = computePresenceDay([...morning, ...afternoon], BBOX, UNITS, CENTER);
    expect(day.visits).toHaveLength(2);
    // The four-hour hole must not be billed as time on site.
    expect(day.onSiteMinutes).toBeLessThan(30);
  });

  it("ignores a drive-by that never becomes a real visit", () => {
    const day = computePresenceDay(pingsAt(UNITS[0]!, T0, 2, 10_000), BBOX, UNITS, CENTER);
    expect(day.visits).toEqual([]);
  });

  it("ignores pings that are nowhere near the site", () => {
    const day = computePresenceDay(
      [{ lat: 33.9, lng: -97.8, at: new Date(T0).toISOString() }],
      BBOX,
      UNITS,
      CENTER,
    );
    expect(day.visits).toEqual([]);
    expect(day.onSiteMinutes).toBe(0);
    // A day spent entirely off the property has no arrival: the roster prints
    // this value as "in at ...", so it must not claim the crew showed up.
    expect(day.firstSeenAt).toBeNull();
  });

  it("does not bridge a stay across the crew actually leaving the property", () => {
    // Ten minutes in 101, a trip off site, then back into 101 minutes later.
    // The gap is inside the jitter window, so only the off-site fix itself can
    // stop this from reading as one unbroken stay.
    const away = [{ lat: 33.9, lng: -97.8, at: new Date(T0 + 20 * 30_000).toISOString() }];
    const day = computePresenceDay(
      [...pingsAt(UNITS[0]!, T0, 20), ...away, ...pingsAt(UNITS[0]!, T0 + 21 * 30_000, 20)],
      BBOX,
      UNITS,
      CENTER,
    );
    const inU1 = day.visits.filter((v) => v.unitId === "u1");
    expect(inU1).toHaveLength(2);
    // Two separate stays of about ten minutes each — never one twenty-minute
    // block that quietly bills the trip away as time in the unit.
    expect(inU1.every((v) => v.minutes <= 11)).toBe(true);
  });

  it("ends the day at the last ON-SITE ping, not a departing ping from the road", () => {
    // Crew works the unit, then their phone keeps reporting from the highway.
    const onSite = pingsAt(UNITS[0]!, T0, 20);
    const drivingHome = [
      { lat: 33.9, lng: -97.8, at: new Date(T0 + 3_600_000).toISOString() },
      { lat: 33.8, lng: -97.7, at: new Date(T0 + 4_200_000).toISOString() },
    ];
    const day = computePresenceDay([...onSite, ...drivingHome], BBOX, UNITS, CENTER);
    // "Out at ..." must be when they left the property, not when the phone
    // stopped moving somewhere else entirely.
    expect(day.lastSeenAt).toBe(new Date(T0 + 19 * 30_000).toISOString());
    expect(day.firstSeenAt).toBe(new Date(T0).toISOString());
  });

  it("takes the arrival time from the first ON-SITE ping, not the first ping", () => {
    // The crew's phone reports from their driveway an hour before they arrive.
    const driveway = [{ lat: 33.9, lng: -97.8, at: new Date(T0).toISOString() }];
    const onSite = pingsAt(UNITS[0]!, T0 + 3_600_000, 20);
    const day = computePresenceDay([...driveway, ...onSite], BBOX, UNITS, CENTER);
    expect(day.firstSeenAt).toBe(new Date(T0 + 3_600_000).toISOString());
    expect(day.lastSeenAt).toBe(new Date(T0 + 3_600_000 + 19 * 30_000).toISOString());
  });

  it("sorts out-of-order pings before measuring", () => {
    const ordered = pingsAt(UNITS[0]!, T0, 40);
    const shuffled = [...ordered].reverse();
    const day = computePresenceDay(shuffled, BBOX, UNITS, CENTER);
    expect(day.visits).toHaveLength(1);
    expect(day.visits[0]!.minutes).toBe(computePresenceDay(ordered, BBOX, UNITS, CENTER).visits[0]!.minutes);
  });
});

describe("humanMinutes", () => {
  it("formats hours and minutes", () => {
    expect(humanMinutes(134)).toBe("2h14m");
    expect(humanMinutes(120)).toBe("2h");
    expect(humanMinutes(47)).toBe("47m");
  });

  it("treats nothing measurable as a fresh arrival", () => {
    expect(humanMinutes(0)).toBe("just arrived");
    expect(humanMinutes(null)).toBe("just arrived");
  });
});

describe("downsampleTrail", () => {
  it("keeps short trails untouched", () => {
    expect(downsampleTrail([1, 2, 3], 10)).toEqual([1, 2, 3]);
  });

  it("thins long trails but keeps both ends", () => {
    const points = Array.from({ length: 5000 }, (_, i) => i);
    const out = downsampleTrail(points, 300);
    expect(out).toHaveLength(300);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(4999);
  });
});
