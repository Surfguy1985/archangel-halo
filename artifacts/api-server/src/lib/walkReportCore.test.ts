import { describe, expect, it } from "vitest";
import { HALO_WALK_EVIDENCE_RESOURCE, buildWalkEvidence } from "./walkReportCore";

describe("field.walk_report evidence packet", () => {
  it("binds the walk id as the evidence key under halo_walk", () => {
    const row = buildWalkEvidence({
      walkId: "walk-1",
      propertyName: "Oak",
      kind: "Discovery",
      notes: "Unit 4 bath",
      captureCount: 3,
      jobNos: ["J-2001"],
      endedAt: "2026-08-13T22:00:00.000Z",
    });
    expect(row.resource).toBe(HALO_WALK_EVIDENCE_RESOURCE);
    expect(row.base44Id).toBe("walk-1");
    expect(row.kind).toBe("walk_report");
    expect(row.title).toContain("Oak");
    expect(row.body).toContain("J-2001");
    expect(row.payloadHash).toHaveLength(64);
  });
});
