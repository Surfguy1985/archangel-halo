import { describe, expect, it } from "vitest";
import { formatUsdCents, signedUsdCents } from "./formatUsdCents";

describe("formatUsdCents", () => {
  it("formats integer-cent strings with commas", () => {
    expect(formatUsdCents("0")).toBe("$0.00");
    expect(formatUsdCents("1245000")).toBe("$12,450.00");
    expect(formatUsdCents("-90")).toBe("-$0.90");
  });

  it("signs a positive delta", () => {
    expect(signedUsdCents("150")).toBe("+$1.50");
    expect(signedUsdCents("-150")).toBe("-$1.50");
    expect(signedUsdCents("0")).toBe("$0.00");
  });
});
