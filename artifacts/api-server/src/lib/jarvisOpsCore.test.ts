import { describe, expect, it } from "vitest";
import {
  extractUnitLabel,
  formatOrderPacket,
  matchPerson,
  matchUnitJob,
  personScore,
  resolveRelativeDate,
  sourceMaterials,
  sourceVendors,
} from "./jarvisOpsCore";

describe("resolveRelativeDate", () => {
  const now = new Date(2026, 7, 14); // Fri Aug 14, 2026 local

  it("resolves today and tomorrow from local parts", () => {
    expect(resolveRelativeDate("do it today", now)).toBe("2026-08-14");
    expect(resolveRelativeDate("schedule install for tomorrow", now)).toBe("2026-08-15");
  });

  it("resolves weekday names forward", () => {
    expect(resolveRelativeDate("text Kyann for Monday", now)).toBe("2026-08-17");
  });
});

describe("person matching", () => {
  const crews = [
    { id: "1", name: "Kyann Brooks" },
    { id: "2", name: "Marcus Reed" },
    { id: "3", name: "Ava Chen" },
  ];

  it("matches a first name like Kyann", () => {
    expect(personScore("Kyann", "Kyann Brooks")).toBeGreaterThan(0.9);
    expect(matchPerson("Kyann", crews)?.record.id).toBe("1");
  });

  it("does not match unrelated names", () => {
    expect(matchPerson("Jordan", crews)).toBeNull();
  });
});

describe("unit matching", () => {
  it("extracts unit 624 from operator language", () => {
    expect(extractUnitLabel("order drywall for unit 624 and text Kyann")).toBe("624");
  });

  it("prefers an open job on that unit", () => {
    const jobs = [
      {
        id: "closed",
        jobNo: "J-1",
        unitNo: "624",
        propertyId: "p1",
        propertyName: "Cedar Point",
        status: "complete",
        scheduledOn: null,
      },
      {
        id: "open",
        jobNo: "J-2",
        unitNo: "624",
        propertyId: "p1",
        propertyName: "Cedar Point",
        status: "open",
        scheduledOn: null,
      },
    ];
    expect(matchUnitJob("624", jobs)?.id).toBe("open");
  });
});

describe("supply sourcing", () => {
  it("ranks drywall catalog and vendors", () => {
    const materials = sourceMaterials("drywall", [
      { id: "a", name: "5/8 Drywall sheet", kind: "catalog", rate: 14.5 },
      { id: "b", name: "Interior paint", kind: "catalog", rate: 32 },
      { id: "c", name: "Drywall compound", kind: "inventory", qty: 12 },
    ]);
    expect(materials.map((m) => m.id)).toEqual(["a", "c"]);

    const vendors = sourceVendors(
      "drywall",
      [
        { id: "v1", name: "ABC Building Supply", trade: "drywall", phone: "512-555-0100", city: "Austin" },
        { id: "v2", name: "Spark Electric", trade: "electrical", phone: "512-555-0199", city: "Austin" },
      ],
      "Austin",
    );
    expect(vendors.map((v) => v.id)).toEqual(["v1"]);
  });

  it("formats an order packet the PM can read", () => {
    const packet = formatOrderPacket({
      material: "drywall",
      unitNo: "624",
      propertyName: "Cedar Point",
      city: "Austin",
      neededBy: "2026-08-15",
      materials: [{ id: "a", name: "5/8 Drywall sheet", kind: "catalog", rate: 14.5 }],
      vendors: [{ id: "v1", name: "ABC Building Supply", trade: "drywall", phone: "512-555-0100" }],
    });
    expect(packet).toContain("Unit 624");
    expect(packet).toContain("ABC Building Supply");
    expect(packet).toContain("5/8 Drywall sheet");
  });
});
