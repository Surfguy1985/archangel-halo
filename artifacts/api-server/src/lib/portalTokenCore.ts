/**
 * Crew portal bearer tokens — hash-at-rest (pure, no I/O).
 *
 * The URL bearer is shown once (SMS / office portal-link). The crews row
 * stores sha256 only. Legacy plaintext in portal_token still verifies.
 */

import { createHash, randomBytes } from "node:crypto";

export const PORTAL_TOKEN_HASH_PREFIX = "h:";

export function mintPortalToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashPortalToken(token), tokenPrefix: token.slice(0, 8) };
}

export function hashPortalToken(token: string): string {
  return createHash("sha256").update(`halo-crew-portal:${token}`).digest("hex");
}

export function hashedPortalPlaceholder(tokenHash: string): string {
  return `${PORTAL_TOKEN_HASH_PREFIX}${tokenHash}`;
}

export function isHashedPortalStorage(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^h:[0-9a-f]{64}$/i.test(value);
}

/** Never return a hash placeholder as a URL token. Legacy plaintext is still a bearer. */
export function publicPortalBearer(stored: string | null | undefined): string | null {
  if (!stored || isHashedPortalStorage(stored)) return null;
  return stored;
}

export function portalTokenColumns(minted: { tokenHash: string }): {
  portalToken: string;
  portalTokenHash: string;
} {
  return {
    portalToken: hashedPortalPlaceholder(minted.tokenHash),
    portalTokenHash: minted.tokenHash,
  };
}

export function classifyPortalTokenShape(token: unknown): "ok" | "malformed" {
  if (typeof token !== "string") return "malformed";
  const t = token.trim();
  if (!t || t.length < 16 || t.length > 128) return "malformed";
  if (t.includes("/") || t.includes("..") || t.includes("\0")) return "malformed";
  if (t.startsWith(PORTAL_TOKEN_HASH_PREFIX)) return "malformed";
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return "malformed";
  return "ok";
}
