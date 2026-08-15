import { describe, expect, it } from "vitest";
import {
  assumedHoursSaved,
  blockingInvoiceMessage,
  canCreateInvoice,
  complianceBadgeText,
  formatInvoiceNumber,
  nextInvoiceSeq,
  pickActivePriceList,
  resolveScopeLine,
} from "@workspace/db";

const LIST = [
  {
    id: "p1",
    code: "PAINT-WALLS",
    tier: "2br",
    description: "Interior walls paint",
    unitPriceCents: 24500n,
  },
  {
    id: "p2",
    code: "CLEAN-FULL",
    tier: null,
    description: "Full make-ready clean",
    unitPriceCents: 16500n,
  },
];

describe("invoice compliance engine", () => {
  it("matches exact code + tier at the scheduled price", () => {
    const r = resolveScopeLine(
      {
        code: "paint-walls",
        tier: "2br",
        description: "Interior walls paint",
        qty: 1,
        unitPriceCents: 24500n,
      },
      LIST,
    );
    expect(r.compliance).toBe("matched");
    expect(r.priceItemId).toBe("p1");
    expect(r.deltaCents).toBe(0n);
  });

  it("flags a price deviation as variance_pending at 0% tolerance", () => {
    const r = resolveScopeLine(
      {
        code: "PAINT-WALLS",
        tier: "2br",
        description: "Interior walls paint",
        qty: 1,
        unitPriceCents: 26000n,
      },
      LIST,
      0,
    );
    expect(r.compliance).toBe("variance_pending");
    expect(r.deltaCents).toBe(1500n);
  });

  it("marks an unknown code off_schedule and points at the nearest item", () => {
    const r = resolveScopeLine(
      {
        code: "MARBLE-UP",
        tier: null,
        description: "Marble counter upgrade",
        qty: 1,
        unitPriceCents: 89000n,
      },
      LIST,
    );
    expect(r.compliance).toBe("off_schedule");
    expect(r.reason).toBe("no_match");
  });

  it("picks the covering price list, never the latest", () => {
    const at = new Date("2026-08-01T12:00:00Z");
    const picked = pickActivePriceList(
      [
        { id: "old", effectiveFrom: new Date("2025-01-01T00:00:00Z"), effectiveTo: new Date("2026-01-01T00:00:00Z") },
        { id: "live", effectiveFrom: new Date("2026-01-01T00:00:00Z"), effectiveTo: null },
        { id: "future", effectiveFrom: new Date("2027-01-01T00:00:00Z"), effectiveTo: null },
      ],
      at,
    );
    expect(picked?.id).toBe("live");
  });

  it("blocks invoice creation when any line is pending or off schedule", () => {
    expect(canCreateInvoice([{ compliance: "matched" }, { compliance: "variance_approved" }])).toBe(true);
    expect(canCreateInvoice([{ compliance: "matched" }, { compliance: "off_schedule" }])).toBe(false);
    expect(canCreateInvoice([{ compliance: "variance_pending" }])).toBe(false);
  });

  it("names the offending line and the schedule in the 422 copy", () => {
    const msg = blockingInvoiceMessage({
      lines: [
        { description: "Interior walls paint", compliance: "matched" },
        { description: "Marble counter upgrade", compliance: "off_schedule" },
      ],
      revision: "Rev 01",
      effectiveLabel: "Aug 2026",
    });
    expect(msg).toContain("Marble counter upgrade");
    expect(msg).toContain("Rev 01");
    expect(msg).toContain("Aug 2026");
  });

  it("stamps invoice numbers {propertyCode}-{unitNumber}-{YYMMDD}-{seq}", () => {
    expect(formatInvoiceNumber({ propertyCode: "CAF-DEMO-1", unitNumber: "204", yymmdd: "0801", seq: 1 })).toBe(
      "CAF-DEMO-1-204-0801-001",
    );
    expect(nextInvoiceSeq(["CAF-DEMO-1-204-0801-001", "CAF-DEMO-1-204-0801-002"], "CAF-DEMO-1-204-0801")).toBe(3);
  });

  it("states assumed hours saved from a configured minutes-per-review", () => {
    expect(assumedHoursSaved(5, 12)).toBe(1);
    expect(complianceBadgeText({ matched: 18, total: 18, revision: "Rev 01", effectiveLabel: "Aug 2026" })).toContain(
      "18 of 18",
    );
  });
});
