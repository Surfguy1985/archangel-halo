import { describe, expect, it } from "vitest";
import { recommendScheduleMoves } from "./scheduleRecommendCore";

describe("weather.schedule_recommend", () => {
  it("suggests a later clear day and never claims a write", () => {
    const packet = recommendScheduleMoves(
      [
        {
          id: "j1",
          jobNo: "J-1",
          propertyId: "p1",
          propertyName: "Oak",
          scheduledOn: "2026-08-14",
        },
      ],
      [
        {
          propertyId: "p1",
          days: [
            { date: "2026-08-14", severity: "high", summary: "Thunderstorm — heavy rain" },
            { date: "2026-08-15", severity: null, summary: "Clear" },
          ],
        },
      ],
      "2026-08-13",
    );
    expect(packet.writes).toBe(false);
    expect(packet.moves).toHaveLength(1);
    expect(packet.moves[0]).toMatchObject({ fromDate: "2026-08-14", toDate: "2026-08-15" });
    expect(packet.moves[0]!.reason).toContain("Base44");
  });

  it("does not invent a move when the forecast stays bad", () => {
    const packet = recommendScheduleMoves(
      [{ id: "j1", jobNo: "J-1", propertyId: "p1", scheduledOn: "2026-08-14" }],
      [
        {
          propertyId: "p1",
          days: [{ date: "2026-08-14", severity: "high", summary: "Thunderstorm" }],
        },
      ],
      "2026-08-13",
    );
    expect(packet.moves).toHaveLength(0);
    expect(packet.notes[0]).toContain("no clearer day");
  });

  it("ignores past jobs and clear days", () => {
    const packet = recommendScheduleMoves(
      [
        { id: "past", jobNo: "J-0", propertyId: "p1", scheduledOn: "2026-08-01" },
        { id: "ok", jobNo: "J-2", propertyId: "p1", scheduledOn: "2026-08-14" },
      ],
      [
        {
          propertyId: "p1",
          days: [{ date: "2026-08-14", severity: null, summary: "Clear" }],
        },
      ],
      "2026-08-13",
    );
    expect(packet.moves).toHaveLength(0);
  });
});
