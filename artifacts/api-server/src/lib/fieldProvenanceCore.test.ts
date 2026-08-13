import { describe, expect, it } from "vitest";
import { HALO_FIELD_EVIDENCE_RESOURCE, buildFieldEvidence } from "./fieldProvenanceCore";

describe("field provenance evidence packet", () => {
  it("keys HALO-owned telemetry under halo_field and cites the Base44 job id", () => {
    const row = buildFieldEvidence({
      eventId: "chk-1",
      kind: "checkin",
      crewId: "crew-1",
      haloJobId: "halo-job-9",
      base44JobId: "b44-crew-job-3",
      lat: 30.2672,
      lng: -97.7431,
      at: new Date("2026-08-13T18:00:00.000Z"),
      propertyName: "Oak",
    });
    expect(row.resource).toBe(HALO_FIELD_EVIDENCE_RESOURCE);
    expect(row.base44Id).toBe("chk-1");
    expect(row.kind).toBe("checkin");
    expect(row.body).toContain("halo-job-9");
    expect(row.body).toContain("b44-crew-job-3");
    expect(row.body).not.toMatch(/client jobId/i);
    expect(row.payloadHash).toHaveLength(64);
  });

  it("still writes when the HALO job has no Base44 map", () => {
    const row = buildFieldEvidence({
      eventId: "chk-2",
      kind: "checkout",
      crewId: "crew-1",
      haloJobId: null,
      base44JobId: null,
      lat: null,
      lng: null,
      at: new Date("2026-08-13T22:00:00.000Z"),
    });
    expect(row.body).toContain("unmapped");
    expect(row.body).toContain("unknown");
  });
});
