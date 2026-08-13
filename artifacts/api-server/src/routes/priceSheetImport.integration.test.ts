/**
 * Integration test: multi-page PDF price-sheet import pipeline.
 *
 * Covers:
 *   1. /properties/:id/price-items/extract with text content (text-based PDF path)
 *      - returns rows with correct shape
 *      - BID/quote lines produce bidOnly=true and rate=null
 *      - fixed-price lines produce bidOnly=false with numeric rate
 *   2. /properties/:id/price-items/bulk  (save step)
 *      - inserts new rows
 *      - upserts on re-import (no duplicates)
 *      - saved items appear in GET /properties/:id
 *   3. Validates that a second import of the same service updates the rate
 *      (idempotent upsert, not a duplicate error)
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
  return { status: res.status, json: json as any };
}

// A realistic multi-page property price sheet with a mix of fixed and BID rows.
// The "pages" are separated by form-feed characters to mimic what pdfjs-dist
// produces when joining text across pages.
const MULTI_PAGE_PRICE_SHEET = `
ARCHANGEL PROPERTY SERVICES
Rate Sheet — Oakwood Commons (11 units)
Effective January 2026
Page 1 of 2

MAKE-READY SERVICES
Full Unit Make-Ready        $650.00    per unit
Carpet Clean (up to 3BR)    $180.00    per unit
Carpet Replace              BID        per unit
Paint Touch-Up (one room)   $120.00    per room
Full Repaint (2BR)          BID        per unit
Window Cleaning             $45.00     per window
Blind Replacement           $35.00     each

APPLIANCE
Refrigerator Clean          $55.00     each
Stove/Oven Clean            $45.00     each
Appliance Repair            BID

PAGE 2

PLUMBING
Toilet Rebuild              $125.00    each
Faucet Replace              $95.00     each
Water Heater Replacement    BID        per job

EXTERIOR
Pressure Wash (walkways)    $0.25      per sqft
Parking Lot Striping        BID        per job
Dumpster Area Clean         $80.00     per visit

NOTES
All BID items require site visit and written estimate.
Terms: net-30 from invoice date.
`.trim();

describe.skipIf(!BASE)("price-sheet import pipeline", () => {
  let propertyId = "";
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    // Create a dedicated test property so we don't pollute real data.
    const r = await api("/properties", {
      method: "POST",
      body: JSON.stringify({
        name: `Price Sheet Test ${Date.now()}`,
        pmcName: "Integration Tests LLC",
      }),
    });
    expect(r.status).toBe(201);
    propertyId = r.json.id;
    cleanup.push(() => api(`/properties/${propertyId}`, { method: "DELETE" }).then(() => {}));
  });

  afterAll(async () => {
    for (const fn of cleanup) {
      try {
        await fn();
      } catch {
        /* best-effort cleanup */
      }
    }
  });

  // -------------------------------------------------------------------------
  // 1. Extract: text-based PDF content (the normal path for digital PDFs)
  // -------------------------------------------------------------------------
  describe("extract endpoint (text content)", () => {
    let extractedRows: Array<{
      service: string;
      rate: number | null;
      unit: string | null;
      detail: string | null;
      bidOnly: boolean;
      confidence: number | null;
    }> = [];

    it("returns 200 and a non-empty rows array", async () => {
      const r = await api(`/properties/${propertyId}/price-items/extract`, {
        method: "POST",
        body: JSON.stringify({
          content: MULTI_PAGE_PRICE_SHEET,
          filename: "archangel-rate-sheet.pdf",
        }),
      });
      expect(r.status).toBe(200);
      expect(Array.isArray(r.json.rows)).toBe(true);
      expect(r.json.rows.length).toBeGreaterThan(0);
      extractedRows = r.json.rows;
    });

    it("returns a summary string", async () => {
      // Reuse the result from the previous test if already fetched,
      // otherwise re-fetch.
      if (extractedRows.length === 0) {
        const r = await api(`/properties/${propertyId}/price-items/extract`, {
          method: "POST",
          body: JSON.stringify({ content: MULTI_PAGE_PRICE_SHEET, filename: "test.pdf" }),
        });
        extractedRows = r.json.rows;
      }
      // summary may be null if the AI omits it, but should be a string when present
      const r = await api(`/properties/${propertyId}/price-items/extract`, {
        method: "POST",
        body: JSON.stringify({ content: MULTI_PAGE_PRICE_SHEET, filename: "test.pdf" }),
      });
      expect(r.status).toBe(200);
      expect(r.json.summary === null || typeof r.json.summary === "string").toBe(true);
    });

    it("flags BID-only rows with bidOnly=true and rate=null", async () => {
      if (extractedRows.length === 0) {
        const r = await api(`/properties/${propertyId}/price-items/extract`, {
          method: "POST",
          body: JSON.stringify({ content: MULTI_PAGE_PRICE_SHEET, filename: "test.pdf" }),
        });
        extractedRows = r.json.rows;
      }
      // At least one row must have bidOnly=true (we have multiple BID items)
      const bidRows = extractedRows.filter((r) => r.bidOnly === true);
      expect(bidRows.length).toBeGreaterThan(0);
      // Every bidOnly row must have rate === null
      for (const row of bidRows) {
        expect(row.rate).toBeNull();
      }
    });

    it("extracts fixed-price rows with numeric rates and bidOnly=false", async () => {
      if (extractedRows.length === 0) {
        const r = await api(`/properties/${propertyId}/price-items/extract`, {
          method: "POST",
          body: JSON.stringify({ content: MULTI_PAGE_PRICE_SHEET, filename: "test.pdf" }),
        });
        extractedRows = r.json.rows;
      }
      const priced = extractedRows.filter((r) => !r.bidOnly);
      expect(priced.length).toBeGreaterThan(0);
      for (const row of priced) {
        expect(typeof row.rate).toBe("number");
        expect(row.rate).toBeGreaterThanOrEqual(0);
        expect(row.bidOnly).toBe(false);
      }
    });

    it("every row has a non-empty service name", async () => {
      if (extractedRows.length === 0) {
        const r = await api(`/properties/${propertyId}/price-items/extract`, {
          method: "POST",
          body: JSON.stringify({ content: MULTI_PAGE_PRICE_SHEET, filename: "test.pdf" }),
        });
        extractedRows = r.json.rows;
      }
      for (const row of extractedRows) {
        expect(typeof row.service).toBe("string");
        expect(row.service.trim().length).toBeGreaterThan(0);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 2. Extract: validation errors
  // -------------------------------------------------------------------------
  describe("extract endpoint (validation)", () => {
    it("returns 400 when neither content nor image is provided", async () => {
      const r = await api(`/properties/${propertyId}/price-items/extract`, {
        method: "POST",
        body: JSON.stringify({ filename: "empty.pdf" }),
      });
      expect(r.status).toBe(400);
    });

    it("returns 404 for a non-existent property", async () => {
      // Use a well-formed UUID that won't match any real row so Postgres
      // doesn't throw a cast error before our 404 guard runs.
      const r = await api(`/properties/00000000-0000-0000-0000-000000000000/price-items/extract`, {
        method: "POST",
        body: JSON.stringify({ content: "Paint $100/unit", filename: "test.pdf" }),
      });
      expect(r.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Bulk save: inserts + upsert
  // -------------------------------------------------------------------------
  describe("bulk save endpoint", () => {
    const items = [
      { service: "Full Unit Make-Ready", rate: 650, unit: "unit", detail: null },
      { service: "Carpet Clean", rate: 180, unit: "unit", detail: null },
      { service: "Window Cleaning", rate: 45, unit: "window", detail: null },
      { service: "Toilet Rebuild", rate: 125, unit: "each", detail: "standard parts" },
      { service: "Pressure Wash", rate: 0.25, unit: "sqft", detail: null },
    ];

    it("saves the selected items and returns them in imported[]", async () => {
      const r = await api(`/properties/${propertyId}/price-items/bulk`, {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      expect(r.status).toBe(200);
      expect(Array.isArray(r.json.imported)).toBe(true);
      expect(r.json.imported.length).toBe(items.length);
      expect(Array.isArray(r.json.updated)).toBe(true);
      expect(r.json.updated.length).toBe(0);
    });

    it("saved items appear in GET /properties/:id priceItems", async () => {
      const r = await api(`/properties/${propertyId}`);
      expect(r.status).toBe(200);
      const priceItems: Array<{ service: string; rate: number; unit: string | null }> =
        r.json.priceItems ?? [];
      expect(priceItems.length).toBeGreaterThanOrEqual(items.length);
      const serviceNames = priceItems.map((p) => p.service.toLowerCase());
      expect(serviceNames).toContain("full unit make-ready");
      expect(serviceNames).toContain("carpet clean");
      expect(serviceNames).toContain("window cleaning");
      expect(serviceNames).toContain("toilet rebuild");
      expect(serviceNames).toContain("pressure wash");
    });

    it("re-importing same services updates rates (upsert) instead of inserting duplicates", async () => {
      const updated = [
        { service: "Full Unit Make-Ready", rate: 675, unit: "unit", detail: null },
        { service: "Window Cleaning", rate: 50, unit: "window", detail: null },
      ];
      const r = await api(`/properties/${propertyId}/price-items/bulk`, {
        method: "POST",
        body: JSON.stringify({ items: updated }),
      });
      expect(r.status).toBe(200);
      // Both must land in updated[], not imported[]
      expect(r.json.updated.length).toBe(2);
      expect(r.json.imported.length).toBe(0);

      // Confirm the new rate is reflected in the property read
      const p = await api(`/properties/${propertyId}`);
      const makeReady = p.json.priceItems?.find(
        (x: { service: string }) =>
          x.service.toLowerCase() === "full unit make-ready",
      );
      expect(makeReady?.rate).toBe(675);
    });

    it("duplicate services within a single batch are de-duplicated server-side", async () => {
      const duped = [
        { service: "Dumpster Clean", rate: 80, unit: "visit", detail: null },
        { service: "Dumpster Clean", rate: 90, unit: "visit", detail: null }, // duplicate
      ];
      const r = await api(`/properties/${propertyId}/price-items/bulk`, {
        method: "POST",
        body: JSON.stringify({ items: duped }),
      });
      expect(r.status).toBe(200);
      // Only one row should have been inserted
      expect(r.json.imported.length + r.json.updated.length).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Saved price items appear as invoice-editor options
  //    (price items are fetched as part of GET /properties/:id which the
  //     invoice editor reads; verify the response shape matches what the
  //     UI renders as price-book pills)
  // -------------------------------------------------------------------------
  describe("price-book pills availability", () => {
    it("priceItems in the property response have the fields the invoice editor needs", async () => {
      const r = await api(`/properties/${propertyId}`);
      expect(r.status).toBe(200);
      const priceItems: Array<{
        id: string;
        service: string;
        rate: number;
        unit: string | null;
        detail: string | null;
        propertyId: string;
      }> = r.json.priceItems ?? [];
      expect(priceItems.length).toBeGreaterThan(0);
      for (const p of priceItems) {
        expect(typeof p.id).toBe("string");
        expect(typeof p.service).toBe("string");
        expect(typeof p.rate).toBe("number");
        expect(p.propertyId).toBe(propertyId);
      }
    });
  });
});
