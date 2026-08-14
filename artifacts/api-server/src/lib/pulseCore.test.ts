import { describe, expect, it } from "vitest";
import {
  adminPingBody,
  crewDayPingBody,
  crewPingBody,
  predictPulseNeeds,
  propertyStatusLines,
  rankPulseProperties,
  unitOverlayTitle,
  gpsPingBody,
  formatGpsAge,
  isGpsFresh,
  overlayPrimaryAction,
} from "./pulseCore";

describe("Property Pulse ranking", () => {
  it("puts crew-on-site properties first", () => {
    const ranked = rankPulseProperties([
      { id: "a", name: "Summit View", openJobs: 4, crewsOnSite: 0, overdueJobs: 0 },
      { id: "b", name: "Oakridge Apartments", openJobs: 2, crewsOnSite: 1, overdueJobs: 0 },
    ]);
    expect(ranked[0]?.id).toBe("b");
    expect(propertyStatusLines(ranked[0]!).secondary).toBe("Crew On Site");
  });
});

describe("predictPulseNeeds", () => {
  it("surfaces uncrewed jobs as now-urgency", () => {
    const needs = predictPulseNeeds({
      uncrewedJobs: 3,
      overdueInvoices: 1,
      overdueJobs: 0,
      crewsOnSite: 2,
      base44AgeMinutes: 2,
      smsConfigured: true,
    });
    expect(needs[0]?.id).toBe("uncrewed");
    expect(needs[0]?.urgency).toBe("now");
  });

  it("asks to pin GPS when sites have no lock", () => {
    const needs = predictPulseNeeds({
      uncrewedJobs: 0,
      overdueInvoices: 0,
      overdueJobs: 0,
      crewsOnSite: 1,
      base44AgeMinutes: 1,
      smsConfigured: true,
      unpinnedSites: 2,
    });
    expect(needs[0]?.id).toBe("unpinned");
  });

  it("asks to connect Twilio when SMS is down", () => {
    const needs = predictPulseNeeds({
      uncrewedJobs: 0,
      overdueInvoices: 0,
      overdueJobs: 0,
      crewsOnSite: 1,
      base44AgeMinutes: 1,
      smsConfigured: false,
    });
    expect(needs.some((n) => n.id === "sms")).toBe(true);
  });
});

describe("ping copy", () => {
  it("names the unit and job for the crew", () => {
    expect(
      crewPingBody({
        crewFirst: "Kyann",
        jobNo: "J-2012",
        unitNo: "624",
        propertyName: "Oakridge",
        when: "tomorrow",
      }),
    ).toContain("Unit 624");
  });

  it("packs a crew's day into one text", () => {
    const body = crewDayPingBody({
      crewFirst: "Kyann",
      when: "tomorrow",
      stops: [
        { jobNo: "J-2012", unitNo: "8A", propertyName: "Oakridge" },
        { jobNo: "J-2013", unitNo: "2B", propertyName: "Summit View" },
      ],
    });
    expect(body).toContain("tomorrow");
    expect(body).toContain("J-2013");
  });

  it("summarizes admin pressure", () => {
    expect(adminPingBody({ uncrewed: 2, overdue: 1 })).toContain("2 uncrewed");
  });

  it("titles the map overlay like the Pulse seed", () => {
    expect(
      unitOverlayTitle({ unitNo: "8A", category: "Turn", crewName: "Paint Crew" }),
    ).toBe("Unit 8A Turn — Paint Crew");
  });

  it("asks crew to keep GPS live", () => {
    expect(gpsPingBody({ site: "Oakridge", unit: "8A" })).toContain("Unit 8A");
    expect(gpsPingBody({ site: "Oakridge" })).toContain("crew portal");
  });

  it("formats last-seen GPS without pretending it is live", () => {
    const now = Date.parse("2026-08-14T15:00:00");
    expect(formatGpsAge(new Date(now - 12_000).toISOString(), now)).toBe("12s ago");
    expect(formatGpsAge(new Date(now - 12 * 60_000).toISOString(), now)).toBe("12m ago");
    expect(isGpsFresh(new Date(now - 30_000).toISOString(), now)).toBe(true);
    expect(isGpsFresh(new Date(now - 12 * 60_000).toISOString(), now)).toBe(false);
  });

  it("picks one overlay action from pin → wake GPS → twin", () => {
    expect(overlayPrimaryAction({ pinned: false, gpsFresh: false, hasCrewToPing: true })).toBe("pin");
    expect(overlayPrimaryAction({ pinned: true, gpsFresh: false, hasCrewToPing: true })).toBe("gps");
    expect(overlayPrimaryAction({ pinned: true, gpsFresh: true, hasCrewToPing: true })).toBe("twin");
    expect(overlayPrimaryAction({ pinned: true, gpsFresh: false, hasCrewToPing: false })).toBe("twin");
  });
});
