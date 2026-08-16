import { describe, expect, it } from "vitest";
import {
  extractPoNumber,
  extractUnitLabel,
  isLiveJob,
  matchProperties,
  resolveClientPo,
  type PoJobCandidate,
  type PoPropertyCandidate,
} from "./clientPoIntakeCore";

const PROPERTIES: PoPropertyCandidate[] = [
  { id: "p-maple", name: "Maple Ridge Apartments" },
  { id: "p-oak", name: "Oak Grove", aliases: ["Oakgrove Villas"] },
  { id: "p-maplewood", name: "Maplewood Commons" },
];

function job(over: Partial<PoJobCandidate>): PoJobCandidate {
  return {
    id: over.id ?? "j1",
    jobNo: over.jobNo ?? "JOB-1",
    unitNo: over.unitNo ?? "204",
    propertyId: over.propertyId ?? "p-maple",
    status: over.status ?? "in_progress",
    crewLeaderId: over.crewLeaderId ?? "c1",
  };
}

describe("extractPoNumber", () => {
  it("reads PO with various separators", () => {
    expect(extractPoNumber("here's PO 12345 for unit 204")).toBe("12345");
    expect(extractPoNumber("attach po#98765 to the job")).toBe("98765");
    expect(extractPoNumber("purchase order AB-100 came in")).toBe("AB-100");
    expect(extractPoNumber("P.O. 555 received")).toBe("555");
  });
  it("returns null when there is no PO cue", () => {
    expect(extractPoNumber("send the invoice for unit 204")).toBeNull();
  });
});

describe("extractUnitLabel", () => {
  it("pulls the unit label", () => {
    expect(extractUnitLabel("unit 204")).toBe("204");
    expect(extractUnitLabel("apt #12B")).toBe("12B");
    expect(extractUnitLabel("for #7 at Maple")).toBe("7");
  });
  it("returns null with no unit", () => {
    expect(extractUnitLabel("PO 12345 for Maple Ridge")).toBeNull();
  });
});

describe("isLiveJob", () => {
  it("treats terminal statuses as not live", () => {
    expect(isLiveJob({ status: "complete" })).toBe(false);
    expect(isLiveJob({ status: "paid" })).toBe(false);
    expect(isLiveJob({ status: "cancelled" })).toBe(false);
    expect(isLiveJob({ status: "in_progress" })).toBe(true);
    expect(isLiveJob({ status: "scheduled" })).toBe(true);
  });
});

describe("matchProperties", () => {
  it("matches a single property by name", () => {
    const hits = matchProperties("PO for unit 204 at Maple Ridge Apartments", PROPERTIES);
    expect(hits.map((p) => p.id)).toEqual(["p-maple"]);
  });
  it("matches by alias", () => {
    const hits = matchProperties("PO for Oakgrove Villas unit 3", PROPERTIES);
    expect(hits.map((p) => p.id)).toEqual(["p-oak"]);
  });
  it("returns nothing when no property is named", () => {
    expect(matchProperties("PO 12345 for unit 204", PROPERTIES)).toEqual([]);
  });
  it("requires token boundaries — a name inside a larger word never matches", () => {
    // "oak grove" must NOT match inside "oakgroveish"; it's not a whole-token run.
    const props: PoPropertyCandidate[] = [{ id: "p-oak", name: "Oak" }];
    expect(matchProperties("PO for the oakwood tower unit 5", props)).toEqual([]);
    // But a real whole-token mention still matches.
    expect(matchProperties("PO for Oak building unit 5", props).map((p) => p.id)).toEqual(["p-oak"]);
  });
  it("keeps all equally-specific matches so the caller clarifies instead of guessing", () => {
    const props: PoPropertyCandidate[] = [
      { id: "p1", name: "Riverside" },
      { id: "p2", name: "Riverside", aliases: ["Riverside"] },
    ];
    const hits = matchProperties("PO for Riverside unit 2", props);
    expect(hits.length).toBe(2);
  });
});

describe("resolveClientPo", () => {
  const jobs: PoJobCandidate[] = [
    job({ id: "j-maple-204", unitNo: "204", propertyId: "p-maple", status: "in_progress" }),
    job({ id: "j-maple-301", unitNo: "301", propertyId: "p-maple", status: "scheduled" }),
    job({ id: "j-oak-3", unitNo: "3", propertyId: "p-oak", status: "in_progress" }),
  ];

  it("resolves property → unit → current live job", () => {
    const r = resolveClientPo({
      text: "here's PO 12345 for unit 204 at Maple Ridge Apartments, send to vendor",
      properties: PROPERTIES,
      jobs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.property.id).toBe("p-maple");
      expect(r.unitLabel).toBe("204");
      expect(r.job.id).toBe("j-maple-204");
    }
  });

  it("normalizes the unit label like the unit map (Unit #204 == 204)", () => {
    const r = resolveClientPo({
      text: "PO 12345 for Unit #204 at Maple Ridge Apartments",
      properties: PROPERTIES,
      jobs,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.job.id).toBe("j-maple-204");
  });

  it("clarifies when no PO number present", () => {
    const r = resolveClientPo({
      text: "for unit 204 at Maple Ridge Apartments",
      properties: PROPERTIES,
      jobs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_po_number");
  });

  it("clarifies with candidates when the property is unknown", () => {
    const r = resolveClientPo({
      text: "PO 12345 for unit 204",
      properties: PROPERTIES,
      jobs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no_property");
      expect(r.candidates && r.candidates.length).toBeGreaterThan(0);
    }
  });

  it("clarifies when the unit has no job", () => {
    const r = resolveClientPo({
      text: "PO 12345 for unit 999 at Maple Ridge Apartments",
      properties: PROPERTIES,
      jobs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_unit_job");
  });

  it("clarifies when every job on the unit is closed out", () => {
    const closed: PoJobCandidate[] = [
      job({ id: "j-done", unitNo: "204", propertyId: "p-maple", status: "paid" }),
    ];
    const r = resolveClientPo({
      text: "PO 12345 for unit 204 at Maple Ridge Apartments",
      properties: PROPERTIES,
      jobs: closed,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_live_job");
  });

  it("clarifies when the unit has more than one live job", () => {
    const dupes: PoJobCandidate[] = [
      job({ id: "j-a", unitNo: "204", propertyId: "p-maple", status: "in_progress" }),
      job({ id: "j-b", unitNo: "204", propertyId: "p-maple", status: "scheduled" }),
    ];
    const r = resolveClientPo({
      text: "PO 12345 for unit 204 at Maple Ridge Apartments",
      properties: PROPERTIES,
      jobs: dupes,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("ambiguous_job");
      expect(r.candidates).toHaveLength(2);
    }
  });
});
