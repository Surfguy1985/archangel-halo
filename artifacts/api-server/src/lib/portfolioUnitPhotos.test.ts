import { describe, expect, it } from "vitest";
import {
  groupUnitPhotos,
  isHttpUrl,
  matchPropertyId,
  normalizeSiteKey,
  normalizeUnitKey,
} from "./portfolioUnitPhotos";

describe("portfolio unit photos", () => {
  const properties = [
    { id: "paloma", name: "CAF Demo — Paloma Creek" },
    { id: "thornbury", name: "Thornbury" },
  ];

  it("matches CAF demo names to Base44 community names", () => {
    expect(normalizeSiteKey("CAF Demo — Paloma Creek")).toBe("paloma creek");
    expect(matchPropertyId("Paloma Creek", properties)).toBe("paloma");
    expect(matchPropertyId("Thornbury Apartments", properties)).toBe("thornbury");
    expect(matchPropertyId("Unrelated Place", properties)).toBeNull();
  });

  it("normalizes unit labels", () => {
    expect(normalizeUnitKey("Unit 214")).toBe("214");
    expect(normalizeUnitKey("#12B")).toBe("12b");
  });

  it("rejects non-http media URLs", () => {
    expect(isHttpUrl("https://cdn.example/before.jpg")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("groups before/after by unit and drops unmatched properties", () => {
    const units = groupUnitPhotos(
      [
        {
          id: "b1",
          kind: "before",
          propertyName: "Paloma Creek",
          unitLabel: "214",
          title: "Kitchen",
          mediaUrl: "https://example.com/before.jpg",
          occurredAt: "2026-08-01T12:00:00.000Z",
        },
        {
          id: "a1",
          kind: "after",
          propertyName: "Paloma Creek",
          unitLabel: "Unit 214",
          title: null,
          mediaUrl: "https://example.com/after.jpg",
          occurredAt: "2026-08-03T12:00:00.000Z",
        },
        {
          id: "other",
          kind: "before",
          propertyName: "Some Other PMC",
          unitLabel: "1",
          title: null,
          mediaUrl: "https://example.com/leak.jpg",
          occurredAt: null,
        },
      ],
      properties,
    );
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      propertyId: "paloma",
      propertyName: "CAF Demo — Paloma Creek",
      unitNumber: "214",
    });
    expect(units[0].before.map((p) => p.id)).toEqual(["b1"]);
    expect(units[0].after.map((p) => p.id)).toEqual(["a1"]);
  });
});
