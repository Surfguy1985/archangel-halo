import { describe, expect, it } from "vitest";
import { catalogMatchScore, matchCatalogItem, type CatalogCandidate } from "./catalogMatchCore";

const catalog: CatalogCandidate[] = [
  { id: "1", name: "1/2 drywall sheet", unit: "ea", rate: 18, source: "catalog_item" },
  { id: "2", name: "5/8 drywall sheet", unit: "ea", rate: 22, source: "catalog_item" },
  { id: "3", name: "interior paint", unit: "sf", rate: 1.4, source: "price_item" },
];

describe("catalog.lookup Jaccard matcher", () => {
  it("matches same-size drywall over a conflicting thickness", () => {
    const hit = matchCatalogItem("hang 1/2 drywall sheets", catalog);
    expect(hit?.id).toBe("1");
    expect(hit!.score).toBeGreaterThanOrEqual(0.4);
  });

  it("penalizes conflicting size tokens", () => {
    const half = catalogMatchScore("1/2 drywall", { name: "5/8 drywall sheet" });
    const same = catalogMatchScore("1/2 drywall", { name: "1/2 drywall sheet" });
    expect(same).toBeGreaterThan(half);
  });

  it("returns null below threshold", () => {
    expect(matchCatalogItem("unrelated plumbing snake", catalog)).toBeNull();
  });
});
