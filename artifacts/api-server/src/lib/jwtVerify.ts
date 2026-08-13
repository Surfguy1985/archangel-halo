/**
 * Minimal RS256 JWT verification against a JWKS. No extra dependencies.
 * Used only after TLS fetch of the Enforcer JWKS document.
 */

import { createPublicKey, createSign, createVerify } from "node:crypto";

export interface Jwk {
  kty?: string;
  kid?: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
}

export interface JwtVerifyOptions {
  issuer: string;
  audience?: string | null;
  now?: number;
  clockSkewSec?: number;
}

function b64urlToBuf(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export function decodeJwtUnverified(token: string): {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Buffer;
} | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  try {
    const header = JSON.parse(b64urlToBuf(parts[0]).toString("utf8")) as Record<string, unknown>;
    const payload = JSON.parse(b64urlToBuf(parts[1]).toString("utf8")) as Record<string, unknown>;
    return {
      header,
      payload,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: b64urlToBuf(parts[2]),
    };
  } catch {
    return null;
  }
}

export function publicKeyFromRsaJwk(jwk: Jwk) {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) return null;
  return createPublicKey({ key: { kty: "RSA", n: jwk.n, e: jwk.e }, format: "jwk" });
}

export function verifyRs256Jwt(
  token: string,
  jwks: { keys: Jwk[] },
  opts: JwtVerifyOptions,
): { ok: true; payload: Record<string, unknown> } | { ok: false; reason: "malformed" | "bad_sig" | "claims" } {
  const decoded = decodeJwtUnverified(token);
  if (!decoded) return { ok: false, reason: "malformed" };
  if (decoded.header.alg !== "RS256" || decoded.header.typ && decoded.header.typ !== "JWT") {
    if (decoded.header.alg !== "RS256") return { ok: false, reason: "malformed" };
  }
  const kid = typeof decoded.header.kid === "string" ? decoded.header.kid : null;
  const key =
    (kid ? jwks.keys.find((k) => k.kid === kid) : undefined) ??
    jwks.keys.find((k) => k.kty === "RSA" && (k.use === "sig" || !k.use));
  if (!key) return { ok: false, reason: "bad_sig" };
  const pub = publicKeyFromRsaJwk(key);
  if (!pub) return { ok: false, reason: "bad_sig" };
  const verifier = createVerify("RSA-SHA256");
  verifier.update(decoded.signingInput);
  verifier.end();
  if (!verifier.verify(pub, decoded.signature)) return { ok: false, reason: "bad_sig" };

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.clockSkewSec ?? 60;
  const payload = decoded.payload;
  if (typeof payload.exp === "number" && now > payload.exp + skew) return { ok: false, reason: "claims" };
  if (typeof payload.nbf === "number" && now + skew < payload.nbf) return { ok: false, reason: "claims" };
  if (payload.iss !== opts.issuer) return { ok: false, reason: "claims" };
  if (opts.audience) {
    const aud = payload.aud;
    const okAud = Array.isArray(aud) ? aud.includes(opts.audience) : aud === opts.audience;
    if (!okAud) return { ok: false, reason: "claims" };
  }
  return { ok: true, payload };
}

export function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKeyPem: string,
  header: { alg: "RS256"; typ: "JWT"; kid?: string } = { alg: "RS256", typ: "JWT" },
): string {
  const enc = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const sig = signer.sign(privateKeyPem).toString("base64url");
  return `${signingInput}.${sig}`;
}
