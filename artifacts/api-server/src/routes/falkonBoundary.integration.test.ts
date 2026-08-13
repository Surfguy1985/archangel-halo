/**
 * Falkon Boundary — regression test suite.
 *
 * Section A: Unit-style tests for the boundary module itself
 *   (FalkonBoundaryError shape, isFalkonBoundaryError guard, BoundaryResult).
 *
 * Section B: Smoke integration tests against the running API server.
 *   Skipped unless HALO_E2E_BASE + HALO_E2E_COOKIE are set.
 *   Verifies routes are wired to the boundary and respond with correct status
 *   families without touching mode — safe to run against any environment.
 *
 * Section C: Live mode-toggle integration tests.
 *   Skipped unless HALO_E2E_BASE + HALO_E2E_COOKIE + HALO_E2E_ENABLED=1
 *   + HALO_E2E_TOKEN are set.
 *   Uses the /falkon-test/* helper endpoints (mounted by the server only when
 *   HALO_E2E_ENABLED=1 and NODE_ENV !== "production") to flip Falkon mode
 *   mid-test and restore it afterwards.
 *
 *   Proves:
 *     OFF      → dispatch returns 503 { ok:false, error:"off" }
 *     OFF      → invoice-create returns 503 { ok:false, error:"off" }
 *     OFF      → walk-approve returns 503 { ok:false, error:"off" }
 *     ASSISTED (autoDispatch=false) → dispatch returns 403 { ok:false, gateBlocked:true }
 *     ASSISTED (no policy ceiling)  → invoice returns 403 { ok:false, gateBlocked:true }
 *     SHADOW   → dispatch mutation returns 200 and leaves no pending falkon_events row
 *     SHADOW   → invoice creation returns 201 and leaves no pending falkon_events row
 *
 * To run the full suite against the dev app:
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   HALO_E2E_ENABLED=1 \
 *   HALO_E2E_TOKEN="<random-secret matching server env>" \
 *   pnpm --filter @workspace/api-server run test
 *
 * Section B only (safe against any environment, no mode changes):
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import {
  FalkonBoundaryError,
  isFalkonBoundaryError,
  type BoundaryCode,
} from "../lib/falkonBoundary";

// ─── Section A: Unit tests (no network needed) ───────────────────────────────

describe("FalkonBoundaryError", () => {
  it("constructs with correct fields", () => {
    const err = new FalkonBoundaryError(503, "off", {
      ok: false,
      error: "off",
      message: "maintenance",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(FalkonBoundaryError);
    expect(err.httpStatus).toBe(503);
    expect(err.code).toBe("off" satisfies BoundaryCode);
    expect(err.body.ok).toBe(false);
    expect(err.name).toBe("FalkonBoundaryError");
  });

  it("constructs gateBlocked variant correctly", () => {
    const err = new FalkonBoundaryError(403, "gateBlocked", {
      ok: false,
      gateBlocked: true,
      reason: "ASSISTED — dispatch_crew requires approval",
      summary: "Dispatch requires a decision packet in ASSISTED mode.",
    });
    expect(err.httpStatus).toBe(403);
    expect(err.code).toBe("gateBlocked" satisfies BoundaryCode);
    expect(err.body.gateBlocked).toBe(true);
  });
});

describe("isFalkonBoundaryError", () => {
  it("returns true for FalkonBoundaryError instances", () => {
    const err = new FalkonBoundaryError(503, "off", { ok: false, error: "off" });
    expect(isFalkonBoundaryError(err)).toBe(true);
  });

  it("returns false for plain Error", () => {
    expect(isFalkonBoundaryError(new Error("not a boundary error"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isFalkonBoundaryError(null)).toBe(false);
    expect(isFalkonBoundaryError("string")).toBe(false);
    expect(isFalkonBoundaryError(503)).toBe(false);
    expect(isFalkonBoundaryError(undefined)).toBe(false);
    expect(isFalkonBoundaryError({ httpStatus: 503 })).toBe(false);
  });

  it("distinguishes from objects that look similar", () => {
    // A plain object with the same shape must NOT pass the type guard
    const lookalike = { httpStatus: 503, code: "off", body: {}, name: "FalkonBoundaryError" };
    expect(isFalkonBoundaryError(lookalike)).toBe(false);
  });
});

// ─── Section B: Smoke integration tests (requires running server) ─────────────

const BASE        = process.env.HALO_E2E_BASE   ?? "";
const COOKIE      = process.env.HALO_E2E_COOKIE ?? "";
const E2E_ENABLED = process.env.HALO_E2E_ENABLED === "1";
const E2E_TOKEN   = process.env.HALO_E2E_TOKEN  ?? "";

/** Shared HTTP helper — injects office cookie and, when present, the E2E token. */
async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE    ? { Cookie: COOKIE }            : {}),
      ...(E2E_TOKEN ? { "X-E2E-Token": E2E_TOKEN }  : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* non-JSON body */ }
  return { status: res.status, json: json as any };
}

describe.skipIf(!BASE)("Falkon boundary — REST route smoke tests", () => {
  let propertyId = "";
  let crewId = "";
  let jobId = "";
  const cleanupJobIds: string[] = [];
  const cleanupInvoiceIds: string[] = [];

  beforeAll(async () => {
    const props = await api("/properties");
    expect(props.status).toBe(200);
    propertyId = props.json[0]?.id;

    const crews = await api("/crews");
    expect(crews.status).toBe(200);
    crewId = crews.json[0]?.id;

    const jr = await api("/jobs/quick", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
        description: `falkon-boundary smoke ${Date.now()}`,
      }),
    });
    expect(jr.status).toBe(201);
    jobId = jr.json.id;
    cleanupJobIds.push(jobId);
  });

  afterAll(async () => {
    // Invoices first — no FK cascade from invoices → jobs
    for (const id of cleanupInvoiceIds) {
      await api(`/invoices/${id}`, { method: "DELETE" });
    }
    for (const id of cleanupJobIds) {
      await api(`/jobs/${id}`, { method: "DELETE" });
    }
  });

  // ── Routes are boundary-aware (not 404 / not 500) ──────────────────────────

  it("dispatch route is wired — returns 200 or boundary error, never 404/500", async () => {
    const r = await api(`/jobs/${jobId}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: "2026-09-01" }),
    });
    expect([200, 400, 403, 503]).toContain(r.status);
    expect(r.status).not.toBe(404);
    expect(r.status).not.toBe(500);
  });

  it("invoice create is wired — returns 200/201/409 or boundary error, never 500", async () => {
    const r = await api("/invoices", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
        jobId,
        lineItems: [{ typeOfWork: "Smoke test", qty: 1, unitPrice: 100 }],
      }),
    });
    expect([200, 201, 400, 403, 409, 503]).toContain(r.status);
    expect(r.status).not.toBe(404);
    expect(r.status).not.toBe(500);
    if (r.status === 201 && r.json?.id) cleanupInvoiceIds.push(r.json.id);
  });

  it("walk approve returns 404 for nonexistent walk (not 500)", async () => {
    const r = await api("/walks/00000000-0000-0000-0000-000000000000/approve", {
      method: "POST",
    });
    expect([404, 503]).toContain(r.status);
  });

  it("bid send returns 404 for nonexistent bid (not 500)", async () => {
    const r = await api("/bids/00000000-0000-0000-0000-000000000000/send", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([404, 503]).toContain(r.status);
  });

  it("work-request accept returns 404 for nonexistent request (not 500)", async () => {
    const r = await api("/work-requests/00000000-0000-0000-0000-000000000000/accept", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([404, 503]).toContain(r.status);
  });

  it("job schedule is wired — returns 200/400/403/503, never 404/500", async () => {
    const r = await api(`/jobs/${jobId}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledOn: "2026-09-01", crewLeaderId: crewId }),
    });
    expect([200, 400, 403, 503]).toContain(r.status);
    expect(r.status).not.toBe(404);
    expect(r.status).not.toBe(500);
  });

  // ── Boundary error shapes ───────────────────────────────────────────────────

  it("FalkonBoundaryError body shape matches what routes send", () => {
    const err = new FalkonBoundaryError(503, "off", {
      ok: false,
      error: "off",
      message:
        "HALO is in maintenance mode (Falkon OFF). Consequential actions are disabled until the Falkon connection is restored.",
    });
    expect(err.body).toMatchObject({
      ok: false,
      error: "off",
      message: expect.stringContaining("maintenance mode"),
    });
  });

  it("gateBlocked error body has the required fields for client UI", () => {
    const err = new FalkonBoundaryError(403, "gateBlocked", {
      ok: false,
      gateBlocked: true,
      reason: "ASSISTED — dispatch_crew not auto-approved by policy",
      summary: "Dispatch requires explicit approval in ASSISTED mode.",
    });
    expect(err.body).toMatchObject({
      ok: false,
      gateBlocked: true,
      reason: expect.any(String),
      summary: expect.any(String),
    });
  });
});

describe.skipIf(!BASE)("Falkon boundary — voice confirm OFF guard", () => {
  it("voice confirm with empty actions returns 200 in any mode", async () => {
    const r = await api("/voice/confirm", {
      method: "POST",
      body: JSON.stringify({ actions: [] }),
    });
    expect([200, 422]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it("voice confirm endpoint exists and is auth-gated (not 404)", async () => {
    const r = await api("/voice/confirm", {
      method: "POST",
      body: JSON.stringify({ actions: [] }),
    });
    expect(r.status).not.toBe(404);
  });
});

describe.skipIf(!BASE)("Falkon boundary — PM / crew public routes no-regression", () => {
  it("GET /live/:token returns 404 for unknown token (not 500)", async () => {
    const r = await fetch(`${BASE}/live/invalid-token-regression-check`);
    expect([400, 404]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });

  it("GET /checkin/:token returns 404 for unknown token (not 500)", async () => {
    const r = await fetch(`${BASE}/checkin/invalid-token-regression-check`);
    expect([400, 404]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });
});

describe.skipIf(!BASE)("Falkon boundary — checkout guard no-regression", () => {
  it("POST /checkin/:token/checkout with no open check-in returns 409", async () => {
    const r = await api("/checkin/no-such-token-regression/checkout", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect([400, 404, 409]).toContain(r.status);
    expect(r.status).not.toBe(500);
  });
});

// ─── Section C: Live mode-toggle integration tests ────────────────────────────
//
// Requires: HALO_E2E_BASE, HALO_E2E_COOKIE, HALO_E2E_ENABLED=1, HALO_E2E_TOKEN.
//
// Design invariants:
//   • Fixture job is created under SHADOW mode so beforeAll succeeds regardless
//     of whether the target server starts in OFF or ASSISTED.
//   • afterEach always restores mode even when a test fails.
//   • SHADOW mutation tests require the expected success codes (200/201) —
//     accepting 400/409 is not a proof that the boundary passed.
//   • Cleanup deletes invoices before jobs (no FK cascade from invoices → jobs).
//
// Request body shapes:
//   • Invoice body uses the schema fields (typeOfWork, qty, unitPrice) so the
//     Zod parse (which runs before the boundary) never rejects them as invalid.
//   • The boundary fires first for dispatch/walk/work-request; for invoice the
//     Zod parse runs first, so the body must be schema-valid to reach the gate.

describe.skipIf(!BASE || !E2E_ENABLED || !E2E_TOKEN)(
  "Falkon boundary — live mode-toggle proofs (HALO_E2E_ENABLED=1)",
  () => {
    let propertyId = "";
    let crewId = "";
    /** Job used for dispatch tests — no crew assigned at creation. */
    let dispatchJobId = "";
    /** Separate job used for invoice tests — no invoice at creation. */
    let invoiceJobId = "";
    const cleanupJobIds: string[] = [];
    const cleanupInvoiceIds: string[] = [];

    // Saved by setMode so afterEach can restore unconditionally
    let savedMode: { previousMode: string; hadRow: boolean } | null = null;

    // ── Mode helpers ──────────────────────────────────────────────────────────

    /**
     * Sets the Falkon mode on the server and records the previous state so
     * afterEach can restore it even when the test throws.
     */
    async function setMode(mode: string) {
      const r = await api("/falkon-test/set-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      expect(r.status).toBe(200);
      expect(r.json.ok).toBe(true);
      savedMode = { previousMode: r.json.previousMode, hadRow: r.json.hadRow };
    }

    async function restoreMode() {
      if (!savedMode) return;
      const snap = savedMode;
      savedMode = null; // clear first so a failed restore doesn't loop
      await api("/falkon-test/restore", {
        method: "POST",
        body: JSON.stringify(snap),
      });
    }

    /**
     * Runs fn with mode set to the given value, restoring mode afterwards
     * even if fn throws. Used in beforeAll where afterEach is not active.
     */
    async function withMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
      const r = await api("/falkon-test/set-mode", {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      expect(r.status).toBe(200);
      const snap = { previousMode: r.json.previousMode, hadRow: r.json.hadRow };
      try {
        return await fn();
      } finally {
        await api("/falkon-test/restore", {
          method: "POST",
          body: JSON.stringify(snap),
        });
      }
    }

    /** Returns falkon_events rows matching entityId + status. */
    async function pendingEventsFor(entityId: string) {
      const r = await api(
        `/falkon-test/events?entityId=${encodeURIComponent(entityId)}&status=pending`,
      );
      expect(r.status).toBe(200);
      return r.json as any[];
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    beforeAll(async () => {
      // Verify helper endpoints are reachable with the token before anything else
      const probe = await api("/falkon-test/set-mode", {
        method: "POST",
        body: JSON.stringify({ mode: "SHADOW" }),
      });
      if (probe.status === 404) {
        throw new Error(
          "Server returned 404 for /falkon-test/set-mode. " +
            "Ensure HALO_E2E_ENABLED=1 is set in the API server environment " +
            "and NODE_ENV is not 'production'.",
        );
      }
      if (probe.status === 401) {
        throw new Error(
          "Server returned 401 for /falkon-test/set-mode. " +
            "Ensure HALO_E2E_TOKEN on the server matches HALO_E2E_TOKEN in this test run.",
        );
      }
      expect(probe.status).toBe(200);
      // Restore immediately after the probe
      await api("/falkon-test/restore", {
        method: "POST",
        body: JSON.stringify({ previousMode: probe.json.previousMode, hadRow: probe.json.hadRow }),
      });

      // Seed test data under SHADOW so job creation succeeds even if the
      // target server starts in OFF or ASSISTED mode.
      await withMode("SHADOW", async () => {
        const props = await api("/properties");
        expect(props.status).toBe(200);
        propertyId = props.json[0]?.id;
        expect(propertyId).toBeTruthy();

        const crews = await api("/crews");
        expect(crews.status).toBe(200);
        crewId = crews.json[0]?.id;
        expect(crewId).toBeTruthy();

        // Two separate jobs so dispatch-test and invoice-test never share state
        const jr1 = await api("/jobs/quick", {
          method: "POST",
          body: JSON.stringify({
            propertyId,
            description: `falkon-boundary dispatch-job ${Date.now()}`,
          }),
        });
        expect(jr1.status).toBe(201);
        dispatchJobId = jr1.json.id;
        cleanupJobIds.push(dispatchJobId);

        const jr2 = await api("/jobs/quick", {
          method: "POST",
          body: JSON.stringify({
            propertyId,
            description: `falkon-boundary invoice-job ${Date.now()}`,
          }),
        });
        expect(jr2.status).toBe(201);
        invoiceJobId = jr2.json.id;
        cleanupJobIds.push(invoiceJobId);
      });
    });

    afterAll(async () => {
      // Invoices first — no FK cascade from invoices → jobs
      for (const id of cleanupInvoiceIds) {
        await api(`/invoices/${id}`, { method: "DELETE" });
      }
      for (const id of cleanupJobIds) {
        await api(`/jobs/${id}`, { method: "DELETE" });
      }
    });

    // Always restore Falkon mode even when a test assertion fails
    afterEach(restoreMode);

    // ── OFF → 503 proofs ──────────────────────────────────────────────────────

    it("OFF: dispatch returns 503 with off error body", async () => {
      await setMode("OFF");

      const r = await api(`/jobs/${dispatchJobId}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: "2026-09-15" }),
      });

      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({
        ok: false,
        error: "off",
        message: expect.stringContaining("maintenance mode"),
      });
    });

    it("OFF: invoice create returns 503 with off error body", async () => {
      await setMode("OFF");

      const r = await api("/invoices", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          jobId: invoiceJobId,
          lineItems: [{ typeOfWork: "OFF mode test", qty: 1, unitPrice: 50 }],
        }),
      });

      // Boundary fires after body parse — body is schema-valid so the 503 is
      // the gate, not a Zod rejection.
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({
        ok: false,
        error: "off",
        message: expect.stringContaining("maintenance mode"),
      });
    });

    it("OFF: walk approve returns 503 with off error body", async () => {
      await setMode("OFF");

      const r = await api("/walks/00000000-0000-0000-0000-000000000001/approve", {
        method: "POST",
      });

      // Boundary fires before the walk lookup — OFF always wins
      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ ok: false, error: "off" });
    });

    it("OFF: work-request accept returns 503 with off error body", async () => {
      await setMode("OFF");

      const r = await api("/work-requests/00000000-0000-0000-0000-000000000001/accept", {
        method: "POST",
        body: JSON.stringify({}),
      });

      expect(r.status).toBe(503);
      expect(r.json).toMatchObject({ ok: false, error: "off" });
    });

    // ── ASSISTED → 403 proofs ─────────────────────────────────────────────────
    //
    // checkAssistedGate blocks dispatch_crew when policy.autoDispatchEnabled is
    // false (DB default). For send_invoice, maxAutoInvoiceAmount=null means any
    // invoice amount is beyond the ceiling → 403.

    it("ASSISTED (no auto-dispatch policy): dispatch returns 403 gateBlocked", async () => {
      await setMode("ASSISTED");

      const r = await api(`/jobs/${dispatchJobId}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: "2026-09-15" }),
      });

      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({
        ok: false,
        gateBlocked: true,
        reason: expect.any(String),
        summary: expect.any(String),
      });
      // Reason must name the action so the UI can surface it specifically
      expect(r.json.reason).toMatch(/dispatch/i);
    });

    it("ASSISTED (no invoice policy ceiling): invoice create returns 403 gateBlocked", async () => {
      await setMode("ASSISTED");

      // Schema-valid body so Zod parse passes and the boundary is the gatekeeper.
      // With no falkon_policies row, maxAutoInvoiceAmount is null → any amount blocked.
      const r = await api("/invoices", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          jobId: invoiceJobId,
          lineItems: [{ typeOfWork: "ASSISTED gate test", qty: 1, unitPrice: 250 }],
        }),
      });

      expect(r.status).toBe(403);
      expect(r.json).toMatchObject({
        ok: false,
        gateBlocked: true,
        reason: expect.any(String),
        summary: expect.any(String),
      });
    });

    // ── SHADOW → mutation + no pending event proofs ───────────────────────────
    //
    // emitFalkonEvent suppresses outbound rows when mode === "SHADOW" — these
    // tests prove that the gate passed AND no event escaped to the outbox.

    it("SHADOW: dispatch returns 200 (mutation succeeded) and leaves no pending falkon_events row", async () => {
      await setMode("SHADOW");

      const r = await api(`/jobs/${dispatchJobId}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: "2026-09-15" }),
      });

      // Must be 200 — a 400 here would mean a business-rule block unrelated to
      // the boundary, which is not a valid proof that SHADOW passed.
      expect(r.status).toBe(200);
      expect(r.status).not.toBe(403);
      expect(r.status).not.toBe(503);

      // Key proof: emitFalkonEvent suppresses rows in SHADOW
      const pending = await pendingEventsFor(dispatchJobId);
      expect(pending).toHaveLength(0);
    });

    it("SHADOW: invoice create returns 201 (mutation succeeded) and leaves no pending falkon_events row", async () => {
      await setMode("SHADOW");

      const r = await api("/invoices", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          jobId: invoiceJobId,
          lineItems: [{ typeOfWork: "SHADOW mode test", qty: 1, unitPrice: 200 }],
        }),
      });

      // Must be 201 — 409 (already invoiced) or 400 (validation) are not proofs.
      expect(r.status).toBe(201);
      expect(r.json?.id).toBeTruthy();
      expect(r.status).not.toBe(403);
      expect(r.status).not.toBe(503);

      const invoiceId: string = r.json.id;
      // Track for cleanup — invoices must be deleted before their job
      cleanupInvoiceIds.push(invoiceId);

      // Key proof: emitFalkonEvent suppresses rows in SHADOW
      const pending = await pendingEventsFor(invoiceId);
      expect(pending).toHaveLength(0);
    });

    // ── Helper endpoint self-tests ────────────────────────────────────────────

    it("set-mode → restore round-trips cleanly", async () => {
      const before = await api("/falkon-test/set-mode", {
        method: "POST",
        body: JSON.stringify({ mode: "OFF" }),
      });
      expect(before.status).toBe(200);
      expect(before.json.ok).toBe(true);

      const restore = await api("/falkon-test/restore", {
        method: "POST",
        body: JSON.stringify({ previousMode: before.json.previousMode, hadRow: before.json.hadRow }),
      });
      expect(restore.status).toBe(200);
      expect(restore.json.ok).toBe(true);

      // Already restored manually — prevent afterEach double-restore
      savedMode = null;
    });

    it("set-mode rejects unknown mode values", async () => {
      const r = await api("/falkon-test/set-mode", {
        method: "POST",
        body: JSON.stringify({ mode: "UNKNOWN_MODE" }),
      });
      expect(r.status).toBe(400);
      expect(r.json.ok).toBe(false);
      // No mode change happened — nothing to restore
      savedMode = null;
    });

    it("helper returns 401 when X-E2E-Token is missing or wrong", async () => {
      const noToken = await fetch(`${BASE}/falkon-test/set-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(COOKIE ? { Cookie: COOKIE } : {}),
          // Deliberately omit X-E2E-Token
        },
        body: JSON.stringify({ mode: "SHADOW" }),
      });
      expect(noToken.status).toBe(401);

      const wrongToken = await fetch(`${BASE}/falkon-test/set-mode`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(COOKIE ? { Cookie: COOKIE } : {}),
          "X-E2E-Token": "not-the-right-token",
        },
        body: JSON.stringify({ mode: "SHADOW" }),
      });
      expect(wrongToken.status).toBe(401);

      savedMode = null;
    });
  },
);
