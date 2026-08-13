/**
 * Falkon inbound webhook — end-to-end integration test.
 *
 * Verifies the complete path:
 *   Falkon signs event → POST /api/falkon/webhook → Ed25519 verified →
 *   stored in falkon_inbound_events (status=processed) →
 *   capability.request dispatched to falkon_cross_requests (awaiting_approval).
 *
 * Requirements:
 *   HALO_E2E_BASE   — e.g. "https://$REPLIT_DEV_DOMAIN/api"
 *   HALO_E2E_COOKIE — e.g. "halo_office_session=..."
 *
 * The server must be started with HALO_TEST_MODE=1 so the
 * POST/DELETE /falkon/admin/test/seed-remote-identity endpoints are active.
 *
 * State contract:
 *   - beforeAll seeds ONE test Ed25519 key into falkon_remote_identity.
 *     The seed endpoint returns the key that was there before (if any).
 *   - afterAll restores (or clears) falkon_remote_identity to exactly the
 *     state it was in before the test run — no permanent mutation.
 *   - The Falkon connection row is never touched, so operator credentials
 *     and outbox events are unaffected.
 *
 *   HALO_TEST_MODE=1 \
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generateKeyPairSync,
  createHash,
  sign as edSign,
} from "node:crypto";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const BASE   = process.env.HALO_E2E_BASE   ?? "";
const COOKIE = process.env.HALO_E2E_COOKIE ?? "";

// ---------------------------------------------------------------------------
// Test Ed25519 keypair — generated once per test run, seeded into the server's
// falkon_remote_identity table so the webhook route trusts events we sign.
// Using our own keypair as a stand-in for the real Falkon gateway key.
// ---------------------------------------------------------------------------

const { privateKey: TEST_PRIVATE_KEY, publicKey: TEST_PUBLIC_KEY_PEM } =
  generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding:  { type: "spki",  format: "pem" },
  });

const TEST_CLIENT_ID = "fk_integration_test";

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function sha256hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/** Encode a Buffer as base64url with no padding — Falkon canonical wire format. */
function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Produce the four X-Falkon-* headers for a webhook event.
 *
 * signingString = clientId + "\n" + timestampMs + "\n" + nonce + "\n" + sha256hex(rawBody)
 */
function buildSignatureHeaders(
  bodyStr: string,
  nonce: string,
  overrideTimestampMs?: number,
): {
  "X-Falkon-Client-Id": string;
  "X-Falkon-Timestamp": string;
  "X-Falkon-Nonce": string;
  "X-Falkon-Signature": string;
} {
  const tsMs = overrideTimestampMs ?? Date.now();
  const bodyHash = sha256hex(bodyStr);
  const signingString = `${TEST_CLIENT_ID}\n${tsMs}\n${nonce}\n${bodyHash}`;
  const sigBuf = edSign(null, Buffer.from(signingString, "utf8"), TEST_PRIVATE_KEY);
  return {
    "X-Falkon-Client-Id": TEST_CLIENT_ID,
    "X-Falkon-Timestamp": String(tsMs),
    "X-Falkon-Nonce":     nonce,
    "X-Falkon-Signature": base64urlEncode(sigBuf),
  };
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function rawFetch(url: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON response */ }
  return { status: res.status, json };
}

/** POST to /api/falkon/webhook (public — no cookie) with a correctly signed body. */
async function postWebhook(
  body: Record<string, unknown>,
  opts: { overrideTimestampMs?: number; overrideNonce?: string } = {},
): Promise<{ status: number; json: any }> {
  const bodyStr = JSON.stringify(body);
  const nonce   = opts.overrideNonce ?? (body.jti as string) ?? randomUUID();
  const sigHeaders = buildSignatureHeaders(bodyStr, nonce, opts.overrideTimestampMs);

  return rawFetch(`${BASE}/falkon/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...sigHeaders },
    body: bodyStr,
  });
}

/** Office-authenticated API call. */
async function api(path: string, init?: RequestInit): Promise<{ status: number; json: any }> {
  return rawFetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

/**
 * Poll GET /falkon/network/requests until a cross-request with the given
 * correlationId appears or the timeout elapses.
 * Returns the found row or null.
 */
async function pollForCrossRequest(
  correlationId: string,
  maxWaitMs = 5_000,
  intervalMs = 250,
): Promise<Record<string, unknown> | null> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await api("/falkon/network/requests?direction=inbound&state=awaiting_approval");
    if (r.status === 200) {
      const rows: any[] = r.json?.requests ?? [];
      const found = rows.find((row) => row.correlation_id === correlationId);
      if (found) return found as Record<string, unknown>;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!BASE || !COOKIE)(
  "falkon webhook: Ed25519 inbound path",
  () => {
    // The remote identity PEM that was in the DB before we started.
    // We restore it (or clear) in afterAll.
    let previousPublicKeyPem: string | null = null;

    // Cross-request rows we created — cancelled in afterAll.
    const cleanupRequestIds: string[] = [];

    // Unique correlation ID per run so ON CONFLICT never silently skips.
    const capCorrelationId = `test-cap-${Date.now()}-${randomUUID().slice(0, 8)}`;

    // -----------------------------------------------------------------------
    // Setup — seed the test remote identity; save what was there before.
    // Does NOT touch falkon_connections or any outbox events.
    // -----------------------------------------------------------------------
    beforeAll(async () => {
      const seed = await api("/falkon/admin/test/seed-remote-identity", {
        method: "POST",
        body: JSON.stringify({ publicKeyPem: TEST_PUBLIC_KEY_PEM }),
      });
      if (seed.status === 404) {
        throw new Error(
          "Seed endpoint returned 404 — restart the API server with HALO_TEST_MODE=1",
        );
      }
      expect(seed.status, "POST /falkon/admin/test/seed-remote-identity").toBe(200);
      // Capture so afterAll can restore the exact key that was there before.
      previousPublicKeyPem = seed.json?.previousPublicKeyPem ?? null;
    });

    // -----------------------------------------------------------------------
    // Teardown — restore falkon_remote_identity to exactly its pre-test state.
    // -----------------------------------------------------------------------
    afterAll(async () => {
      // Cancel any cross-request rows the tests created
      for (const id of cleanupRequestIds) {
        await api(`/falkon/network/requests/${id}/cancel`, { method: "POST" }).catch(() => {});
      }

      // Restore (or clear) the remote identity
      await api("/falkon/admin/test/seed-remote-identity", {
        method: "DELETE",
        body: JSON.stringify(
          previousPublicKeyPem
            ? { restorePublicKeyPem: previousPublicKeyPem }
            : {},
        ),
      }).catch(() => {
        // Best-effort — don't fail the suite if the server is already down
      });
    });

    // -----------------------------------------------------------------------
    // Test 1 — basic Ed25519-signed event is accepted
    // -----------------------------------------------------------------------
    it("accepts a correctly Ed25519-signed event and returns { ok: true }", async () => {
      const jti = `test-ping-${randomUUID()}`;
      const r = await postWebhook({
        jti,
        eventType: "partner.verify.ping",
        payload:   { nonce: "round-trip-nonce-abc" },
      });

      expect(r.status).toBe(200);
      expect(r.json?.ok).toBe(true);
      expect(r.json?.deduplicated).toBeFalsy();
    });

    // -----------------------------------------------------------------------
    // Test 2 — capability.request surfaces in the approval queue
    // -----------------------------------------------------------------------
    it(
      "stores a capability.request event in falkon_cross_requests as awaiting_approval",
      async () => {
        const jti = `test-cap-req-${randomUUID()}`;

        const r = await postWebhook({
          jti,
          eventType: "capability.request",
          payload: {
            correlationId: capCorrelationId,
            capabilityId:  "halo.job.dispatch",
            summary:       "Integration test — request dispatch capability",
            requester: {
              domain:       "test.falkon-partner.example.com",
              businessName: "Test Falkon Partner Inc.",
            },
            sharedData:  { propertyId: "test-prop-001" },
            externalRef: jti,
          },
        });

        expect(r.status).toBe(200);
        expect(r.json?.ok).toBe(true);

        // Poll until the async dispatcher writes the cross-request row
        const found = await pollForCrossRequest(capCorrelationId);

        expect(found, "cross-request row must exist in falkon_cross_requests").toBeTruthy();
        expect(found!.approval_state).toBe("awaiting_approval");
        expect(found!.capability_id).toBe("halo.job.dispatch");
        expect(found!.direction).toBe("inbound");

        if (found?.id) cleanupRequestIds.push(found.id as string);
      },
    );

    // -----------------------------------------------------------------------
    // Test 3 — duplicate nonce is gracefully deduplicated
    // -----------------------------------------------------------------------
    it("returns { ok: true, deduplicated: true } for a repeated nonce", async () => {
      const jti = `test-dup-${randomUUID()}`;
      const body: Record<string, unknown> = {
        jti,
        eventType: "partner.verify.ping",
        payload:   { nonce: "dup-test-nonce" },
      };

      // First send — accepted normally
      const r1 = await postWebhook(body);
      expect(r1.status).toBe(200);
      expect(r1.json?.ok).toBe(true);
      expect(r1.json?.deduplicated).toBeFalsy();

      // Second send with the same jti/nonce — must be deduplicated.
      // Re-sign with a fresh timestamp so the 5-minute gate doesn't interfere.
      const r2 = await postWebhook(body);
      expect(r2.status).toBe(200);
      expect(r2.json?.ok).toBe(true);
      expect(r2.json?.deduplicated).toBe(true);
    });

    // -----------------------------------------------------------------------
    // Test 4 — stale timestamp rejected with 400
    // -----------------------------------------------------------------------
    it("rejects an event whose timestamp is older than 5 minutes with 400", async () => {
      const jti = `test-stale-${randomUUID()}`;

      // 6 minutes in the past — outside the ±5-minute acceptance window
      const staleTs = Date.now() - 6 * 60 * 1_000;

      const r = await postWebhook(
        {
          jti,
          eventType: "partner.verify.ping",
          payload:   {},
        },
        { overrideTimestampMs: staleTs },
      );

      expect(r.status).toBe(400);
      expect(String(r.json?.error ?? "")).toMatch(/timestamp/i);
    });
  },
);
