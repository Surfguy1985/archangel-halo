/**
 * Falkon Exchange — Phase 3 route handlers.
 *
 * All Exchange data lives in DRAFT state until commercial activation.
 * Activation requires three hard prerequisites (enforced at POST /exchange/activate):
 *   1. Falkon connection in LIVE mode
 *   2. ≥5 fulfilled cross-business requests
 *   3. Merchant agreement accepted (PATCH /exchange/activation/merchant-agreement)
 *
 * All consequential writes (create product, create listing, grant entitlement,
 * attempt activation) are gated by assertFalkonBoundary() — same control
 * plane as Phase 2 dispatch/invoice/walk operations.
 *
 * ASSISTED posture is preserved throughout. Exchange actions have no policy
 * auto-grant path — they always require explicit operator approval in ASSISTED.
 */

import { Router, type IRouter } from "express";
import { eq, and, count, desc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  falkonExchangeProductsTable,
  falkonExchangeListingsTable,
  falkonExchangeEntitlementsTable,
  falkonExchangeUsageTable,
  falkonExchangeRevenueTable,
  falkonApiKeysTable,
  falkonExchangeActivationTable,
  falkonConnectionsTable,
  falkonCrossRequestsTable,
} from "@workspace/db/schema";
import { assertFalkonBoundary, handleBoundaryError } from "../lib/falkonBoundary";
import { PHASE_MANIFESTS } from "../lib/falkonPhaseManifests";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── Prerequisite evaluation ──────────────────────────────────────────────────

export interface PrerequisiteResult {
  key: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface PrerequisiteEvaluation {
  allMet: boolean;
  prerequisites: PrerequisiteResult[];
  missing: string[];
}

/**
 * Evaluate all three activation prerequisites against live DB state.
 * Read-only — safe to call at any time.
 */
export async function evaluateExchangePrerequisites(): Promise<PrerequisiteEvaluation> {
  const [connRows, crossCountRows, activationRows] = await Promise.all([
    db.select({ mode: falkonConnectionsTable.mode }).from(falkonConnectionsTable).limit(1),
    db
      .select({ n: count() })
      .from(falkonCrossRequestsTable)
      .where(eq(falkonCrossRequestsTable.approvalState, "fulfilled")),
    db.select().from(falkonExchangeActivationTable).limit(1),
  ]);

  const mode = connRows[0]?.mode ?? "OFF";
  const fulfilledCount = Number(crossCountRows[0]?.n ?? 0);
  const merchantAccepted = activationRows[0]?.merchantAgreementAccepted ?? false;

  const prerequisites: PrerequisiteResult[] = [
    {
      key: "live_mode",
      label: "LIVE mode active",
      met: mode === "LIVE",
      detail:
        mode === "LIVE"
          ? "Falkon connection is in LIVE mode. ✓"
          : `Current mode: ${mode}. Must be promoted to LIVE before Exchange can activate.`,
    },
    {
      key: "cross_business_history",
      label: "At least 5 fulfilled cross-business requests",
      met: fulfilledCount >= 5,
      detail:
        fulfilledCount >= 5
          ? `${fulfilledCount} fulfilled cross-business requests. ✓`
          : `Only ${fulfilledCount} of 5 required cross-business requests fulfilled.`,
    },
    {
      key: "merchant_agreement",
      label: "Exchange merchant agreement accepted",
      met: merchantAccepted,
      detail: merchantAccepted
        ? "Merchant agreement accepted. ✓"
        : "Merchant agreement not yet accepted. Use PATCH /exchange/activation/merchant-agreement.",
    },
  ];

  const missing = prerequisites.filter((p) => !p.met).map((p) => p.label);
  return { allMet: missing.length === 0, prerequisites, missing };
}

/**
 * Atomically insert-or-read the activation singleton row.
 *
 * Uses INSERT … ON CONFLICT (singleton_key) DO UPDATE SET singleton_key =
 * excluded.singleton_key (a value-preserving no-op) so that RETURNING always
 * emits exactly one row — either the newly inserted row or the pre-existing
 * one. This eliminates the select-then-insert race that could create duplicate
 * rows under concurrent requests, which the DB-level UNIQUE index on
 * singleton_key also enforces as a second guard.
 */
async function ensureActivationRow() {
  const [row] = await db
    .insert(falkonExchangeActivationTable)
    .values({ state: "draft", singletonKey: "singleton" })
    .onConflictDoUpdate({
      target: falkonExchangeActivationTable.singletonKey,
      // No-op update: preserve singleton_key unchanged, but make RETURNING
      // emit the existing row rather than silently discarding it (DO NOTHING
      // returns nothing on conflict).
      set: { singletonKey: sql`excluded.singleton_key` },
    })
    .returning();
  return row!;
}

// ─── GET /exchange/status ─────────────────────────────────────────────────────

router.get("/exchange/status", async (req, res): Promise<void> => {
  try {
    const [prereqs, activation] = await Promise.all([
      evaluateExchangePrerequisites(),
      ensureActivationRow(),
    ]);

    const phase3Manifest = PHASE_MANIFESTS.find((m) => m.phase === 3)!;

    res.json({
      manifest: {
        phase: phase3Manifest.phase,
        name: phase3Manifest.name,
        description: phase3Manifest.description,
        builtState: phase3Manifest.builtState ?? "draft",
        capabilities: phase3Manifest.capabilities,
        prerequisites: phase3Manifest.prerequisites,
        whatThisUnlocks: phase3Manifest.whatThisUnlocks,
      },
      activationState: activation.state,
      prerequisitesAllMet: prereqs.allMet,
      prerequisites: prereqs.prerequisites,
      missing: prereqs.missing,
      hint: prereqs.allMet
        ? "All prerequisites met. POST /exchange/activate to begin activation."
        : `${prereqs.missing.length} prerequisite(s) unmet — resolve before activating.`,
    });
  } catch (err) {
    logger.error({ err }, "exchange: status check failed");
    res.status(500).json({ error: "Failed to evaluate Exchange status" });
  }
});

// ─── GET /exchange/products ───────────────────────────────────────────────────

router.get("/exchange/products", async (req, res): Promise<void> => {
  try {
    const products = await db
      .select()
      .from(falkonExchangeProductsTable)
      .orderBy(falkonExchangeProductsTable.name);

    // Attach listing + active-entitlement counts per product
    const enriched = await Promise.all(
      products.map(async (p) => {
        const [listingRow, entitlementRow] = await Promise.all([
          db
            .select({ n: count() })
            .from(falkonExchangeListingsTable)
            .where(eq(falkonExchangeListingsTable.productId, p.id)),
          db
            .select({ n: count() })
            .from(falkonExchangeEntitlementsTable)
            .where(
              and(
                eq(falkonExchangeEntitlementsTable.productId, p.id),
                eq(falkonExchangeEntitlementsTable.status, "active"),
              ),
            ),
        ]);
        return {
          ...p,
          listingCount: Number(listingRow[0]?.n ?? 0),
          activeEntitlements: Number(entitlementRow[0]?.n ?? 0),
        };
      }),
    );

    res.json({ products: enriched });
  } catch (err) {
    logger.error({ err }, "exchange: list products failed");
    res.status(500).json({ error: "Failed to list Exchange products" });
  }
});

// ─── POST /exchange/products ──────────────────────────────────────────────────

router.post("/exchange/products", async (req, res): Promise<void> => {
  try {
    await assertFalkonBoundary("create_exchange_product");
  } catch (err) {
    if (handleBoundaryError(err, res)) return;
    throw err;
  }
  try {
    const {
      productKey,
      name,
      category = "workflow",
      pricingModel = "per_job",
      pricePerUnit,
      slaHours = 24,
      availability = "available",
      description,
      capabilities = [],
    } = req.body ?? {};

    if (!productKey || typeof productKey !== "string" || !productKey.trim()) {
      res.status(400).json({ error: "productKey is required" });
      return;
    }
    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const [product] = await db
      .insert(falkonExchangeProductsTable)
      .values({
        productKey: productKey.trim().toLowerCase(),
        name: name.trim(),
        category: String(category),
        pricingModel: String(pricingModel),
        pricePerUnit: pricePerUnit != null ? Number(pricePerUnit) : null,
        slaHours: Number(slaHours) || 24,
        availability: String(availability),
        description: description ? String(description) : null,
        capabilities: Array.isArray(capabilities) ? capabilities : [],
        status: "draft",
      })
      .onConflictDoUpdate({
        target: falkonExchangeProductsTable.productKey,
        set: {
          name: sql`excluded.name`,
          category: sql`excluded.category`,
          pricingModel: sql`excluded.pricing_model`,
          pricePerUnit: sql`excluded.price_per_unit`,
          slaHours: sql`excluded.sla_hours`,
          availability: sql`excluded.availability`,
          description: sql`excluded.description`,
          capabilities: sql`excluded.capabilities`,
          updatedAt: new Date(),
        },
      })
      .returning();

    res.status(201).json({ product });
  } catch (err) {
    logger.error({ err }, "exchange: create product failed");
    res.status(500).json({ error: "Failed to create Exchange product" });
  }
});

// ─── GET /exchange/listings ───────────────────────────────────────────────────

router.get("/exchange/listings", async (req, res): Promise<void> => {
  try {
    const { visibility } = req.query;

    const conditions = visibility
      ? [eq(falkonExchangeListingsTable.visibility, String(visibility))]
      : [];

    const listings = await db
      .select()
      .from(falkonExchangeListingsTable)
      .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>])) : undefined)
      .orderBy(desc(falkonExchangeListingsTable.draftedAt));

    res.json({ listings });
  } catch (err) {
    logger.error({ err }, "exchange: list listings failed");
    res.status(500).json({ error: "Failed to list Exchange listings" });
  }
});

// ─── POST /exchange/listings ──────────────────────────────────────────────────

router.post("/exchange/listings", async (req, res): Promise<void> => {
  try {
    await assertFalkonBoundary("publish_listing");
  } catch (err) {
    if (handleBoundaryError(err, res)) return;
    throw err;
  }
  try {
    const {
      productId,
      title,
      summary,
      priceDisplay,
      slaSummary,
      availabilityStatus = "available",
      metadata = {},
    } = req.body ?? {};

    if (!productId || typeof productId !== "string") {
      res.status(400).json({ error: "productId is required" });
      return;
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    // Verify product exists
    const [product] = await db
      .select({ id: falkonExchangeProductsTable.id })
      .from(falkonExchangeProductsTable)
      .where(eq(falkonExchangeProductsTable.id, productId))
      .limit(1);

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    // Listings are always created as "draft" — they cannot be promoted to "live"
    // until Exchange commercial activation prerequisites are satisfied.
    const [listing] = await db
      .insert(falkonExchangeListingsTable)
      .values({
        productId,
        title: title.trim(),
        summary: summary ? String(summary) : null,
        priceDisplay: priceDisplay ? String(priceDisplay) : null,
        slaSummary: slaSummary ? String(slaSummary) : null,
        availabilityStatus: String(availabilityStatus),
        visibility: "draft",
        metadata: typeof metadata === "object" ? metadata : {},
      })
      .returning();

    res.status(201).json({ listing });
  } catch (err) {
    logger.error({ err }, "exchange: create listing failed");
    res.status(500).json({ error: "Failed to create Exchange listing" });
  }
});

// ─── GET /exchange/entitlements ───────────────────────────────────────────────

router.get("/exchange/entitlements", async (req, res): Promise<void> => {
  try {
    const { productId, status } = req.query;

    const conditions: ReturnType<typeof eq>[] = [];
    if (productId) conditions.push(eq(falkonExchangeEntitlementsTable.productId, String(productId)));
    if (status) conditions.push(eq(falkonExchangeEntitlementsTable.status, String(status)));

    const entitlements = await db
      .select()
      .from(falkonExchangeEntitlementsTable)
      .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>])) : undefined)
      .orderBy(desc(falkonExchangeEntitlementsTable.grantedAt));

    res.json({ entitlements });
  } catch (err) {
    logger.error({ err }, "exchange: list entitlements failed");
    res.status(500).json({ error: "Failed to list Exchange entitlements" });
  }
});

// ─── POST /exchange/entitlements ─────────────────────────────────────────────

router.post("/exchange/entitlements", async (req, res): Promise<void> => {
  try {
    await assertFalkonBoundary("grant_entitlement");
  } catch (err) {
    if (handleBoundaryError(err, res)) return;
    throw err;
  }
  try {
    const {
      productId,
      partnerOrg,
      apiKeyId,
      expiresAt,
      usageLimit,
    } = req.body ?? {};

    if (!productId || typeof productId !== "string") {
      res.status(400).json({ error: "productId is required" });
      return;
    }
    if (!partnerOrg || typeof partnerOrg !== "string" || !partnerOrg.trim()) {
      res.status(400).json({ error: "partnerOrg is required" });
      return;
    }

    // Verify product exists
    const [product] = await db
      .select({ id: falkonExchangeProductsTable.id })
      .from(falkonExchangeProductsTable)
      .where(eq(falkonExchangeProductsTable.id, productId))
      .limit(1);

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    // Verify apiKeyId references a real key if provided
    if (apiKeyId) {
      const [key] = await db
        .select({ id: falkonApiKeysTable.id })
        .from(falkonApiKeysTable)
        .where(eq(falkonApiKeysTable.id, apiKeyId))
        .limit(1);
      if (!key) {
        res.status(404).json({ error: "API key not found" });
        return;
      }
    }

    const [entitlement] = await db
      .insert(falkonExchangeEntitlementsTable)
      .values({
        productId,
        partnerOrg: partnerOrg.trim(),
        apiKeyId: apiKeyId ?? null,
        expiresAt: expiresAt ? new Date(String(expiresAt)) : null,
        usageLimit: usageLimit != null ? Number(usageLimit) : null,
        status: "active",
      })
      .returning();

    res.status(201).json({ entitlement });
  } catch (err) {
    logger.error({ err }, "exchange: grant entitlement failed");
    res.status(500).json({ error: "Failed to grant Exchange entitlement" });
  }
});

// ─── GET /exchange/usage ──────────────────────────────────────────────────────

router.get("/exchange/usage", async (req, res): Promise<void> => {
  try {
    const { productId } = req.query;

    // Aggregate usage by product
    const conditions = productId
      ? [eq(falkonExchangeUsageTable.productId, String(productId))]
      : [];

    const usageRows = await db
      .select({
        productId: falkonExchangeUsageTable.productId,
        endpoint: falkonExchangeUsageTable.endpoint,
        totalCalls: sql<number>`SUM(${falkonExchangeUsageTable.callCount})`,
        eventCount: count(),
      })
      .from(falkonExchangeUsageTable)
      .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>])) : undefined)
      .groupBy(falkonExchangeUsageTable.productId, falkonExchangeUsageTable.endpoint)
      .orderBy(desc(sql`SUM(${falkonExchangeUsageTable.callCount})`));

    res.json({ usage: usageRows });
  } catch (err) {
    logger.error({ err }, "exchange: get usage failed");
    res.status(500).json({ error: "Failed to retrieve Exchange usage" });
  }
});

// ─── POST /exchange/usage ─────────────────────────────────────────────────────
// Records a usage event. In draft Exchange state this is office-auth gated
// (no external partner calls accepted until activation). When Exchange is
// commercially activated, this will be moved to API-key authentication.

router.post("/exchange/usage", async (req, res): Promise<void> => {
  try {
    const { entitlementId, productId, apiKeyId, endpoint, callCount = 1 } = req.body ?? {};

    if (!productId || typeof productId !== "string") {
      res.status(400).json({ error: "productId is required" });
      return;
    }

    const parsed = Math.max(1, Math.round(Number(callCount)));

    const [usageRow] = await db
      .insert(falkonExchangeUsageTable)
      .values({
        entitlementId: entitlementId ?? null,
        productId,
        apiKeyId: apiKeyId ?? null,
        endpoint: endpoint ? String(endpoint) : null,
        callCount: parsed,
      })
      .returning();

    // Increment entitlement usage counter if linked
    if (entitlementId) {
      await db
        .update(falkonExchangeEntitlementsTable)
        .set({
          usageCount: sql`${falkonExchangeEntitlementsTable.usageCount} + ${parsed}`,
          updatedAt: new Date(),
        })
        .where(eq(falkonExchangeEntitlementsTable.id, String(entitlementId)));
    }

    res.status(201).json({ usage: usageRow });
  } catch (err) {
    logger.error({ err }, "exchange: record usage failed");
    res.status(500).json({ error: "Failed to record Exchange usage" });
  }
});

// ─── GET /exchange/revenue ────────────────────────────────────────────────────

router.get("/exchange/revenue", async (req, res): Promise<void> => {
  try {
    const { productId } = req.query;

    const conditions = productId
      ? [eq(falkonExchangeRevenueTable.productId, String(productId))]
      : [];

    const revenue = await db
      .select()
      .from(falkonExchangeRevenueTable)
      .where(conditions.length > 0 ? and(...(conditions as [ReturnType<typeof eq>])) : undefined)
      .orderBy(desc(falkonExchangeRevenueTable.createdAt));

    // Aggregate totals
    const totalDraftRevenue = revenue
      .filter((r) => r.status === "draft")
      .reduce((s, r) => s + (r.amount ?? 0), 0);

    res.json({
      revenue,
      summary: {
        totalDraftRevenue,
        currency: "USD",
        note: "All revenue is in draft state — real settlement requires Exchange commercial activation.",
      },
    });
  } catch (err) {
    logger.error({ err }, "exchange: get revenue failed");
    res.status(500).json({ error: "Failed to retrieve Exchange revenue" });
  }
});

// ─── PATCH /exchange/activation/merchant-agreement ────────────────────────────
// Operator-only: mark the merchant agreement as accepted. This satisfies one
// of the three activation prerequisites. Idempotent.

router.patch("/exchange/activation/merchant-agreement", async (req, res): Promise<void> => {
  try {
    const activation = await ensureActivationRow();

    if (activation.merchantAgreementAccepted) {
      res.json({ ok: true, message: "Merchant agreement was already accepted.", activation });
      return;
    }

    const [updated] = await db
      .update(falkonExchangeActivationTable)
      .set({
        merchantAgreementAccepted: true,
        merchantAgreementAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(falkonExchangeActivationTable.id, activation.id))
      .returning();

    res.json({ ok: true, message: "Merchant agreement accepted.", activation: updated });
  } catch (err) {
    logger.error({ err }, "exchange: merchant agreement failed");
    res.status(500).json({ error: "Failed to record merchant agreement" });
  }
});

// ─── POST /exchange/activate ──────────────────────────────────────────────────
// Attempt commercial activation.
//
// ORDERING CONTRACT (enforced here, tested in exchange.integration.test.ts):
//   1. Prerequisites evaluated FIRST — always, regardless of Falkon mode.
//      If any are unmet → 409 { error: "prerequisites_not_met", missing: [...] }.
//      This must never be a 503 (boundary) or 403 (ASSISTED gate).
//   2. Only when ALL prerequisites are satisfied does the Falkon boundary gate
//      apply. In ASSISTED mode the operator must approve before proceeding;
//      in LIVE mode the transition executes immediately.
//
// This means: in OFF or SHADOW mode with unmet prerequisites → 409.
//             In ASSISTED mode with unmet prerequisites → 409.
//             In ASSISTED mode with all prerequisites met → 403 (needs approval).
//             In LIVE mode with all prerequisites met → state advances to pending.

router.post("/exchange/activate", async (req, res): Promise<void> => {
  try {
    // ── Step 1: Prerequisites — ALWAYS evaluated before the boundary gate ──
    // This is a read-only guard, not a consequential action. The 409 response
    // must be returned regardless of the Falkon connection mode.
    const [prereqs, activation] = await Promise.all([
      evaluateExchangePrerequisites(),
      ensureActivationRow(),
    ]);

    // Record the attempt timestamp and prerequisite snapshot regardless of outcome
    await db
      .update(falkonExchangeActivationTable)
      .set({
        activationAttemptedAt: new Date(),
        prerequisitesMet: prereqs.prerequisites.reduce<Record<string, boolean>>(
          (acc: Record<string, boolean>, p: PrerequisiteResult) => {
            acc[p.key] = p.met;
            return acc;
          },
          {},
        ),
        updatedAt: new Date(),
      })
      .where(eq(falkonExchangeActivationTable.id, activation.id));

    // Enforce prerequisites — structured 409 before any boundary check
    if (!prereqs.allMet) {
      res.status(409).json({
        ok: false,
        error: "prerequisites_not_met",
        missing: prereqs.missing,
        prerequisites: prereqs.prerequisites,
        hint:
          `${prereqs.missing.length} prerequisite(s) must be resolved before Exchange can activate. ` +
          "Resolve all items in 'missing' and retry.",
      });
      return;
    }

    // ── Step 2: Boundary gate — only reached when ALL prerequisites are met ──
    // In ASSISTED mode: returns 403 requiring operator approval before state advances.
    // In LIVE mode: passes through and state advances to pending.
    try {
      await assertFalkonBoundary("activate_exchange");
    } catch (err) {
      if (handleBoundaryError(err, res)) return;
      throw err;
    }

    // ── Step 3: Advance to pending ────────────────────────────────────────────
    // Full activation requires Falkon merchant onboarding tracked outside HALO.
    // "pending" signals that HALO's side is fully ready.
    const [updated] = await db
      .update(falkonExchangeActivationTable)
      .set({
        state: "pending",
        updatedAt: new Date(),
      })
      .where(eq(falkonExchangeActivationTable.id, activation.id))
      .returning();

    res.json({
      ok: true,
      message:
        "All HALO-side prerequisites satisfied. Exchange activation is pending " +
        "Falkon merchant onboarding. Contact Falkon to complete external activation steps.",
      activationState: updated!.state,
      prerequisites: prereqs.prerequisites,
    });
  } catch (err) {
    logger.error({ err }, "exchange: activate failed");
    res.status(500).json({ error: "Failed to process Exchange activation" });
  }
});

export default router;
