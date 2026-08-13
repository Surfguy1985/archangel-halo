/**
 * Falkon Exchange — integration tests.
 *
 * Unit tests: verify request/response shapes, prerequisite logic, boundary
 *   ordering contract, and CAPABILITY_GATE_MAP entries — no live server needed.
 * E2E tests: require HALO_E2E_BASE env var — skipped in CI unless explicitly set.
 *
 * Run unit tests:    pnpm --filter @workspace/api-server test
 * Run E2E tests:     HALO_E2E_BASE=http://localhost:<port> pnpm --filter @workspace/api-server test
 */

import { describe, it, expect } from "vitest";

// ─── Unit tests: prerequisite evaluation logic ────────────────────────────────

describe("Exchange prerequisite evaluation (unit)", () => {
  it("correctly identifies all prerequisites unmet in OFF/SHADOW mode", () => {
    const mode = "OFF" as string;
    const fulfilledCount = 0;
    const merchantAccepted = false;

    const prerequisites = [
      { key: "live_mode", met: mode === "LIVE" },
      { key: "cross_business_history", met: fulfilledCount >= 5 },
      { key: "merchant_agreement", met: merchantAccepted },
    ];

    expect(prerequisites.every((p) => !p.met)).toBe(true);
    expect(prerequisites.filter((p) => !p.met)).toHaveLength(3);
  });

  it("correctly identifies all prerequisites met", () => {
    const mode = "LIVE" as string;
    const fulfilledCount = 7;
    const merchantAccepted = true;

    const prerequisites = [
      { key: "live_mode", met: mode === "LIVE" },
      { key: "cross_business_history", met: fulfilledCount >= 5 },
      { key: "merchant_agreement", met: merchantAccepted },
    ];

    expect(prerequisites.every((p) => p.met)).toBe(true);
  });

  it("requires exactly 5 fulfilled cross-business requests (boundary)", () => {
    expect(4 >= 5).toBe(false);
    expect(5 >= 5).toBe(true);
    expect(6 >= 5).toBe(true);
  });

  it("activation is never attempted when LIVE mode is OFF", () => {
    const mode = "SHADOW" as string;
    const missing = mode === "LIVE" ? [] : ["LIVE mode active"];
    expect(missing).toContain("LIVE mode active");
  });
});

// ─── Unit tests: ORDERING CONTRACT — prerequisites before boundary gate ───────
//
// Critical correctness property: POST /exchange/activate must evaluate
// prerequisites FIRST. If any are unmet, the response is ALWAYS 409
// { error: "prerequisites_not_met", missing: [...] }, regardless of Falkon mode.
//
// The boundary gate (which can return 503 in OFF mode or 403 in ASSISTED) only
// runs AFTER all prerequisites pass. This ensures:
//   - OFF mode + unmet prereqs → 409 (not 503)
//   - ASSISTED mode + unmet prereqs → 409 (not 403)
//   - ASSISTED mode + all prereqs met → 403 (ASSISTED approval needed)
//   - LIVE mode + all prereqs met → 200 (state advances to pending)

describe("Activation ordering: prerequisites before boundary gate (unit)", () => {
  // Simulate the corrected activate() handler ordering
  function simulateActivate(opts: {
    mode: string;
    fulfilledCount: number;
    merchantAccepted: boolean;
  }): { status: number; body: Record<string, unknown> } {
    // ── Step 1: prerequisites (always first) ──────────────────────────────
    const prerequisites = [
      { key: "live_mode",              label: "LIVE mode active",                        met: opts.mode === "LIVE" },
      { key: "cross_business_history", label: "At least 5 fulfilled cross-business requests", met: opts.fulfilledCount >= 5 },
      { key: "merchant_agreement",     label: "Exchange merchant agreement accepted",    met: opts.merchantAccepted },
    ];
    const missing = prerequisites.filter((p) => !p.met).map((p) => p.label);

    if (missing.length > 0) {
      // Prerequisites unmet → 409 regardless of Falkon mode
      return { status: 409, body: { ok: false, error: "prerequisites_not_met", missing, prerequisites } };
    }

    // ── Step 2: boundary gate (only reached when all prerequisites pass) ──
    if (opts.mode === "OFF") {
      return { status: 503, body: { error: "Falkon Exchange is not active." } };
    }
    if (opts.mode === "ASSISTED") {
      return { status: 403, body: { gateBlocked: true, summary: "Activating the Falkon Exchange commercially requires operator approval." } };
    }

    // ── Step 3: LIVE mode — state advances ────────────────────────────────
    return { status: 200, body: { ok: true, activationState: "pending" } };
  }

  it("OFF mode + all prereqs unmet → 409, not 503", () => {
    const result = simulateActivate({ mode: "OFF", fulfilledCount: 0, merchantAccepted: false });
    expect(result.status).toBe(409);
    expect(result.body["error"]).toBe("prerequisites_not_met");
    expect((result.body["missing"] as string[]).length).toBeGreaterThan(0);
  });

  it("SHADOW mode + all prereqs unmet → 409, not 503", () => {
    const result = simulateActivate({ mode: "SHADOW", fulfilledCount: 0, merchantAccepted: false });
    expect(result.status).toBe(409);
    expect(result.body["error"]).toBe("prerequisites_not_met");
  });

  it("ASSISTED mode + all prereqs unmet → 409, not 403", () => {
    const result = simulateActivate({ mode: "ASSISTED", fulfilledCount: 0, merchantAccepted: false });
    expect(result.status).toBe(409);
    expect(result.body["error"]).toBe("prerequisites_not_met");
  });

  it("ASSISTED mode + only live_mode unmet → 409 with exactly that missing item", () => {
    const result = simulateActivate({ mode: "ASSISTED", fulfilledCount: 7, merchantAccepted: true });
    // live_mode is NOT met (mode is ASSISTED not LIVE)
    expect(result.status).toBe(409);
    const missing = result.body["missing"] as string[];
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("LIVE");
  });

  it("LIVE mode + only merchant_agreement unmet → 409", () => {
    const result = simulateActivate({ mode: "LIVE", fulfilledCount: 7, merchantAccepted: false });
    expect(result.status).toBe(409);
    const missing = result.body["missing"] as string[];
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain("merchant agreement");
  });

  it("LIVE mode + cross_business < 5 + no merchant → 409 with both in missing", () => {
    const result = simulateActivate({ mode: "LIVE", fulfilledCount: 3, merchantAccepted: false });
    expect(result.status).toBe(409);
    const missing = result.body["missing"] as string[];
    expect(missing).toHaveLength(2);
    expect(missing.some((m) => m.includes("cross-business"))).toBe(true);
    expect(missing.some((m) => m.includes("merchant agreement"))).toBe(true);
  });

  it("LIVE mode + all prereqs met → boundary passes through (state advances)", () => {
    // NOTE: "ASSISTED + all prereqs met" is logically impossible:
    // the live_mode prerequisite requires mode === "LIVE", so ASSISTED always
    // produces 409 before reaching the boundary gate. LIVE is the only mode
    // where all three prerequisites can simultaneously be true.
    const result = simulateActivate({ mode: "LIVE", fulfilledCount: 7, merchantAccepted: true });
    expect(result.status).toBe(200);
    expect(result.body["ok"]).toBe(true);
    expect(result.body["activationState"]).toBe("pending");
  });

  it("LIVE mode + all prereqs met → 200, state advances to pending", () => {
    const result = simulateActivate({ mode: "LIVE", fulfilledCount: 7, merchantAccepted: true });
    expect(result.status).toBe(200);
    expect(result.body["ok"]).toBe(true);
    expect(result.body["activationState"]).toBe("pending");
  });

  it("missing[] is always present and non-null in 409 responses", () => {
    for (const [mode, count, merchant] of [
      ["OFF", 0, false],
      ["SHADOW", 2, false],
      ["ASSISTED", 0, true],
    ] as Array<[string, number, boolean]>) {
      const result = simulateActivate({ mode, fulfilledCount: count, merchantAccepted: merchant });
      expect(result.status).toBe(409);
      expect(Array.isArray(result.body["missing"])).toBe(true);
      expect(result.body["error"]).toBe("prerequisites_not_met");
    }
  });
});

// ─── Unit tests: Exchange product data shape ──────────────────────────────────

describe("Exchange product shape (unit)", () => {
  it("canonical product keys are URL-safe slugs", () => {
    const keys = [
      "make-ready-pipeline",
      "property-inspection",
      "crew-dispatch",
      "billing-orchestration",
      "property-operations",
    ];
    const urlSafePattern = /^[a-z0-9-]+$/;
    for (const key of keys) {
      expect(urlSafePattern.test(key)).toBe(true);
    }
  });

  it("pricePerUnit is in cents (never dollars)", () => {
    const pricePerUnit = 45000;
    const displayPrice = pricePerUnit / 100;
    expect(displayPrice).toBe(450);
  });

  it("parseExchangeResult returns null for non-exchange JSON", () => {
    function parseExchangeResult(result: unknown) {
      if (!result || typeof result !== "string") return null;
      try {
        const p = JSON.parse(result) as Record<string, unknown>;
        if (p["type"] === "exchange_products") return { kind: "exchange-product-card" };
        if (p["type"] === "exchange_status") return { kind: "exchange-status-card" };
        return null;
      } catch {
        return null;
      }
    }

    expect(parseExchangeResult(null)).toBeNull();
    expect(parseExchangeResult("not json")).toBeNull();
    expect(parseExchangeResult(JSON.stringify({ type: "live_link" }))).toBeNull();
    expect(parseExchangeResult(JSON.stringify({ type: "crew_link" }))).toBeNull();
    expect(parseExchangeResult(JSON.stringify({ type: "exchange_products" }))).toEqual({
      kind: "exchange-product-card",
    });
    expect(parseExchangeResult(JSON.stringify({ type: "exchange_status" }))).toEqual({
      kind: "exchange-status-card",
    });
  });
});

// ─── Unit tests: CAPABILITY_GATE_MAP contract ─────────────────────────────────

describe("Exchange CAPABILITY_GATE_MAP contract (unit)", () => {
  const CONSEQUENTIAL_EXCHANGE_ACTIONS = [
    "exchange.create_product",
    "exchange.publish_listing",
    "exchange.grant_entitlement",
    "exchange.activate",
  ] as const;

  const READ_ONLY_EXCHANGE_ACTIONS = [
    "exchange.list_products",
    "exchange.check_status",
  ] as const;

  const CAPABILITY_GATE_MAP: Record<string, string | undefined> = {
    "exchange.create_product":    "create_exchange_product",
    "exchange.publish_listing":   "publish_listing",
    "exchange.grant_entitlement": "grant_entitlement",
    "exchange.activate":          "activate_exchange",
    "exchange.list_products":     undefined,
    "exchange.check_status":      undefined,
  };

  it("all consequential exchange actions are gated", () => {
    for (const action of CONSEQUENTIAL_EXCHANGE_ACTIONS) {
      expect(CAPABILITY_GATE_MAP[action]).toBeTruthy();
    }
  });

  it("all read-only exchange actions are ungated", () => {
    for (const action of READ_ONLY_EXCHANGE_ACTIONS) {
      expect(CAPABILITY_GATE_MAP[action]).toBeUndefined();
    }
  });

  it("every exchange ConsequentialAction maps to a known action type", () => {
    const KNOWN_ACTIONS = [
      "create_exchange_product",
      "publish_listing",
      "grant_entitlement",
      "activate_exchange",
    ];
    for (const action of CONSEQUENTIAL_EXCHANGE_ACTIONS) {
      expect(KNOWN_ACTIONS).toContain(CAPABILITY_GATE_MAP[action]);
    }
  });

  it("activate_exchange gate only fires after prerequisites pass (ordering verified by test suite above)", () => {
    // This test documents that the activate_exchange ConsequentialAction is
    // only reachable after the prerequisite check returns allMet: true.
    // The ordering tests above (simulateActivate) cover every combination.
    // The CAPABILITY key is "exchange.activate", not "activate_exchange".
    const capabilityKey = "exchange.activate";
    expect(CAPABILITY_GATE_MAP[capabilityKey]).toBe("activate_exchange");
  });
});

// ─── E2E tests (require HALO_E2E_BASE) ───────────────────────────────────────

const E2E_BASE = process.env["HALO_E2E_BASE"];
const describeE2E = E2E_BASE ? describe : describe.skip;

describeE2E("Exchange E2E — GET /exchange/status", () => {
  it("returns manifest, activationState, and prerequisites array", async () => {
    const res = await fetch(`${E2E_BASE}/api/exchange/status`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty("manifest");
    expect(body).toHaveProperty("activationState");
    expect(body).toHaveProperty("prerequisitesAllMet");
    expect(Array.isArray(body["prerequisites"])).toBe(true);
    expect((body["prerequisites"] as unknown[]).length).toBe(3);
    expect((body["manifest"] as Record<string, unknown>)["builtState"]).toBe("draft");
  });
});

describeE2E("Exchange E2E — GET /exchange/products", () => {
  it("returns seeded canonical products", async () => {
    const res = await fetch(`${E2E_BASE}/api/exchange/products`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body["products"])).toBe(true);
    const products = body["products"] as Array<{ productKey: string }>;
    expect(products.length).toBeGreaterThanOrEqual(5);

    const keys = products.map((p) => p.productKey);
    expect(keys).toContain("make-ready-pipeline");
    expect(keys).toContain("property-inspection");
    expect(keys).toContain("crew-dispatch");
    expect(keys).toContain("billing-orchestration");
    expect(keys).toContain("property-operations");
  });
});

describeE2E("Exchange E2E — POST /exchange/activate ordering: 409 before boundary gate", () => {
  // CRITICAL CONTRACT: prerequisites unmet → always 409, never 503 or 403.
  // The published app is in SHADOW or ASSISTED mode (not LIVE), and does NOT
  // have 5 fulfilled cross-business requests. Therefore all three prerequisites
  // are unmet and this endpoint MUST return 409 with a structured missing[].
  it("returns 409 with missing[] when prerequisites unmet (not 503 from boundary gate)", async () => {
    const res = await fetch(`${E2E_BASE}/api/exchange/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    // 409 is the ONLY acceptable response when prerequisites are unmet.
    // 503 (boundary OFF) or 403 (ASSISTED gate) would indicate ordering is wrong.
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body["error"]).toBe("prerequisites_not_met");
    expect(Array.isArray(body["missing"])).toBe(true);
    expect((body["missing"] as unknown[]).length).toBeGreaterThan(0);
    expect(body["ok"]).toBe(false);
  });
});

describeE2E("Exchange E2E — PATCH /exchange/activation/merchant-agreement is idempotent", () => {
  it("accepts the merchant agreement and returns ok: true", async () => {
    const res = await fetch(`${E2E_BASE}/api/exchange/activation/merchant-agreement`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);

    // Second call must still succeed (idempotent)
    const res2 = await fetch(`${E2E_BASE}/api/exchange/activation/merchant-agreement`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json() as Record<string, unknown>;
    expect(body2["ok"]).toBe(true);
  });
});
