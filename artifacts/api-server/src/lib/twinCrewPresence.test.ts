import { describe, expect, it } from "vitest";
import {
  countByBuilding,
  DEMO_CREW_PREFIX,
  hasLivePosition,
  isDemoPresenceId,
  isFreshLiveGps,
  mergeTwinPresence,
  THORNBURY_DEMO_SLOTS,
  thornburyDemoPresence,
  twinPresenceLegend,
  wantsTwinDemo,
  type TwinCrewPresence,
} from "./twinCrewPresence.js";
import { buildBuildingPins } from "./buildingSiteOps.js";

const NOW = Date.parse("2026-08-22T16:00:00.000Z");

function live(over: Partial<TwinCrewPresence> = {}): TwinCrewPresence {
  return {
    crewId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    crewName: "Live Crew",
    trade: "Paint",
    lat: 33.0705,
    lng: -96.751,
    at: new Date(NOW - 30_000).toISOString(),
    onSite: true,
    building: 12,
    buildingLabel: "Building 12",
    confidence: "inside",
    meters: 4,
    jobId: "job-1",
    jobNo: "WO-1",
    unitNo: "1214",
    unitFromJob: true,
    title: "Unit 1214 — Live Crew",
    source: "live",
    demo: false,
    fresh: true,
    ...over,
  };
}

describe("wantsTwinDemo", () => {
  it("is off unless the query explicitly asks", () => {
    expect(wantsTwinDemo(undefined)).toBe(false);
    expect(wantsTwinDemo({})).toBe(false);
    expect(wantsTwinDemo({ demo: "0" })).toBe(false);
    expect(wantsTwinDemo({ demo: "no" })).toBe(false);
  });

  it("turns on for deterministic demo query values", () => {
    expect(wantsTwinDemo({ demo: "1" })).toBe(true);
    expect(wantsTwinDemo({ demo: "true" })).toBe(true);
    expect(wantsTwinDemo({ demo: "thornbury" })).toBe(true);
    expect(wantsTwinDemo({ demo: ["1"] })).toBe(true);
  });
});

describe("demo isolation", () => {
  it("labels Thornbury mocks as demo: ids that cannot be GPS crew UUIDs", () => {
    const mocks = thornburyDemoPresence(buildBuildingPins());
    expect(mocks.length).toBe(THORNBURY_DEMO_SLOTS.length);
    for (const row of mocks) {
      expect(isDemoPresenceId(row.crewId)).toBe(true);
      expect(row.crewId.startsWith(DEMO_CREW_PREFIX)).toBe(true);
      expect(row.demo).toBe(true);
      expect(row.source).toBe("demo");
      expect(row.fresh).toBe(false);
      expect(row.onSite).toBe(true);
      expect(row.title).toMatch(/^\[DEMO\]/);
      expect(row.building).toBeGreaterThanOrEqual(1);
      expect(row.building).toBeLessThanOrEqual(20);
      expect(row.lat).not.toBeNull();
      expect(row.lng).not.toBeNull();
    }
  });

  it("never treats a demo row as a live GPS position", () => {
    const [mock] = thornburyDemoPresence();
    expect(hasLivePosition(mock!)).toBe(false);
    expect(isFreshLiveGps(mock!.at, NOW)).toBe(false);
  });
});

describe("mergeTwinPresence", () => {
  it("keeps live GPS and appends demo markers when ids do not collide", () => {
    const merged = mergeTwinPresence([live()], thornburyDemoPresence(), NOW);
    const liveRows = merged.filter((p) => p.source === "live");
    const demoRows = merged.filter((p) => p.demo);
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]!.crewId).toBe(live().crewId);
    expect(liveRows[0]!.fresh).toBe(true);
    expect(demoRows.length).toBe(THORNBURY_DEMO_SLOTS.length);
    expect(demoRows.every((p) => isDemoPresenceId(p.crewId))).toBe(true);
  });

  it("lets a live fix win over a mock at the same crewId", () => {
    const mockAtSameId = {
      ...thornburyDemoPresence()[0]!,
      crewId: live().crewId,
      lat: 33.08,
      lng: -96.7,
      building: 1,
      title: "would overwrite",
    };
    const merged = mergeTwinPresence([live()], [mockAtSameId], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("live");
    expect(merged[0]!.lat).toBe(33.0705);
    expect(merged[0]!.building).toBe(12);
    expect(merged[0]!.demo).toBe(false);
  });

  it("does not let a mock fill in when the live crew exists without GPS", () => {
    const noFix = live({ lat: null, lng: null, at: null, fresh: false, onSite: false });
    const mockAtSameId = { ...thornburyDemoPresence()[0]!, crewId: noFix.crewId };
    const merged = mergeTwinPresence([noFix], [mockAtSameId], NOW);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("live");
    expect(merged[0]!.lat).toBeNull();
  });

  it("still shows other demo crews when one live crew is on site", () => {
    const merged = mergeTwinPresence([live()], thornburyDemoPresence(), NOW);
    expect(countByBuilding(merged)["12"]).toBeGreaterThanOrEqual(1);
    expect(Object.keys(countByBuilding(merged)).length).toBeGreaterThan(1);
  });
});

describe("thornbury rendering states", () => {
  it("hides the demo legend until demo is requested", () => {
    expect(twinPresenceLegend(false).demo).toBeNull();
    expect(twinPresenceLegend(true).demo).toMatch(/DEMO/);
  });

  it("places each mock on a known Thornbury building from the site plan", () => {
    const pins = new Set(buildBuildingPins().map((p) => p.building));
    for (const slot of THORNBURY_DEMO_SLOTS) {
      expect(pins.has(slot.building)).toBe(true);
    }
  });
});
