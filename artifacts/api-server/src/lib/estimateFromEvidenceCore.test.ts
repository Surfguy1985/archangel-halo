import { describe, expect, it } from "vitest";
import {
  acceptPolishedLines,
  draftEstimateFromLines,
  heuristicExtractLines,
  linesFromWalkCaptures,
} from "./estimateFromEvidenceCore";
import type { CatalogCandidate } from "./catalogMatchCore";

describe("estimate.from_evidence", () => {
  it("extracts priced lines and skips totals", () => {
    const lines = heuristicExtractLines(
      ["Bid Proposal", "Demo kitchen          $1,250.00", "Grand total $1,250.00"].join("\n"),
    );
    expect(lines).toEqual([{ description: "Demo kitchen", amount: 1250, qty: 1, unit: null }]);
  });

  it("pulls qty/unit tails", () => {
    const lines = heuristicExtractLines("Interior paint  120 sf  $168.00\n");
    expect(lines[0]).toMatchObject({ description: "Interior paint", qty: 120, unit: "sf", amount: 168 });
  });

  it("matches extracted lines to the HALO catalog", () => {
    const catalog: CatalogCandidate[] = [
      { id: "c1", name: "interior paint", unit: "sf", rate: 1.4, source: "catalog_item" },
    ];
    const draft = draftEstimateFromLines(heuristicExtractLines("Interior paint $168"), catalog);
    expect(draft[0]?.match?.id).toBe("c1");
    expect(draft[0]?.suggestedRate).toBe(1.4);
  });

  it("rolls walk captures into lines", () => {
    const lines = linesFromWalkCaptures([
      { service: "Paint", qty: 1, unitPrice: 200, note: null },
      { service: "Paint", qty: 2, unitPrice: null, note: null },
    ]);
    expect(lines).toEqual([{ description: "Paint", amount: 200, qty: 3, unit: null }]);
  });

  it("falls back to heuristic lines when the model returns junk", () => {
    const heuristic = heuristicExtractLines("Demo kitchen $1,250.00");
    expect(acceptPolishedLines({ lines: "nope" }, heuristic)).toEqual(heuristic);
    expect(acceptPolishedLines({ lines: [{ description: "Paint", amount: 40, qty: 2, unit: "hr" }] }, heuristic)).toEqual([
      { description: "Paint", amount: 40, qty: 2, unit: "hr" },
    ]);
  });
});
