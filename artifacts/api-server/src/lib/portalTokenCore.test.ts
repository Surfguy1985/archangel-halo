import { describe, expect, it } from "vitest";
import {
  classifyPortalTokenShape,
  hashPortalToken,
  hashedPortalPlaceholder,
  isHashedPortalStorage,
  mintPortalToken,
  portalTokenColumns,
  publicPortalBearer,
} from "./portalTokenCore";

describe("portal token hash-at-rest", () => {
  it("stores a hash placeholder, never the bearer", () => {
    const minted = mintPortalToken();
    expect(hashPortalToken(minted.token)).toBe(minted.tokenHash);
    expect(minted.tokenHash).toHaveLength(64);
    expect(minted.token.startsWith("h:")).toBe(false);
    const cols = portalTokenColumns(minted);
    expect(cols.portalToken).toBe(hashedPortalPlaceholder(minted.tokenHash));
    expect(cols.portalTokenHash).toBe(minted.tokenHash);
    expect(cols.portalToken).not.toBe(minted.token);
    expect(publicPortalBearer(cols.portalToken)).toBeNull();
  });

  it("still treats legacy plaintext as a bearer", () => {
    expect(publicPortalBearer("abc_legacy-token-value")).toBe("abc_legacy-token-value");
    expect(isHashedPortalStorage("abc_legacy-token-value")).toBe(false);
  });

  it("rejects hash placeholders and junk as URL tokens", () => {
    expect(classifyPortalTokenShape("h:" + "a".repeat(64))).toBe("malformed");
    expect(classifyPortalTokenShape("short")).toBe("malformed");
    expect(classifyPortalTokenShape("has/slashhhhhhhhh")).toBe("malformed");
    expect(classifyPortalTokenShape(mintPortalToken().token)).toBe("ok");
  });
});
