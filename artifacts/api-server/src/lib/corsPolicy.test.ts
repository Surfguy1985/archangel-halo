import { describe, expect, it } from "vitest";
import { corsOriginSetting, parseAllowedOrigins } from "./corsPolicy";

describe("CORS origin policy", () => {
  it("parses a comma allowlist", () => {
    expect(parseAllowedOrigins("https://a.example, https://b.example")).toEqual([
      "https://a.example",
      "https://b.example",
    ]);
  });

  it("uses the allowlist when set", () => {
    expect(
      corsOriginSetting({
        NODE_ENV: "production",
        ALLOWED_ORIGINS: "https://halo.replit.app",
      }),
    ).toEqual(["https://halo.replit.app"]);
  });

  it("denies cross-origin in production when unset", () => {
    expect(corsOriginSetting({ NODE_ENV: "production" })).toBe(false);
    expect(corsOriginSetting({ HALO_ENV: "production" })).toBe(false);
  });

  it("reflects the request origin in non-production when unset", () => {
    expect(corsOriginSetting({ NODE_ENV: "development" })).toBe(true);
  });
});
