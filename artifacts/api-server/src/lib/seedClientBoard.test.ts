import { describe, expect, it } from "vitest";
import { CAF_DEMO_HISTORY_DAYS, CAF_DEMO_PROPERTY_SPECS, CAF_SEED_NAME_PREFIX } from "./seedClientBoard";

describe("demo seed spec (Segment 12)", () => {
  it("seeds 12 properties over 120 days, Paloma / Desert Sage / Redbud first", () => {
    expect(CAF_DEMO_HISTORY_DAYS).toBe(120);
    expect(CAF_DEMO_PROPERTY_SPECS).toHaveLength(12);
    expect(CAF_DEMO_PROPERTY_SPECS[0]!.name).toBe(`${CAF_SEED_NAME_PREFIX}Paloma Creek`);
    expect(CAF_DEMO_PROPERTY_SPECS[1]!.name).toContain("Desert Sage");
    expect(CAF_DEMO_PROPERTY_SPECS[2]!.name).toContain("Redbud Flats");
    expect(CAF_DEMO_PROPERTY_SPECS[0]!.bottleneck).toBe(true);
    expect(CAF_DEMO_PROPERTY_SPECS[2]!.workSource).toBe("in_house");
  });
});
