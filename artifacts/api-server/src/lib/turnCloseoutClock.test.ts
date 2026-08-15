import { describe, expect, it } from "vitest";
import { poIssuedAt, shapeTurnClock } from "./turnCloseoutClock";

const TZ = "America/Chicago";

describe("turn close-out clock", () => {
  it("starts vacant time on the move-out stamp, not import time", () => {
    const clock = shapeTurnClock({
      timezone: TZ,
      noticeGivenAt: new Date("2026-07-01T13:00:00Z"),
      scheduledVacateAt: new Date("2026-07-15T13:00:00Z"),
      actualVacateAt: new Date("2026-07-16T13:00:00Z"),
      createdAt: new Date("2026-07-20T18:00:00Z"),
      readyAt: null,
      po: null,
    });
    expect(clock.vacantSince).toBe("2026-07-16T13:00:00.000Z");
    expect(clock.requestReceivedAt).toBe("2026-07-01T13:00:00.000Z");
    expect(clock.clockStopped).toBe(false);
  });

  it("falls back to the notice move-out date when actual vacate is not stamped", () => {
    const clock = shapeTurnClock({
      timezone: TZ,
      noticeGivenAt: new Date("2026-07-01T13:00:00Z"),
      scheduledVacateAt: new Date("2026-07-15T13:00:00Z"),
      actualVacateAt: null,
      createdAt: new Date("2026-07-02T13:00:00Z"),
      readyAt: null,
      po: null,
    });
    expect(clock.vacantSince).toBe("2026-07-15T13:00:00.000Z");
  });

  it("does not stop until both complete and PO are present", () => {
    const ready = new Date("2026-07-20T13:00:00Z");
    const poAt = new Date("2026-07-22T15:00:00Z");
    const open = shapeTurnClock({
      timezone: TZ,
      noticeGivenAt: new Date("2026-07-01T13:00:00Z"),
      scheduledVacateAt: null,
      actualVacateAt: new Date("2026-07-08T13:00:00Z"),
      createdAt: new Date("2026-07-01T13:00:00Z"),
      readyAt: ready,
      po: null,
    });
    expect(open.clockStopped).toBe(false);
    expect(open.completedAt).toBe(ready.toISOString());

    const closed = shapeTurnClock({
      timezone: TZ,
      noticeGivenAt: new Date("2026-07-01T13:00:00Z"),
      scheduledVacateAt: null,
      actualVacateAt: new Date("2026-07-08T13:00:00Z"),
      createdAt: new Date("2026-07-01T13:00:00Z"),
      readyAt: ready,
      po: { poNumber: "PO-1", receivedAt: poAt },
    });
    expect(closed.clockStopped).toBe(true);
    expect(closed.clockStoppedAt).toBe(poAt.toISOString());
    expect(closed.poNumber).toBe("PO-1");
  });

  it("reads PO issued-on as a civil date in the property zone", () => {
    const created = new Date("2026-08-15T22:00:00Z");
    const issued = poIssuedAt("2026-08-10", created, TZ);
    expect(issued.toISOString()).toBe("2026-08-10T13:00:00.000Z");
  });
});
