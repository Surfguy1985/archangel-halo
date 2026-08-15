import { describe, expect, it } from "vitest";
import {
  compareRooms,
  computeTurnVerificationHash,
  explainIntegrityFlags,
  haversineM,
  merkleRoot,
  pairRooms,
  roomLabel,
  roomSortKey,
  sha256Hex,
} from "@workspace/db";

describe("evidence ledger math", () => {
  it("orders rooms living → kitchen → beds → baths → exterior → other", () => {
    const rooms = ["other", "bath 2", "bed 1", "kitchen", "living", "exterior", "bed 2", "bath 1"];
    expect([...rooms].sort(compareRooms)).toEqual([
      "living",
      "kitchen",
      "bed 1",
      "bed 2",
      "bath 1",
      "bath 2",
      "exterior",
      "other",
    ]);
    expect(roomSortKey("bedroom 3")[0]).toBeGreaterThan(roomSortKey("bed 1")[0]);
    expect(roomLabel("bed 1")).toBe("Bed 1");
  });

  it("pairs photos by room in canonical order", () => {
    const paired = pairRooms([
      { room: "bath 1", phase: "before" },
      { room: "living", phase: "after" },
      { room: "living", phase: "before" },
      { room: "kitchen", phase: "during" },
    ]);
    expect(paired.map((r) => r.room)).toEqual(["living", "kitchen", "bath 1"]);
    expect(paired[0]!.before).toHaveLength(1);
    expect(paired[0]!.after).toHaveLength(1);
  });

  it("never hides integrity flags and uses plain copy", () => {
    const flags = explainIntegrityFlags(
      {
        gps_outside_geofence: true,
        device_clock_skew_seconds: 140,
        exif_missing: true,
        duplicate_hash: true,
      },
      140,
    );
    expect(flags.map((f) => f.code)).toEqual([
      "device_clock_skew_seconds",
      "gps_outside_geofence",
      "exif_missing",
      "duplicate_hash",
    ]);
    expect(flags.find((f) => f.code === "gps_outside_geofence")?.explanation).toMatch(
      /Location was 140m from the unit/,
    );
  });

  it("computes a merkle root that changes when one evidence hash is mutated", () => {
    const evidence = [
      { id: "a", sha256: sha256Hex("one") },
      { id: "b", sha256: sha256Hex("two") },
    ];
    const timeline = [
      { id: "t1", stage: "walk", event: "entered", occurredAt: "2026-08-01T13:00:00.000Z" },
    ];
    const root = computeTurnVerificationHash({ evidence, timeline });
    expect(root).toHaveLength(64);
    expect(merkleRoot([])).toBe(sha256Hex(""));
    const mutated = computeTurnVerificationHash({
      evidence: [
        { id: "a", sha256: sha256Hex("MUTATED") },
        { id: "b", sha256: sha256Hex("two") },
      ],
      timeline,
    });
    expect(mutated).not.toBe(root);
  });

  it("reports ~140m between 32.7767 and 32.778 at the same longitude", () => {
    const meters = haversineM(32.7767, -96.8089, 32.778, -96.8089);
    expect(meters).toBeGreaterThan(130);
    expect(meters).toBeLessThan(160);
  });
});
