/**
 * Regression: in-house / inactive vendor guards.
 *
 * The server rejects two specific PATCH /vendors/:id edits:
 *   1. Setting an in-house vendor inactive  → 409
 *   2. Marking a second vendor as in-house when one already exists → 409
 *
 * Both errors must bubble up to the AddVendorSheet and show the server's own
 * error message (not a generic fallback), so this test also verifies the exact
 * error strings that the UI's `apiError()` helper extracts from `data.error`.
 *
 * Integration test against a RUNNING api-server sharing the dev database.
 * Skipped unless HALO_E2E_BASE is set, e.g.:
 *
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = process.env.HALO_E2E_BASE ?? "";
const COOKIE = process.env.HALO_E2E_COOKIE ?? "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json: json as Record<string, unknown> };
}

describe.skipIf(!BASE)("vendor PATCH guards: in-house / inactive", () => {
  /** IDs of vendors created by these tests — deleted in afterAll. */
  const cleanup: string[] = [];

  /** The existing in-house vendor (seeded at boot). */
  let inHouseId = "";

  /** A plain subcontractor we'll use for the second-in-house test. */
  let subId = "";

  beforeAll(async () => {
    // Pick up the seeded in-house row.
    const list = await api("/vendors");
    expect(list.status).toBe(200);
    const vendors = list.json as unknown as Array<{ id: string; vendorType: string }>;
    const inHouse = vendors.find((v) => v.vendorType === "in_house");
    expect(
      inHouse,
      "Expected at least one in-house vendor to be seeded on boot",
    ).toBeTruthy();
    inHouseId = inHouse!.id;

    // Create a fresh subcontractor to serve as the "second" candidate.
    const created = await api("/vendors", {
      method: "POST",
      body: JSON.stringify({
        name: `Guard-test sub ${Date.now()}`,
        vendorType: "subcontractor",
        contractStatus: "contracted",
      }),
    });
    expect(created.status).toBe(201);
    subId = (created.json as { id: string }).id;
    cleanup.push(subId);
  });

  afterAll(async () => {
    for (const id of cleanup) {
      // best-effort; ignore errors (e.g. already deleted)
      await api(`/vendors/${id}`, { method: "DELETE" });
    }
  });

  // ── Guard 1: in-house vendor cannot be set inactive ─────────────────────

  it("returns 409 when setting the in-house vendor inactive", async () => {
    const r = await api(`/vendors/${inHouseId}`, {
      method: "PATCH",
      body: JSON.stringify({ contractStatus: "inactive" }),
    });

    expect(r.status).toBe(409);
    // The AddVendorSheet reads `data.error` from the API response.
    expect(typeof r.json.error).toBe("string");
    expect((r.json.error as string).length).toBeGreaterThan(0);
    // Must match the exact server message so the sheet shows the real reason.
    expect(r.json.error).toBe(
      "Your own organization is always active and can't be set inactive.",
    );
  });

  it("returns 409 even when simultaneously switching type to in_house and status to inactive", async () => {
    // Edge: changing a sub to in-house AND inactive in one PATCH.
    // The type change guard fires first (stayingInHouse logic) so this should
    // still produce a 409 (either the inactive guard or the unique-index guard).
    const r = await api(`/vendors/${subId}`, {
      method: "PATCH",
      body: JSON.stringify({
        vendorType: "in_house",
        contractStatus: "inactive",
      }),
    });

    // Could be 409 from inactive guard (fires before the DB write) or from the
    // unique-index guard (if the DB write fires first). Either way, 409.
    expect(r.status).toBe(409);
    expect(typeof r.json.error).toBe("string");
    expect((r.json.error as string).length).toBeGreaterThan(0);
  });

  // ── Guard 2: only one in-house row allowed ───────────────────────────────

  it("returns 409 when promoting a second vendor to in_house", async () => {
    // Attempt to flip the subcontractor to in_house while one already exists.
    const r = await api(`/vendors/${subId}`, {
      method: "PATCH",
      body: JSON.stringify({ vendorType: "in_house" }),
    });

    expect(r.status).toBe(409);
    expect(typeof r.json.error).toBe("string");
    expect((r.json.error as string).length).toBeGreaterThan(0);
    // Must match the exact server message.
    expect(r.json.error).toBe(
      "Another vendor is already marked as your own organization. Change that one first.",
    );
  });

  // ── Sanity: a normal edit on the in-house vendor still succeeds ──────────

  it("allows editing in-house vendor name without touching contractStatus", async () => {
    // GET /vendors/:id might not exist; use the list instead.
    const list = await api("/vendors");
    const row = (list.json as unknown as Array<{ id: string; name: string }>).find(
      (v) => v.id === inHouseId,
    );
    const originalName = row?.name ?? "In-House";

    const r = await api(`/vendors/${inHouseId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: `${originalName} (edited)` }),
    });
    expect(r.status).toBe(200);

    // Restore the original name.
    const restore = await api(`/vendors/${inHouseId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: originalName }),
    });
    expect(restore.status).toBe(200);
  });

  // ── Sanity: a normal subcontractor PATCH still works ────────────────────

  it("allows setting a subcontractor inactive", async () => {
    const r = await api(`/vendors/${subId}`, {
      method: "PATCH",
      body: JSON.stringify({ contractStatus: "inactive" }),
    });
    expect(r.status).toBe(200);
    expect((r.json as { contractStatus: string }).contractStatus).toBe(
      "inactive",
    );

    // Restore to contracted so afterAll delete doesn't fail on open PO checks.
    await api(`/vendors/${subId}`, {
      method: "PATCH",
      body: JSON.stringify({ contractStatus: "contracted" }),
    });
  });
});
