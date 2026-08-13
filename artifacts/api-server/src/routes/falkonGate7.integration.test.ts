/**
 * Gate 7 (SHADOW Round-Trip) — integration tests.
 *
 * Exercises both branch paths of runShadowRoundTrip():
 *   1. Stub path  — no eventIngestUrl configured: passes instantly (< 2 s),
 *                   detail contains "stub".
 *   2. Live path  — eventIngestUrl present and reachable: enters the
 *                   falkon_inbound_events poll loop and finds the callback
 *                   event (pre-seeded by the test endpoint).
 *   3. Unreachable gateway — eventIngestUrl set but HEAD probe times out:
 *                   falls back to stub-mode pass.
 *
 * Requirements:
 *   HALO_E2E_BASE   — e.g. "https://$REPLIT_DEV_DOMAIN/api"
 *   HALO_E2E_COOKIE — e.g. "halo_office_session=..."
 *
 * The server must be started with HALO_TEST_MODE=1 to activate the
 * POST /falkon/admin/test/gate7-roundtrip endpoint.
 *
 * State contract:
 *   - event_ingest_url on falkon_connections is always restored to its
 *     pre-test value (the test endpoint handles this in a finally block).
 *   - Any seeded falkon_inbound_events row is deleted by the test endpoint.
 *   - No other persistent state is mutated.
 *
 * Run with:
 *   HALO_TEST_MODE=1 \
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const BASE   = process.env.HALO_E2E_BASE   ?? "";
const COOKIE = process.env.HALO_E2E_COOKIE ?? "";

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function api(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json };
}

async function gate7Roundtrip(body: {
  ingestUrl?: string | null;
  seedInboundEvent?: boolean;
  overrideJobId?: string;
  forceMode?: "stub" | "live";
}): Promise<{ status: number; json: any }> {
  return api("/falkon/admin/test/gate7-roundtrip", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!BASE || !COOKIE)(
  "Gate 7: SHADOW round-trip branch coverage",
  () => {
    // -----------------------------------------------------------------------
    // Test 1 — Stub path: no eventIngestUrl configured
    //
    // When the connection has no eventIngestUrl, isStubMode() returns
    // { stub: true } immediately.  Gate 7 must pass without entering the
    // poll loop — the wall-clock time must be well under 2 s (no 15 s wait).
    // -----------------------------------------------------------------------
    it(
      "passes instantly in stub mode when no eventIngestUrl is configured",
      async () => {
        const t0 = Date.now();
        const r = await gate7Roundtrip({ ingestUrl: null });
        const durationMs = Date.now() - t0;

        // Endpoint must be reachable (HALO_TEST_MODE=1 required)
        if (r.status === 404) {
          throw new Error(
            "Test endpoint returned 404 — restart the API server with HALO_TEST_MODE=1",
          );
        }

        expect(r.status, "HTTP 200 from gate7-roundtrip").toBe(200);
        expect(r.json.passed, "Gate 7 must pass in stub mode").toBe(true);

        // "stub" must appear in the detail so callers can distinguish the path
        expect(
          String(r.json.detail ?? ""),
          "detail must contain 'stub'",
        ).toMatch(/stub/i);

        // Must resolve well under 2 s — stub mode should not wait for any poll
        expect(
          durationMs,
          `Wall-clock time ${durationMs} ms must be < 2000 ms (stub should not poll)`,
        ).toBeLessThan(2_000);
      },
    );

    // -----------------------------------------------------------------------
    // Test 2 — Live path: poll loop exercised with a pre-seeded callback event
    //
    // We force "live" mode to bypass the isStubMode() probe and pre-seed a
    // falkon_inbound_events row that matches the overrideJobId.  Gate 7 enters
    // the poll loop, finds the row on the first iteration, and returns passed.
    // The poll path is confirmed when the response contains "Round-trip" or
    // the seededEventId in the detail.
    // -----------------------------------------------------------------------
    it(
      "polls falkon_inbound_events and finds the callback when a live gateway is configured",
      async () => {
        const overrideJobId = `gate7-live-test-${Date.now()}-${randomUUID().slice(0, 8)}`;

        const r = await gate7Roundtrip({
          // Any reachable URL — the test bypasses the reachability probe via
          // forceMode, so the value only matters for event_ingest_url patching.
          ingestUrl: "https://building-blocks--austpryb1.replit.app/api/events/ingest",
          seedInboundEvent: true,
          overrideJobId,
          // Skip the isStubMode() HEAD probe entirely — we're testing the poll
          // loop, not gateway reachability detection.
          forceMode: "live",
        });

        if (r.status === 404) {
          throw new Error(
            "Test endpoint returned 404 — restart the API server with HALO_TEST_MODE=1",
          );
        }

        expect(r.status, "HTTP 200 from gate7-roundtrip").toBe(200);
        expect(r.json.passed, "Gate 7 must pass when callback event is found").toBe(true);

        // Detail must contain "Round-trip" — confirming the live poll path ran
        expect(
          String(r.json.detail ?? ""),
          "detail must confirm round-trip (poll loop exercised)",
        ).toMatch(/round-trip/i);

        // seededEventId is echoed back — confirms the poll found our row
        expect(
          r.json.seededEventId,
          "seededEventId must be present in response",
        ).toBeTruthy();
      },
    );

    // -----------------------------------------------------------------------
    // Test 3 — Configured URL (even unreachable) puts Gate 7 in live mode
    //
    // After the policy change in Task #369, isStubMode() no longer probes
    // reachability: ANY configured eventIngestUrl triggers the live poll path.
    // A configured-but-down gateway must FAIL Gate 7, not silently auto-pass
    // in stub mode, so operators know the round-trip is broken.
    //
    // We verify the live path is taken by pre-seeding a callback event and
    // confirming Gate 7 passes with a "Round-trip" detail (not "stub").
    // The URL is set to an RFC 5737 TEST-NET address (guaranteed unreachable)
    // to prove reachability is no longer part of the stub/live decision.
    // -----------------------------------------------------------------------
    it(
      "enters live poll mode for any configured gateway URL regardless of reachability",
      async () => {
        const overrideJobId = `gate7-unreach-test-${Date.now()}-${randomUUID().slice(0, 8)}`;

        const r = await gate7Roundtrip({
          // Unreachable address — but isStubMode() no longer probes it, so
          // Gate 7 goes live and should find the pre-seeded callback event.
          ingestUrl: "http://192.0.2.1:19999/unreachable",
          seedInboundEvent: true,
          overrideJobId,
          // No forceMode — we exercise the real isStubMode() logic to confirm
          // that a configured URL (even unreachable) yields stub=false.
        });

        if (r.status === 404) {
          throw new Error(
            "Test endpoint returned 404 — restart the API server with HALO_TEST_MODE=1",
          );
        }

        expect(r.status, "HTTP 200 from gate7-roundtrip").toBe(200);
        expect(
          r.json.passed,
          "Gate 7 must pass when the live poll finds the pre-seeded callback event",
        ).toBe(true);

        // Must say "Round-trip" — confirming the live poll path ran (not stub)
        expect(
          String(r.json.detail ?? ""),
          "detail must confirm round-trip (live poll path, not stub fallback)",
        ).toMatch(/round-trip/i);

        // Must NOT contain "stub" — proving the unreachable URL did not trigger
        // the stub fallback that the old isStubMode() would have applied.
        expect(
          String(r.json.detail ?? ""),
          "detail must NOT contain 'stub' — unreachable URL no longer triggers stub fallback",
        ).not.toMatch(/stub/i);
      },
    );
  },
);
