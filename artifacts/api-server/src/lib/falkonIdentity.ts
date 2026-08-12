/**
 * Falkon Ops — HALO Ed25519 signing identity.
 *
 * HALO generates one Ed25519 keypair per deployment. The keypair is stored
 * in the `falkon_identity` DB table (private key AES-256-GCM encrypted with
 * SESSION_SECRET; public key in plain PEM). The pair is regenerated only if
 * the DB row is missing — restarts reuse the persisted key so Falkon's trust
 * binding stays valid.
 *
 * Public key is served at /.well-known/falkon-trust.json and submitted to
 * Falkon during Connect & Verify step 2 (trust binding).
 *
 * Private key is used to sign every outbound S2S request to the Falkon
 * gateway via HALO-Signature header.
 */

import {
  generateKeyPairSync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type KeyObject,
  createPrivateKey,
} from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PARTNER_ID = "archangel-halo";
const CLIENT_ID = "fk_archangel_halo_prod";
const ALGORITHM = "Ed25519";
/** Trust doc validity: 1 year rolling */
const TRUST_TTL_MS = 365 * 24 * 3_600_000;

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-GCM with SESSION_SECRET-derived key)
// ---------------------------------------------------------------------------

function encryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET ?? "";
  // Derive 32-byte key by hashing the session secret (SHA-256)
  const { createHash } = require("node:crypto");
  return createHash("sha256").update(secret).digest();
}

function encryptPrivateKey(pem: string): string {
  const iv = randomBytes(12);
  const key = encryptionKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(pem, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv):base64(tag):base64(encrypted)
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptPrivateKey(stored: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted key format");
  const iv = Buffer.from(parts[0]!, "base64");
  const tag = Buffer.from(parts[1]!, "base64");
  const encrypted = Buffer.from(parts[2]!, "base64");
  const key = encryptionKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

// ---------------------------------------------------------------------------
// In-memory cache (avoids DB round-trips on every request)
// ---------------------------------------------------------------------------

let _privateKey: KeyObject | null = null;
let _publicKeyPem: string | null = null;
let _issuedAt: string | null = null;
let _expiresAt: string | null = null;

// ---------------------------------------------------------------------------
// Bootstrap — call once at server startup
// ---------------------------------------------------------------------------

/**
 * Ensure HALO has a persisted Ed25519 keypair. Generates one if missing.
 * Populates the in-memory cache so `getSigningKey()` / `getPublicKeyPem()`
 * are synchronous for the request path.
 */
export async function ensureFalkonIdentity(): Promise<void> {
  try {
    // Check for existing identity row
    const rows = await db.execute(
      sql`SELECT private_key_enc, public_key_pem, issued_at, expires_at
          FROM falkon_identity LIMIT 1`,
    );
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];

    if (row) {
      _publicKeyPem = row.public_key_pem as string;
      _issuedAt = row.issued_at as string;
      _expiresAt = row.expires_at as string;
      const pem = decryptPrivateKey(row.private_key_enc as string);
      _privateKey = createPrivateKey(pem);
      logger.info({ partnerId: PARTNER_ID }, "falkon: loaded existing Ed25519 identity");
      return;
    }

    // Generate new keypair
    const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TRUST_TTL_MS).toISOString();
    const privateKeyEnc = encryptPrivateKey(privateKey as string);

    await db.execute(
      sql`INSERT INTO falkon_identity
            (id, partner_id, client_id, private_key_enc, public_key_pem, algorithm, issued_at, expires_at, created_at)
          VALUES
            (gen_random_uuid(), ${PARTNER_ID}, ${CLIENT_ID}, ${privateKeyEnc},
             ${publicKey as string}, ${ALGORITHM}, ${issuedAt}::timestamptz, ${expiresAt}::timestamptz, now())`,
    );

    _publicKeyPem = publicKey as string;
    _issuedAt = issuedAt;
    _expiresAt = expiresAt;
    _privateKey = createPrivateKey(privateKey as string);

    logger.info(
      { partnerId: PARTNER_ID, expiresAt },
      "falkon: generated new Ed25519 identity",
    );
  } catch (err) {
    logger.error({ err }, "falkon: ensureFalkonIdentity failed — signing disabled");
  }
}

// ---------------------------------------------------------------------------
// Public accessors
// ---------------------------------------------------------------------------

/**
 * Returns the Ed25519 private key object for signing outbound S2S requests.
 * May be null if identity bootstrap failed.
 */
export function getSigningKey(): KeyObject | null {
  return _privateKey;
}

/**
 * Returns the public key PEM string for the trust document.
 */
export function getPublicKeyPem(): string | null {
  return _publicKeyPem;
}

/**
 * Returns the full trust document payload served at /.well-known/falkon-trust.json.
 */
export function buildTrustDoc(baseUrl: string): Record<string, unknown> | null {
  if (!_publicKeyPem) return null;
  return {
    partnerId: PARTNER_ID,
    clientId: CLIENT_ID,
    algorithm: ALGORITHM,
    publicKeyPem: _publicKeyPem,
    trustDocUrl: `${baseUrl}/.well-known/falkon-trust.json`,
    webhookUrl: `${baseUrl}/api/falkon/webhook`,
    issuedAt: _issuedAt,
    expiresAt: _expiresAt,
    spec: "falkon-trust/v1",
  };
}
