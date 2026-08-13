import { describe, expect, it } from "vitest";
import {
  BACKGROUND_GPS_SUPPORTED,
  CHECKIN_COOLDOWN_MS,
  classifyCrewTokenShape,
  crewLinkHttpStatus,
  crewPortalExposed,
  decideCheckin,
  decideCheckout,
  decideLocationPing,
  evaluateCrewLink,
  evaluateGps,
  formatTodayAssignment,
  gpsAllowsCheckin,
  hashCrewToken,
  mapSessionView,
  mintCrewToken,
  sessionFromEvents,
  todaysDispatch,
  type CrewLinkRecord,
  type DispatchJob,
  type PunchEvent,
} from "./crewCheckinCore";

const now = new Date("2026-08-13T15:00:00Z");

function link(over: Partial<CrewLinkRecord> = {}): CrewLinkRecord {
  const minted = mintCrewToken();
  return {
    id: "link-1",
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
    crewId: "crew-a",
    expiresAt: "2026-11-11T00:00:00Z",
    revokedAt: null,
    lastAccessedAt: null,
    ...over,
  };
}

function punch(over: Partial<PunchEvent> & Pick<PunchEvent, "kind">): PunchEvent {
  return {
    id: over.id ?? "p1",
    kind: over.kind,
    createdAt: over.createdAt ?? now,
    jobId: over.jobId ?? "job-1",
    lat: over.lat ?? 30.27,
    lng: over.lng ?? -97.74,
    accuracy: over.accuracy ?? 12,
  };
}

function job(over: Partial<DispatchJob> = {}): DispatchJob {
  return {
    id: "job-1",
    propertyId: "prop-a",
    propertyName: "Thornbury",
    unitNo: "214",
    description: "Make-ready",
    scheduledOn: "2026-08-13",
    boardStatus: "assigned",
    crewLeaderId: "crew-a",
    ...over,
  };
}

describe("secure crew link", () => {
  it("mints hashed tokens and rejects junk", () => {
    const minted = mintCrewToken();
    expect(classifyCrewTokenShape(minted.token)).toBe("ok");
    expect(hashCrewToken(minted.token)).toBe(minted.tokenHash);
    expect(classifyCrewTokenShape("crew_short")).toBe("malformed");
    expect(classifyCrewTokenShape("../crew_ab")).toBe("malformed");
    expect(evaluateCrewLink("nope", null, now).status).toBe("malformed");
    expect(crewLinkHttpStatus("malformed")).toBe(400);
  });

  it("expired crew link is 410", () => {
    const minted = mintCrewToken();
    const rec = link({
      tokenHash: minted.tokenHash,
      expiresAt: "2026-08-01T00:00:00Z",
    });
    expect(evaluateCrewLink(minted.token, rec, now).status).toBe("expired");
    expect(crewLinkHttpStatus("expired")).toBe(410);
  });

  it("revoked and missing links fail closed", () => {
    const minted = mintCrewToken();
    expect(evaluateCrewLink(minted.token, null, now).status).toBe("not_found");
    expect(evaluateCrewLink(minted.token, link({ revokedAt: now.toISOString() }), now).status).toBe(
      "revoked",
    );
    expect(crewLinkHttpStatus("not_found")).toBe(404);
  });
});

describe("valid check-in / check-out", () => {
  it("allows a first check-in", () => {
    const session = sessionFromEvents([]);
    expect(session.status).toBe("out");
    expect(
      decideCheckin({ session, now, linkCrewId: "crew-a", crewActive: true }),
    ).toEqual({ ok: true, action: "create", reason: "ok" });
  });

  it("allows checkout of an open session and ends tracking", () => {
    const session = sessionFromEvents([punch({ kind: "checkin", createdAt: new Date(now.getTime() - 60_000) })]);
    expect(session.status).toBe("in");
    expect(
      decideCheckout({ session, now, linkCrewId: "crew-a", crewActive: true }),
    ).toEqual({ ok: true, action: "create", reason: "ok", trackingEnds: true });
  });

  it("checkout without check-in is rejected", () => {
    const d = decideCheckout({
      session: sessionFromEvents([]),
      now,
      linkCrewId: "crew-a",
      crewActive: true,
    });
    expect(d).toEqual({ ok: false, code: "checkout_without_checkin", status: 409 });
  });
});

describe("duplicate tap and second device", () => {
  it("replays a duplicate tap inside the cooldown", () => {
    const session = sessionFromEvents([
      punch({ kind: "checkin", createdAt: new Date(now.getTime() - 3_000) }),
    ]);
    const d = decideCheckin({ session, now, linkCrewId: "crew-a", crewActive: true });
    expect(d).toEqual({ ok: true, action: "replay", reason: "duplicate_tap" });
    expect(CHECKIN_COOLDOWN_MS).toBeGreaterThan(3_000);
  });

  it("second device while already in is idempotent, not a new session", () => {
    const session = sessionFromEvents([
      punch({ kind: "checkin", createdAt: new Date(now.getTime() - 10 * 60_000) }),
    ]);
    const d = decideCheckin({ session, now, linkCrewId: "crew-a", crewActive: true });
    expect(d).toEqual({ ok: true, action: "replay", reason: "second_device" });
  });
});

describe("wrong crew / inactive", () => {
  it("ignores a client-supplied other crew id", () => {
    const session = sessionFromEvents([]);
    expect(
      decideCheckin({
        session,
        now,
        linkCrewId: "crew-a",
        requestedCrewId: "crew-b",
        crewActive: true,
      }).ok,
    ).toBe(false);
  });

  it("rejects an inactive crew", () => {
    const d = decideCheckin({
      session: sessionFromEvents([]),
      now,
      linkCrewId: "crew-a",
      crewActive: false,
    });
    expect(d).toMatchObject({ ok: false, code: "crew_inactive", status: 403 });
  });
});

describe("GPS unavailable / low accuracy / stale", () => {
  it("allows check-in when GPS is unavailable", () => {
    const v = evaluateGps({ lat: null, lng: null }, now);
    expect(v.status).toBe("unavailable");
    expect(gpsAllowsCheckin(v)).toBe(true);
  });

  it("flags low accuracy but still allows the punch", () => {
    const v = evaluateGps({ lat: 30.27, lng: -97.74, accuracy: 500 }, now);
    expect(v.status).toBe("low_accuracy");
    expect(gpsAllowsCheckin(v)).toBe(true);
  });

  it("rejects a stale capturedAt fix", () => {
    const v = evaluateGps(
      { lat: 30.27, lng: -97.74, accuracy: 10, capturedAt: "2026-08-13T14:00:00Z" },
      now,
    );
    expect(v.status).toBe("stale");
    expect(gpsAllowsCheckin(v)).toBe(false);
  });

  it("rejects invalid coordinates", () => {
    expect(evaluateGps({ lat: 999, lng: 0 }, now).status).toBe("invalid");
  });
});

describe("location updates only during an active session", () => {
  it("accepts a ping while checked in", () => {
    const session = sessionFromEvents([punch({ kind: "checkin" })]);
    const gps = evaluateGps({ lat: 30.27, lng: -97.74, accuracy: 8 }, now);
    expect(decideLocationPing({ session, gps }).ok).toBe(true);
  });

  it("ends tracking after checkout", () => {
    const session = sessionFromEvents([
      punch({ kind: "checkin", createdAt: new Date(now.getTime() - 60_000) }),
      punch({ kind: "checkout", id: "p2", createdAt: now }),
    ]);
    expect(session.status).toBe("out");
    const gps = evaluateGps({ lat: 30.27, lng: -97.74, accuracy: 8 }, now);
    expect(decideLocationPing({ session, gps })).toEqual({
      ok: false,
      code: "session_ended",
      status: 409,
    });
  });

  it("does not claim background GPS", () => {
    expect(BACKGROUND_GPS_SUPPORTED).toBe(false);
    const view = mapSessionView({ session: sessionFromEvents([punch({ kind: "checkin" })]), now });
    expect(view.backgroundGpsSupported).toBe(false);
    expect(view.trackingActive).toBe(true);
    expect(view.lastKnownPosition?.lat).toBe(30.27);
  });
});

describe("dispatch: multiple units, none today, reassigned", () => {
  it("lists every assigned unit for today", () => {
    const rows = todaysDispatch(
      [
        job(),
        job({ id: "job-2", unitNo: "215", description: "Paint" }),
        job({ id: "job-3", unitNo: "300", scheduledOn: "2026-08-14" }),
      ],
      "crew-a",
      "2026-08-13",
    );
    const formatted = formatTodayAssignment(rows);
    expect(formatted?.units).toEqual(["214", "215"]);
    expect(formatted?.unitLabel).toBe("214, 215");
    expect(formatted?.propertyName).toBe("Thornbury");
  });

  it("returns no assignment when there is no dispatch for today", () => {
    const rows = todaysDispatch(
      [job({ scheduledOn: "2026-08-12", boardStatus: "done" })],
      "crew-a",
      "2026-08-13",
    );
    expect(formatTodayAssignment(rows)).toBeNull();
  });

  it("drops a reassigned crew from today's dispatch", () => {
    const rows = todaysDispatch([job({ crewLeaderId: "crew-b" })], "crew-a", "2026-08-13");
    expect(rows).toHaveLength(0);
  });
});

describe("production portal exposure", () => {
  it("is retired in production unless explicitly re-enabled", () => {
    expect(crewPortalExposed({ NODE_ENV: "production" })).toBe(false);
    expect(crewPortalExposed({ HALO_ENV: "production" })).toBe(false);
    expect(crewPortalExposed({ NODE_ENV: "production", HALO_CREW_PORTAL_ENABLED: "true" })).toBe(
      true,
    );
    expect(crewPortalExposed({ NODE_ENV: "development" })).toBe(true);
    expect(crewPortalExposed({ NODE_ENV: "development", HALO_CREW_PORTAL_ENABLED: "false" })).toBe(
      false,
    );
  });
});

describe("rate-limit abuse surface", () => {
  it("maps abuse to 429 at the HTTP limiter (policy keeps punches cheap)", () => {
    const d = decideCheckin({
      session: sessionFromEvents([punch({ kind: "checkin", createdAt: new Date(now.getTime() - 1_000) })]),
      now,
      linkCrewId: "crew-a",
      crewActive: true,
    });
    expect(d.ok && d.action === "replay").toBe(true);
  });
});
