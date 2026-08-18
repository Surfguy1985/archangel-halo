import { describe, expect, it } from "vitest";
import {
  crewCheckinUrl,
  crewJoinUrl,
  crewPortalUrl,
  normalizeCrewPortalLink,
} from "./crewLinks";

const ORIGIN = "https://halo.example.com";

describe("crew link builder", () => {
  it("builds root-served links for every crew surface", () => {
    expect(crewPortalUrl("abc", ORIGIN)).toBe(`${ORIGIN}/portal/abc`);
    expect(crewCheckinUrl("abc", ORIGIN)).toBe(`${ORIGIN}/checkin/abc`);
    expect(crewJoinUrl("abc", ORIGIN)).toBe(`${ORIGIN}/join/abc`);
  });

  it("never emits the Expo bundler prefix that broke crew phones", () => {
    expect(crewPortalUrl("abc", ORIGIN)).not.toContain("/halo-crew/");
  });

  it("tolerates a trailing slash on the origin", () => {
    expect(crewPortalUrl("abc", `${ORIGIN}/`)).toBe(`${ORIGIN}/portal/abc`);
  });

  it("normalizes bare tokens, paths and absolute URLs to one shape", () => {
    const want = `${ORIGIN}/portal/tok123`;
    expect(normalizeCrewPortalLink("tok123", ORIGIN)).toBe(want);
    expect(normalizeCrewPortalLink("/portal/tok123", ORIGIN)).toBe(want);
    expect(normalizeCrewPortalLink("https://old.example.com/portal/tok123", ORIGIN)).toBe(want);
    // The legacy base-pathed shape must collapse to the canonical one.
    expect(normalizeCrewPortalLink("https://old.example.com/halo-crew/portal/tok123", ORIGIN)).toBe(
      want,
    );
  });

  it("returns null for nothing to link to", () => {
    expect(normalizeCrewPortalLink(null, ORIGIN)).toBeNull();
    expect(normalizeCrewPortalLink("   ", ORIGIN)).toBeNull();
  });
});
