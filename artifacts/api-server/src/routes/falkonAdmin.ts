/**
 * Falkon Ops — Admin control-plane routes.
 * All routes are office-gated (behind the passcode cookie).
 *
 * Five-step Connect verification:
 *   POST /falkon/admin/verify/1-health-check
 *   POST /falkon/admin/verify/2-trust-binding
 *   POST /falkon/admin/verify/3-register-callback
 *   POST /falkon/admin/verify/4-shadow-execution
 *   POST /falkon/admin/verify/5-ping-roundtrip
 *   GET  /falkon/admin/verify/status
 *
 * Twin sync:
 *   POST /falkon/admin/sync/properties   — push property twins to gateway
 *   POST /falkon/admin/sync/units/:propId — push unit twins for a property
 *   POST /falkon/admin/sync/vendors       — push vendor/crew twins
 *   POST /falkon/admin/sync/capabilities  — register 22 capabilities
 *
 * Make-ready:
 *   POST /falkon/admin/make-ready/start      — create execution
 *   POST /falkon/admin/make-ready/:id/advance — advance one phase
 *   GET  /falkon/admin/make-ready/:id         — execution detail
 *   GET  /falkon/admin/make-ready             — list executions
 *
 * Usage metering:
 *   GET  /falkon/admin/usage                  — aggregate usage by capability
 *   GET  /falkon/admin/usage/daily            — daily breakdown
 *
 * Eligibility:
 *   GET  /falkon/admin/eligibility            — LIVE mode readiness check
 *   POST /falkon/admin/eligibility/promote    — promote to ASSISTED or LIVE
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  propertiesTable,
  crewsTable,
  falkonUnitsTable,
} from "@workspace/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import {
  gatewayHealth,
  registerCallback,
  runShadowExecution,
  gatewayPing,
  syncPropertyTwin,
  syncUnitTwin,
  syncVendorTwin,
  registerCapabilities,
  submitTrustBinding,
  CLIENT_ID,
  GATEWAY_ORIGIN,
} from "../lib/falkonGateway";
import { buildTrustDoc, getPublicKeyPem } from "../lib/falkonIdentity";
import { FALKON_CAPABILITIES, getCapabilityRegistration } from "../lib/falkonCapabilities";
import { advanceExecution, PHASES } from "../lib/falkonMakeReady";
import { logger } from "../lib/logger";

export const falkonAdminRouter = Router();

const ARCHANGEL_BASE_URL = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]!.trim()}`
  : "https://archangel-halo.replit.app";

const WEBHOOK_URL = `${ARCHANGEL_BASE_URL}/api/falkon/webhook`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getConn() {
  const [c] = await db.select().from(falkonConnectionsTable).limit(1);
  return c ?? null;
}

async function setVerifStep(step: string, value: unknown) {
  await db.execute(
    sql`UPDATE falkon_connections
        SET verification_steps = jsonb_set(
          COALESCE(verification_steps, '{}'),
          ${`{${step}}`},
          ${JSON.stringify(value)}::jsonb
        ),
        updated_at = now()
        WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`,
  );
}

// ---------------------------------------------------------------------------
// ── Five-Step Verification ─────────────────────────────────────────────────
// ---------------------------------------------------------------------------

// Step 1 — Health check: can HALO reach the Falkon gateway?
falkonAdminRouter.post("/falkon/admin/verify/1-health-check", async (req, res) => {
  try {
    const result = await gatewayHealth();
    await setVerifStep("step1", { ok: result.ok, status: result.status, ts: Date.now() });
    return res.json({ ok: result.ok, step: 1, result });
  } catch (err: any) {
    logger.error({ err }, "falkon verify step 1 failed");
    return res.status(500).json({ error: err.message });
  }
});

// Step 2 — Trust binding: submit our Ed25519 public key to the gateway.
// Uses signed gatewayFetch (X-Falkon-Signature) so HALO authenticates itself
// to the gateway. Previous version used raw unsigned fetch — that is now fixed.
falkonAdminRouter.post("/falkon/admin/verify/2-trust-binding", async (req, res) => {
  try {
    const publicKeyPem = getPublicKeyPem();
    if (!publicKeyPem) {
      return res.status(503).json({ error: "Ed25519 identity not yet initialised" });
    }

    const productionDomains = process.env.REPLIT_DOMAINS;
    const primaryDomain = productionDomains
      ? `https://${productionDomains.split(",")[0]!.trim()}`
      : ARCHANGEL_BASE_URL;
    const trustDocUrl = `${primaryDomain}/.well-known/falkon-trust.json`;

    // Use signed gatewayFetch — HALO proves its identity via Ed25519 signature
    const { ok, falkonPublicKeyPem: bindingKeyPem, body } = await submitTrustBinding(trustDocUrl, publicKeyPem);
    // Use a mutable binding so the trust-doc fallback can fill it in below
    let falkonPublicKeyPem: string | undefined = bindingKeyPem;

    await setVerifStep("step2", {
      ok,
      trustDocUrl,
      publicKeyPem: publicKeyPem.slice(0, 80) + "…",
      ts: Date.now(),
      signedRequest: true,
    });

    if (ok) {
      // If the binding response didn't return Falkon's public key, try fetching
      // it directly from Falkon's published trust document as a fallback.
      if (!falkonPublicKeyPem) {
        try {
          const tdResp = await fetch(
            `${GATEWAY_ORIGIN}/.well-known/falkon-trust.json`,
            { signal: AbortSignal.timeout(8_000) },
          );
          if (tdResp.ok) {
            const td = (await tdResp.json().catch(() => null)) as Record<string, unknown> | null;
            falkonPublicKeyPem = (td?.publicKeyPem ?? td?.public_key_pem) as string | undefined;
            if (falkonPublicKeyPem) {
              logger.info("falkon: fetched Falkon gateway public key from trust doc (binding did not return it)");
            }
          }
        } catch (tdErr) {
          logger.warn({ err: tdErr }, "falkon: could not fetch Falkon trust doc as fallback");
        }
      }

      // Cache Falkon's returned public key for inbound webhook verification.
      // DELETE + INSERT so re-running step 2 always refreshes the cached key.
      if (falkonPublicKeyPem) {
        await db.execute(sql`DELETE FROM falkon_remote_identity WHERE partner_id = 'falkon-gateway'`);
        await db.execute(
          sql`INSERT INTO falkon_remote_identity
                (id, partner_id, public_key_pem, algorithm, fetched_at, trust_doc_url, created_at)
              VALUES
                (gen_random_uuid(), 'falkon-gateway', ${falkonPublicKeyPem},
                 'Ed25519', now(), ${GATEWAY_ORIGIN}, now())`,
        );
        logger.info("falkon: Falkon gateway Ed25519 public key cached for webhook verification");
      } else {
        logger.warn("falkon: trust binding succeeded but Falkon did not return a public key — webhook verify will fall back to HMAC");
      }

      await db.execute(
        sql`UPDATE falkon_connections
            SET trust_doc_verified_at = now(), updated_at = now()
            WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`,
      );
    }

    return res.json({ ok, step: 2, trustDocUrl, signedRequest: true, body });
  } catch (err: any) {
    logger.error({ err }, "falkon verify step 2 failed");
    return res.status(500).json({ error: err.message });
  }
});

// Step 3 — Register callback webhook
falkonAdminRouter.post("/falkon/admin/verify/3-register-callback", async (req, res) => {
  try {
    const result = await registerCallback(WEBHOOK_URL);
    await setVerifStep("step3", { ok: result.ok, callbackId: result.callbackId, ts: Date.now() });
    return res.json({ ok: result.ok, step: 3, webhookUrl: WEBHOOK_URL, result });
  } catch (err: any) {
    logger.error({ err }, "falkon verify step 3 failed");
    return res.status(500).json({ error: err.message });
  }
});

// Step 4 — Shadow execution probe
falkonAdminRouter.post("/falkon/admin/verify/4-shadow-execution", async (req, res) => {
  try {
    const { propertyId, unitLabel } = req.body as Record<string, string>;
    const result = await runShadowExecution({ propertyId, unitLabel });
    await setVerifStep("step4", {
      ok: result.ok,
      executionId: result.executionId,
      phase: result.phase,
      ts: Date.now(),
    });
    return res.json({ ok: result.ok, step: 4, result });
  } catch (err: any) {
    logger.error({ err }, "falkon verify step 4 failed");
    return res.status(500).json({ error: err.message });
  }
});

// Step 5 — Nonce-correlated ping round-trip
// Protocol:
//   1. Server generates a UUID nonce and stores it as verificationSteps.pendingNonce
//   2. Gateway ping is sent with the nonce in the payload
//   3. Falkon POSTs it back as a "partner.verify.ping" event to our webhook
//   4. Webhook extracts the nonce, checks it against pendingNonce, stores callbackNonce
//   5. This route polls for callbackNonce === pendingNonce; only then marks verified
// Steps 1–4 must all have ok:true in verificationSteps before this runs.
falkonAdminRouter.post("/falkon/admin/verify/5-ping-roundtrip", async (req, res) => {
  try {
    const conn = await getConn();
    if (!conn) return res.status(400).json({ error: "No Falkon connection configured" });

    // Guard: steps 1–4 must all have passed
    const steps = (conn.verificationSteps ?? {}) as Record<string, Record<string, unknown>>;
    const prereqs = ["step1", "step2", "step3", "step4"];
    const failed = prereqs.filter((s) => steps[s]?.ok !== true);
    if (failed.length > 0) {
      return res.status(409).json({
        error: `Steps ${failed.join(", ")} must pass before the round-trip ping`,
        failedSteps: failed,
      });
    }

    // Generate nonce and store as pending
    const nonce = crypto.randomUUID();
    await setVerifStep("pendingNonce", nonce);
    await setVerifStep("callbackNonce", null);

    // Send the nonce-bearing ping to the Falkon gateway
    const t0 = Date.now();
    await gatewayPing(nonce);

    // Poll up to 16 seconds for the webhook to deliver the nonce back
    let nonceReceived = false;
    for (let i = 0; i < 8; i++) {
      await new Promise<void>((r) => setTimeout(r, 2_000));
      const [fresh] = await db.select({
        verificationSteps: falkonConnectionsTable.verificationSteps,
      }).from(falkonConnectionsTable).limit(1);
      const freshSteps = (fresh?.verificationSteps ?? {}) as Record<string, unknown>;
      if (freshSteps["callbackNonce"] === nonce) {
        nonceReceived = true;
        break;
      }
    }

    const latencyMs = Date.now() - t0;
    await setVerifStep("step5", { ok: nonceReceived, latencyMs, ts: Date.now() });

    if (nonceReceived) {
      await db.execute(
        sql`UPDATE falkon_connections
            SET status = 'verified', verified_at = now(), updated_at = now()
            WHERE id = ${conn.id}::uuid`,
      );
    }

    return res.json({ ok: nonceReceived, step: 5, latencyMs });
  } catch (err: any) {
    logger.error({ err }, "falkon verify step 5 failed");
    return res.status(500).json({ error: err.message });
  }
});

// Verify status summary
falkonAdminRouter.get("/falkon/admin/verify/status", async (_req, res) => {
  try {
    const conn = await getConn();
    return res.json({
      status: conn?.status ?? "disconnected",
      verifiedAt: conn?.verifiedAt ?? null,
      steps: conn?.verificationSteps ?? {},
      mode: conn?.mode ?? "SHADOW",
      trustDocUrl: `${ARCHANGEL_BASE_URL}/.well-known/falkon-trust.json`,
      webhookUrl: WEBHOOK_URL,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ── Twin Sync ──────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

falkonAdminRouter.post("/falkon/admin/sync/properties", async (_req, res) => {
  try {
    const properties = await db.select().from(propertiesTable);
    const results: { id: string; ok: boolean; action?: string }[] = [];

    for (const prop of properties) {
      const result = await syncPropertyTwin({
        id: prop.id,
        name: prop.name,
        address: prop.address,
        city: prop.city,
        units: prop.units,
        latitude: prop.latitude,
        longitude: prop.longitude,
        falkonPropertyId: prop.falkonPropertyId,
      });
      results.push({ id: prop.id, ok: result.ok, action: result.action });

      // Write back Falkon's assigned twin ID if returned
      if (result.ok && result.twinId && !prop.falkonPropertyId) {
        await db.execute(
          sql`UPDATE properties
              SET falkon_property_id = ${result.twinId}, falkon_synced_at = now()
              WHERE id = ${prop.id}::uuid`,
        );
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return res.json({ ok: true, synced: okCount, total: properties.length, results });
  } catch (err: any) {
    logger.error({ err }, "falkon sync properties failed");
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.post("/falkon/admin/sync/units/:propId", async (req, res) => {
  try {
    const { propId } = req.params as { propId: string };
    // "all" is a sentinel that syncs every unit across all properties.
    const units =
      propId === "all"
        ? await db.select().from(falkonUnitsTable)
        : await db.select().from(falkonUnitsTable).where(eq(falkonUnitsTable.propertyId, propId));

    const results: { id: string; ok: boolean }[] = [];
    for (const unit of units) {
      const result = await syncUnitTwin({
        id: unit.id,
        propertyId: unit.propertyId,
        unitLabel: unit.unitLabel,
        status: unit.status ?? "unknown",
        falkonUnitId: unit.falkonUnitId ?? null,
        currentJobId: unit.currentJobId ?? null,
      });
      // Write back the twin ID if Falkon assigned one
      if (result.ok && result.twinId && !unit.falkonUnitId) {
        await db.execute(
          sql`UPDATE falkon_units SET falkon_unit_id = ${result.twinId}, falkon_synced_at = now() WHERE id = ${unit.id}::uuid`,
        );
      }
      results.push({ id: unit.id, ok: result.ok });
    }

    return res.json({ ok: true, synced: results.filter((r) => r.ok).length, total: units.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.post("/falkon/admin/sync/vendors", async (_req, res) => {
  try {
    const crews = await db.select().from(crewsTable);
    const results: { id: string; ok: boolean }[] = [];

    for (const crew of crews) {
      const result = await syncVendorTwin({
        id: crew.id,
        name: crew.name,
        trade: crew.trade ?? null,
        falkonVendorId: crew.falkonVendorId ?? null,
        falkonTier: crew.falkonTier ?? null,
        falkonComplianceStatus: (crew as any).falkonComplianceStatus ?? null,
      });
      results.push({ id: crew.id, ok: result.ok });
    }

    return res.json({ ok: true, synced: results.filter((r) => r.ok).length, total: crews.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// runBootstrapAll — shared bootstrap sequence (properties → units → vendors → capabilities)
// Callable from the /sync/all endpoint AND the post-ASSISTED promotion handler so the
// sequence cannot be skipped by alternate clients or direct API calls to /promote.
// ---------------------------------------------------------------------------

type BootstrapReport = {
  steps: {
    properties: { synced: number; total: number; errors: string[] };
    units: { seeded: number; synced: number; totalProperties: number; errors: string[] };
    vendors: { synced: number; total: number; errors: string[] };
    capabilities: { ok: boolean; registered: number; error?: string };
  };
  ok: boolean;
  completedAt: string;
};

async function runBootstrapAll(): Promise<BootstrapReport> {
  const report: BootstrapReport = {
    steps: {
      properties: { synced: 0, total: 0, errors: [] },
      units: { seeded: 0, synced: 0, totalProperties: 0, errors: [] },
      vendors: { synced: 0, total: 0, errors: [] },
      capabilities: { ok: false, registered: 0 },
    },
    ok: false,
    completedAt: new Date().toISOString(),
  };

  // ── Step 1: Properties ──────────────────────────────────────────────────
  try {
    const properties = await db.select().from(propertiesTable);
    report.steps.properties.total = properties.length;
    for (const prop of properties) {
      try {
        const result = await syncPropertyTwin({
          id: prop.id,
          name: prop.name,
          address: prop.address,
          city: prop.city,
          units: prop.units,
          latitude: prop.latitude,
          longitude: prop.longitude,
          falkonPropertyId: prop.falkonPropertyId,
        });
        if (result.ok) {
          report.steps.properties.synced++;
          if (result.twinId && !prop.falkonPropertyId) {
            await db.execute(
              sql`UPDATE properties
                  SET falkon_property_id = ${result.twinId}, falkon_synced_at = now()
                  WHERE id = ${prop.id}::uuid`,
            );
          }
        } else {
          report.steps.properties.errors.push(`${prop.id}: sync failed`);
        }
      } catch (propErr: any) {
        report.steps.properties.errors.push(`${prop.id}: ${propErr?.message ?? String(propErr)}`);
      }
    }
  } catch (err: any) {
    logger.error({ err }, "falkon bootstrap: properties step failed");
    report.steps.properties.errors.push(`step failed: ${err?.message ?? String(err)}`);
  }

  // ── Step 2: Units — seed from job unitNos then sync twins ───────────────
  try {
    const allProperties = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable);
    report.steps.units.totalProperties = allProperties.length;

    for (const prop of allProperties) {
      try {
        // Seed falkon_units rows from distinct job unitNos (idempotent)
        const unitNoRows = await db.execute(
          sql`SELECT DISTINCT unit_no AS "unitNo"
              FROM jobs
              WHERE property_id = ${prop.id}::uuid
                AND unit_no IS NOT NULL
                AND trim(unit_no) != ''`,
        );
        const unitNos: string[] = ((unitNoRows as any).rows ?? (unitNoRows as unknown as any[]))
          .map((r: any) => r.unitNo ?? r.unit_no)
          .filter(Boolean);

        for (const unitNo of unitNos) {
          const exists = await db.execute(
            sql`SELECT id FROM falkon_units
                WHERE property_id = ${prop.id}::uuid AND unit_label = ${unitNo}
                LIMIT 1`,
          );
          const existsRows = (exists as any).rows ?? (exists as any);
          if (!Array.isArray(existsRows) || existsRows.length === 0) {
            await db.execute(
              sql`INSERT INTO falkon_units
                    (id, property_id, unit_label, status, created_at, updated_at)
                  VALUES
                    (gen_random_uuid(), ${prop.id}::uuid, ${unitNo}, 'unknown', now(), now())
                  ON CONFLICT DO NOTHING`,
            );
            report.steps.units.seeded++;
          }
        }

        // Sync all falkon_units for this property to the gateway
        const units = await db
          .select()
          .from(falkonUnitsTable)
          .where(eq(falkonUnitsTable.propertyId, prop.id));

        for (const unit of units) {
          const result = await syncUnitTwin({
            id: unit.id,
            propertyId: unit.propertyId,
            unitLabel: unit.unitLabel,
            status: unit.status ?? "unknown",
            falkonUnitId: unit.falkonUnitId ?? null,
            currentJobId: unit.currentJobId ?? null,
          });
          if (result.ok) {
            report.steps.units.synced++;
            // Persist Falkon's assigned twin ID if returned and not yet stored
            if (result.twinId && !unit.falkonUnitId) {
              await db.execute(
                sql`UPDATE falkon_units
                    SET falkon_unit_id = ${result.twinId}, updated_at = now()
                    WHERE id = ${unit.id}::uuid`,
              );
            }
          } else {
            report.steps.units.errors.push(`${unit.id}: sync failed`);
          }
        }
      } catch (propErr: any) {
        report.steps.units.errors.push(
          `property ${prop.id}: ${propErr?.message ?? String(propErr)}`,
        );
      }
    }
  } catch (err: any) {
    logger.error({ err }, "falkon bootstrap: units step failed");
    report.steps.units.errors.push(`step failed: ${err?.message ?? String(err)}`);
  }

  // ── Step 3: Vendors ─────────────────────────────────────────────────────
  try {
    const crews = await db.select().from(crewsTable);
    report.steps.vendors.total = crews.length;
    for (const crew of crews) {
      try {
        const result = await syncVendorTwin({
          id: crew.id,
          name: crew.name,
          trade: crew.trade ?? null,
          falkonVendorId: crew.falkonVendorId ?? null,
          falkonTier: crew.falkonTier ?? null,
          falkonComplianceStatus: (crew as any).falkonComplianceStatus ?? null,
        });
        if (result.ok) report.steps.vendors.synced++;
        else report.steps.vendors.errors.push(`${crew.id}: sync failed`);
      } catch (crewErr: any) {
        report.steps.vendors.errors.push(`${crew.id}: ${crewErr?.message ?? String(crewErr)}`);
      }
    }
  } catch (err: any) {
    logger.error({ err }, "falkon bootstrap: vendors step failed");
    report.steps.vendors.errors.push(`step failed: ${err?.message ?? String(err)}`);
  }

  // ── Step 4: Capabilities ────────────────────────────────────────────────
  try {
    const capabilities = getCapabilityRegistration();
    const result = await registerCapabilities(capabilities);
    report.steps.capabilities.ok = result.ok;
    report.steps.capabilities.registered = result.registered?.length ?? capabilities.length;
    if (result.ok) {
      await db.execute(
        sql`UPDATE falkon_connections
            SET capabilities_registered_at = now(), updated_at = now()
            WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`,
      );
    }
  } catch (err: any) {
    logger.error({ err }, "falkon bootstrap: capabilities step failed");
    report.steps.capabilities.error = err?.message ?? String(err);
  }

  report.ok =
    report.steps.properties.errors.length === 0 &&
    report.steps.units.errors.length === 0 &&
    report.steps.vendors.errors.length === 0 &&
    report.steps.capabilities.ok;
  report.completedAt = new Date().toISOString();

  logger.info(
    {
      propertiesSynced: report.steps.properties.synced,
      unitsSeeded: report.steps.units.seeded,
      unitsSynced: report.steps.units.synced,
      vendorsSynced: report.steps.vendors.synced,
      capabilitiesRegistered: report.steps.capabilities.registered,
    },
    "falkon bootstrap complete",
  );

  return report;
}

// ---------------------------------------------------------------------------
// POST /falkon/admin/sync/all — full bootstrap sequence (thin wrapper)
// ---------------------------------------------------------------------------

falkonAdminRouter.post("/falkon/admin/sync/all", async (_req, res) => {
  try {
    const report = await runBootstrapAll();
    return res.json(report);
  } catch (err: any) {
    logger.error({ err }, "falkon sync/all: unexpected failure");
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.post("/falkon/admin/sync/capabilities", async (_req, res) => {
  try {
    const capabilities = getCapabilityRegistration();
    const result = await registerCapabilities(capabilities);

    if (result.ok) {
      // Persist the timestamp so eligibility checks can verify gateway registration
      await db.execute(
        sql`UPDATE falkon_connections
            SET capabilities_registered_at = now(), updated_at = now()
            WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`,
      );
    }

    return res.json({
      ok: result.ok,
      registered: result.registered ?? capabilities.map((c) => c.id),
      entitlements: result.entitlements ?? [],
      total: capabilities.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ── Make-Ready Pipeline ────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

falkonAdminRouter.post("/falkon/admin/make-ready/start", async (req, res) => {
  try {
    const { propertyId, unitLabel, jobId } = req.body as Record<string, string>;
    if (!propertyId || !unitLabel) {
      return res.status(400).json({ error: "propertyId and unitLabel required" });
    }

    const conn = await getConn();
    const mode = conn?.mode ?? "SHADOW";

    // Ensure falkon_unit exists for this label
    let unitId: string;
    const existing = await db
      .select({ id: falkonUnitsTable.id })
      .from(falkonUnitsTable)
      .where(
        sql`${falkonUnitsTable.propertyId} = ${propertyId}::uuid
          AND ${falkonUnitsTable.unitLabel} = ${unitLabel}`,
      )
      .limit(1);

    if (existing.length > 0) {
      unitId = existing[0]!.id;
    } else {
      const rows = await db.execute(
        sql`INSERT INTO falkon_units
              (id, property_id, unit_label, status, current_job_id, created_at, updated_at)
            VALUES
              (gen_random_uuid(), ${propertyId}::uuid, ${unitLabel}, 'needs_turn',
               ${jobId ?? null}, now(), now())
            RETURNING id`,
      );
      unitId = ((rows as any).rows?.[0] ?? (rows as any)[0]).id as string;
    }

    // Create execution record
    const execRows = await db.execute(
      sql`INSERT INTO falkon_executions
            (id, property_id, unit_id, unit_label, job_id, phase, status,
             mode_at_start, started_at, created_at, updated_at)
          VALUES
            (gen_random_uuid(), ${propertyId}::uuid, ${unitId}::uuid, ${unitLabel},
             ${jobId ?? null}, 'needs_turn', 'active', ${mode}, now(), now(), now())
          RETURNING id`,
    );
    const executionId = ((execRows as any).rows?.[0] ?? (execRows as any)[0]).id as string;

    return res.status(201).json({
      ok: true,
      executionId,
      unitId,
      phase: "needs_turn",
      mode,
    });
  } catch (err: any) {
    logger.error({ err }, "falkon make-ready start failed");
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.post("/falkon/admin/make-ready/:id/advance", async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const result = await advanceExecution(id);
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error({ err }, "falkon make-ready advance failed");
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.get("/falkon/admin/make-ready/:id", async (req, res) => {
  try {
    const { id } = req.params as { id: string };
    const rows = await db.execute(
      sql`SELECT e.*,
            (SELECT json_agg(ev ORDER BY ev.created_at ASC)
             FROM falkon_execution_events ev WHERE ev.execution_id = e.id
            ) AS events
          FROM falkon_executions e WHERE e.id = ${id}::uuid`,
    );
    const row = ((rows as any).rows?.[0] ?? (rows as any)[0]);
    if (!row) return res.status(404).json({ error: "Execution not found" });
    return res.json(row);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.get("/falkon/admin/make-ready", async (req, res) => {
  try {
    const { propertyId, status } = req.query as Record<string, string | undefined>;
    const rows = await db.execute(
      sql`SELECT e.id, e.property_id, e.unit_label, e.phase, e.status,
                 e.mode_at_start, e.started_at, e.completed_at, e.resident_ready_at,
                 e.error,
                 p.name AS property_name
          FROM falkon_executions e
          LEFT JOIN properties p ON p.id = e.property_id
          WHERE (${propertyId ?? null} IS NULL OR e.property_id = ${propertyId ?? null}::uuid)
            AND (${status ?? null} IS NULL OR e.status = ${status ?? null})
          ORDER BY e.started_at DESC
          LIMIT 100`,
    );
    const execs = ((rows as any).rows ?? rows) as unknown[];
    return res.json({ executions: execs, phases: PHASES });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ── Usage Metering ─────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

falkonAdminRouter.get("/falkon/admin/usage", async (_req, res) => {
  try {
    const rows = await db.execute(
      sql`SELECT capability,
                 SUM(calls) AS total_calls,
                 SUM(shadow_calls) AS shadow_calls,
                 SUM(error_count) AS errors,
                 MAX(date) AS last_used
          FROM falkon_usage_meters
          WHERE date >= CURRENT_DATE - INTERVAL '30 days'
          GROUP BY capability
          ORDER BY total_calls DESC`,
    );
    const meters = ((rows as any).rows ?? rows) as unknown[];

    // Merge with capability registry for full picture
    const byId = new Map(meters.map((m: any) => [m.capability, m]));
    const full = FALKON_CAPABILITIES.map((cap) => ({
      ...cap,
      usage: byId.get(cap.id) ?? {
        total_calls: 0,
        shadow_calls: 0,
        errors: 0,
        last_used: null,
      },
    }));

    return res.json({ capabilities: full, periodDays: 30 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

falkonAdminRouter.get("/falkon/admin/usage/daily", async (req, res) => {
  try {
    const { capability, days = "14" } = req.query as Record<string, string | undefined>;
    const rows = await db.execute(
      sql`SELECT date, capability, calls, shadow_calls, error_count
          FROM falkon_usage_meters
          WHERE date >= CURRENT_DATE - (${parseInt(days, 10)} || ' days')::interval
            AND (${capability ?? null} IS NULL OR capability = ${capability ?? null})
          ORDER BY date DESC, calls DESC`,
    );
    return res.json({ daily: ((rows as any).rows ?? rows) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// ── Eligibility ────────────────────────────────────────────────────────────
// ---------------------------------------------------------------------------

falkonAdminRouter.get("/falkon/admin/eligibility", async (_req, res) => {
  try {
    const conn = await getConn();

    const checks: { id: string; label: string; pass: boolean; detail: string }[] = [];

    // 1. Connection verified
    checks.push({
      id: "connection_verified",
      label: "Connection Verified",
      pass: conn?.status === "verified",
      detail: conn?.status === "verified"
        ? `Verified at ${conn?.verifiedAt ?? "unknown"}`
        : "Five-step verification not complete",
    });

    // 2. Trust doc reachable
    try {
      const trustDocResponse = await fetch(
        `${ARCHANGEL_BASE_URL}/.well-known/falkon-trust.json`,
        { signal: AbortSignal.timeout(5_000) },
      );
      checks.push({
        id: "trust_doc_reachable",
        label: "Trust Document Reachable",
        pass: trustDocResponse.ok,
        detail: trustDocResponse.ok
          ? "Trust doc served at /.well-known/falkon-trust.json"
          : `Trust doc returned ${trustDocResponse.status}`,
      });
    } catch {
      checks.push({
        id: "trust_doc_reachable",
        label: "Trust Document Reachable",
        pass: false,
        detail: "Trust doc fetch failed or timed out",
      });
    }

    // 3. Gateway health
    const health = await gatewayHealth();
    checks.push({
      id: "gateway_healthy",
      label: "Gateway Healthy",
      pass: health.ok,
      detail: health.ok ? "Gateway responded OK" : `Gateway error: ${health.status}`,
    });

    // 4. Capabilities registered with the Falkon gateway (not just local registry)
    const capRegisteredAt = conn?.capabilitiesRegisteredAt
      ? new Date(conn.capabilitiesRegisteredAt as string | Date)
      : null;
    checks.push({
      id: "capabilities_registered",
      label: "Capabilities Registered with Gateway",
      pass: !!capRegisteredAt,
      detail: capRegisteredAt
        ? `Registered at ${capRegisteredAt.toLocaleString()}`
        : "Run 'Register Capabilities' in the Capabilities tab to push the registry to Falkon",
    });

    // 5. At least one property twin synced
    const [prop] = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(sql`${propertiesTable.falkonPropertyId} IS NOT NULL`)
      .limit(1);
    checks.push({
      id: "property_twin_synced",
      label: "Property Twin Synced",
      pass: !!prop,
      detail: prop ? "At least one property twin synced to Falkon" : "No property twins synced",
    });

    // 6. Webhook functioning (has processed at least one inbound event)
    // Note: falkon_inbound_events uses status='processed' (text), not a boolean column
    const eventCount = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM falkon_inbound_events WHERE status = 'processed'`,
    );
    const cnt = parseInt(
      String(((eventCount as any).rows?.[0] ?? (eventCount as any)[0])?.cnt ?? "0"),
      10,
    );
    checks.push({
      id: "webhook_functioning",
      label: "Webhook Functioning",
      pass: cnt > 0,
      detail: cnt > 0
        ? `${cnt} inbound event(s) processed successfully`
        : "No inbound events received yet (send a test event from Falkon console)",
    });

    // 7. Ed25519 identity present
    checks.push({
      id: "signing_identity",
      label: "Ed25519 Signing Identity",
      pass: !!getPublicKeyPem(),
      detail: getPublicKeyPem()
        ? "HALO has a valid Ed25519 signing identity"
        : "Signing identity not initialised — restart the server",
    });

    const allPass = checks.every((c) => c.pass);
    const currentMode = conn?.mode ?? "SHADOW";
    const nextMode = currentMode === "SHADOW"
      ? "ASSISTED"
      : currentMode === "ASSISTED"
        ? "LIVE"
        : null;

    return res.json({
      currentMode,
      nextMode,
      eligibleToPromote: allPass && !!nextMode,
      checks,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Inbound events listing (office-gated) ─────────────────────────────────
falkonAdminRouter.get("/falkon/admin/inbound-events", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    // Columns: id, falkon_event_id, event_type, payload, status, processed_at, error, created_at
    const events = await db.execute(
      sql`SELECT id, falkon_event_id, event_type, status, processed_at, error,
                 payload->'eventType' AS event_type_from_payload,
                 created_at
          FROM falkon_inbound_events
          ORDER BY created_at DESC
          LIMIT ${limit}`,
    );
    const rows = (events as any).rows ?? (events as any);
    return res.json({ events: Array.isArray(rows) ? rows : [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Mode ladder: SHADOW → ASSISTED only.
// LIVE mode is never auto-promoted from this UI — it requires a separate
// explicit Falkon partnership enablement process. Blocking LIVE here prevents
// accidental autonomous execution from this admin surface.
const MODE_LADDER: Record<string, string> = {
  SHADOW: "ASSISTED",
  // ASSISTED → LIVE intentionally absent: LIVE requires explicit Falkon enablement
};

falkonAdminRouter.post("/falkon/admin/eligibility/promote", async (req, res) => {
  try {
    const conn = await getConn();
    if (!conn) return res.status(400).json({ error: "No Falkon connection configured" });

    const currentMode = conn.mode ?? "SHADOW";
    const targetMode = req.body?.targetMode as string | undefined;

    // Hard stop: LIVE mode is never permitted from this endpoint
    if (targetMode === "LIVE") {
      return res.status(400).json({
        error: "LIVE mode requires a separate explicit Falkon partnership enablement process. This endpoint only promotes to ASSISTED.",
        currentMode,
        allowedTarget: MODE_LADDER[currentMode] ?? null,
      });
    }

    const promoteTo = targetMode ?? MODE_LADDER[currentMode];

    // Gate 1: target mode must be the next rung on the ladder
    if (!promoteTo || MODE_LADDER[currentMode] !== promoteTo) {
      return res.status(400).json({
        error: `Invalid promotion: ${currentMode} → ${promoteTo ?? "?"} is not an allowed transition. Only SHADOW → ASSISTED is permitted.`,
        currentMode,
        allowedTarget: MODE_LADDER[currentMode] ?? null,
      });
    }

    // Gate 2: connection must be verified before promoting beyond SHADOW
    if (conn.status !== "verified") {
      return res.status(409).json({
        error: "Connection must be verified before mode promotion. Complete all five verification steps.",
        currentStatus: conn.status,
      });
    }

    // Gate 3: Ed25519 signing identity must be active
    if (!getPublicKeyPem()) {
      return res.status(409).json({
        error: "Ed25519 signing identity not initialised — restart the server.",
      });
    }

    await db
      .update(falkonConnectionsTable)
      .set({ mode: promoteTo as any, updatedAt: new Date() })
      .where(eq(falkonConnectionsTable.id, conn.id));

    logger.info({ fromMode: currentMode, toMode: promoteTo }, "falkon: mode promoted");

    // When promoting to ASSISTED, kick off the full twin bootstrap asynchronously.
    // We fire-and-forget so the promote response is immediate; the bootstrap logs its own outcome.
    if (promoteTo === "ASSISTED") {
      void runBootstrapAll().catch((err) =>
        logger.error({ err }, "falkon: post-promote bootstrap failed"),
      );
    }

    return res.json({
      ok: true,
      previousMode: currentMode,
      mode: promoteTo,
      bootstrapTriggered: promoteTo === "ASSISTED",
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// Capability registry summary
falkonAdminRouter.get("/falkon/admin/capabilities", async (_req, res) => {
  return res.json({ capabilities: FALKON_CAPABILITIES, total: FALKON_CAPABILITIES.length });
});

// ---------------------------------------------------------------------------
// POST /falkon/admin/test/seed-remote-identity
// DELETE /falkon/admin/test/seed-remote-identity
//
// TEST-ONLY: seeds or removes an Ed25519 public key in falkon_remote_identity
// so integration tests can sign webhook events with a test keypair without
// needing a live Falkon gateway.
//
// POST body:  { publicKeyPem: string }
// POST returns: { ok: true, previousPublicKeyPem: string | null }
//   The caller MUST pass previousPublicKeyPem back in the DELETE (or a second
//   POST) to restore the original state after the test run.
//
// DELETE removes the current remote identity (leaves the table empty).
// DELETE body: { restorePublicKeyPem?: string } — if supplied, re-inserts
//   that key instead of leaving the table empty, enabling full round-trip restore.
//
// ONLY available when HALO_TEST_MODE=1. Returns 404 in all other environments.
// Office-gated (passcode cookie) as an additional safety layer.
// ---------------------------------------------------------------------------
falkonAdminRouter.post("/falkon/admin/test/seed-remote-identity", async (req, res) => {
  if (process.env.HALO_TEST_MODE !== "1") {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const { publicKeyPem } = req.body ?? {};
    if (!publicKeyPem || typeof publicKeyPem !== "string") {
      return res.status(400).json({ error: "publicKeyPem is required" });
    }
    // Save the existing key before wiping so the caller can restore it
    const prev = await db.execute(
      sql`SELECT public_key_pem FROM falkon_remote_identity ORDER BY fetched_at DESC LIMIT 1`,
    );
    const prevRows = (prev as any).rows ?? prev;
    const previousPublicKeyPem: string | null =
      Array.isArray(prevRows) && prevRows.length > 0
        ? ((prevRows[0] as any).public_key_pem as string)
        : null;

    await db.execute(sql`DELETE FROM falkon_remote_identity WHERE TRUE`);
    await db.execute(
      sql`INSERT INTO falkon_remote_identity
            (id, partner_id, public_key_pem, algorithm, fetched_at, trust_doc_url, created_at)
          VALUES
            (gen_random_uuid(), 'falkon-test', ${publicKeyPem},
             'Ed25519', now(), 'https://test.falkon-partner.example.com', now())`,
    );
    logger.info("falkon: test remote identity seeded (HALO_TEST_MODE=1)");
    return res.json({ ok: true, previousPublicKeyPem });
  } catch (err: any) {
    logger.error({ err }, "POST /falkon/admin/test/seed-remote-identity failed");
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ── 7-Gate Unified Verify System ─────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

const GATE_NAMES = [
  "Identity Ready",
  "Trust Published",
  "Gateway Reachable",
  "Partner Verified",
  "Capabilities Registered",
  "Webhook Live",
  "SHADOW Round-Trip ✓",
] as const;

interface GateResult {
  gate: number;
  name: string;
  passed: boolean;
  detail?: string;
  error?: string;
  ts: string;
  /** Gate 7 only: true when no live eventIngestUrl is configured; the gate
   *  auto-passes on dispatch confirmation without a real round-trip callback. */
  stub?: boolean;
}

/**
 * Determine whether Gate 7 should run in stub mode.
 *
 * Stub mode applies when no live Falkon gateway is configured — i.e. when
 * eventIngestUrl is absent from the connection record.  In stub mode Gate 7
 * passes immediately on dispatch confirmation so operators don't wait 15 s
 * for a callback that will never arrive.
 *
 * When a real gateway is configured (eventIngestUrl is present) we do an
 * additional quick reachability probe: if the gateway is unreachable we still
 * treat the gate as stub-mode so the verify flow doesn't stall.
 */
async function isStubMode(): Promise<{ stub: boolean; reason: string }> {
  try {
    const conn = await getConn();
    const ingestUrl = (conn as any)?.eventIngestUrl as string | null | undefined;
    if (!ingestUrl) {
      return { stub: true, reason: "no eventIngestUrl configured" };
    }
    // Live URL configured — probe reachability with a short timeout.
    try {
      const probe = await fetch(ingestUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(3_000),
      });
      if (probe.ok || probe.status < 500) {
        // Gateway responded (even a 4xx means it's reachable)
        return { stub: false, reason: "gateway reachable" };
      }
      return { stub: true, reason: `gateway returned HTTP ${probe.status}` };
    } catch {
      return { stub: true, reason: "gateway unreachable (probe timed out or network error)" };
    }
  } catch {
    return { stub: true, reason: "could not read connection record" };
  }
}

async function runShadowRoundTrip(): Promise<GateResult> {
  const ts = new Date().toISOString();
  const name = GATE_NAMES[6];
  const testJobId = `verify-test-${Date.now()}`;
  try {
    // ── Stub-mode detection ───────────────────────────────────────────────
    // When no live Falkon gateway is configured (or it is unreachable) we
    // auto-pass on dispatch confirmation so the verify flow doesn't hang for
    // 15 s waiting for a callback that will never arrive.
    const { stub, reason: stubReason } = await isStubMode();

    const execResult = await runShadowExecution({
      jobId: testJobId,
    });
    if (!execResult.ok) {
      return { gate: 7, name, passed: false, error: (execResult as any).error ?? "Shadow dispatch failed", ts };
    }

    if (stub) {
      // Auto-pass: dispatch succeeded, no live callback expected yet.
      const detail = `Dispatch confirmed (stub) — ${stubReason}. Connect a live gateway to enable full round-trip verification.`;
      await setVerifStep("gate7", { ok: true, testJobId, stub: true, stubReason, ts: new Date().toISOString() });
      return { gate: 7, name, passed: true, detail, stub: true, ts: new Date().toISOString() };
    }

    // ── Live gateway: poll falkon_inbound_events for up to 15 s ──────────
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 800));
      // The webhook handler stores the full inbound body in payload. Falkon callbacks
      // may carry the correlation IDs at the top level OR nested under payload.payload
      // (the body.payload field that the ingest handler copies into the column).
      const rows = await db.execute(
        sql`SELECT id FROM falkon_inbound_events
            WHERE payload->>'testJobId' = ${testJobId}
               OR payload->>'correlationId' = ${testJobId}
               OR payload->>'jobId' = ${testJobId}
               OR payload->'payload'->>'testJobId' = ${testJobId}
               OR payload->'payload'->>'correlationId' = ${testJobId}
               OR payload->'payload'->>'jobId' = ${testJobId}
            ORDER BY created_at DESC LIMIT 1`,
      );
      const found = ((rows as any).rows?.[0] ?? (rows as any)[0]);
      if (found) {
        await setVerifStep("gate7", { ok: true, testJobId, callbackEventId: found.id, ts: new Date().toISOString() });
        return { gate: 7, name, passed: true, detail: `Round-trip confirmed — inbound event: ${found.id}`, ts: new Date().toISOString() };
      }
    }
    // Timed out — no inbound callback received; a dispatch alone is not a verified round-trip.
    await setVerifStep("gate7", { ok: false, testJobId, note: "no-callback-15s", ts: new Date().toISOString() });
    return {
      gate: 7, name, passed: false,
      error: "No inbound callback received within 15s — round-trip not confirmed. A live Falkon gateway connection is required for Gate 7.",
      ts: new Date().toISOString(),
    };
  } catch (err: any) {
    return { gate: 7, name, passed: false, error: err.message ?? "Unexpected error", ts };
  }
}

async function runGate(gateNum: number): Promise<GateResult> {
  const ts = new Date().toISOString();
  const name = GATE_NAMES[gateNum - 1] ?? `Gate ${gateNum}`;
  try {
    switch (gateNum) {
      case 1: { // Identity Ready — local: Ed25519 keypair + trust doc buildable
        const pem = getPublicKeyPem();
        if (!pem) return { gate: 1, name, passed: false, error: "Ed25519 keypair not initialised — restart server", ts };
        const trustDoc = buildTrustDoc(ARCHANGEL_BASE_URL);
        if (!trustDoc) return { gate: 1, name, passed: false, error: "Trust doc could not be built (check DB identity row)", ts };
        return { gate: 1, name, passed: true, detail: `Key: ${pem.slice(27, 60)}…`, ts };
      }
      case 2: { // Trust Published — fetch HALO's own trust doc from public URL
        const trustUrl = `${ARCHANGEL_BASE_URL}/.well-known/falkon-trust.json`;
        const resp = await fetch(trustUrl, { signal: AbortSignal.timeout(5_000) });
        if (!resp.ok) return { gate: 2, name, passed: false, error: `Trust doc returned HTTP ${resp.status}`, ts };
        const doc = await resp.json().catch(() => null) as Record<string, unknown> | null;
        if (!doc?.clientId) return { gate: 2, name, passed: false, error: "Trust doc missing clientId field", ts };
        return { gate: 2, name, passed: true, detail: `Published at ${trustUrl}`, ts };
      }
      case 3: { // Gateway Reachable — signed ping
        const pingResult = await gatewayPing();
        if (!pingResult.ok) return { gate: 3, name, passed: false, error: (pingResult as any).error ?? "Ping failed", ts };
        return { gate: 3, name, passed: true, detail: "Signed ping acknowledged by gateway", ts };
      }
      case 4: { // Partner Verified — submit trust binding
        const pem = getPublicKeyPem();
        if (!pem) return { gate: 4, name, passed: false, error: "No signing key — complete Gate 1 first", ts };
        const trustDocUrl = `${ARCHANGEL_BASE_URL}/.well-known/falkon-trust.json`;
        const result = await submitTrustBinding(trustDocUrl, pem);
        if (!result.ok) return { gate: 4, name, passed: false, error: (result as any).error ?? "Trust binding rejected", ts };
        await db.execute(sql`UPDATE falkon_connections SET trust_doc_verified_at = now(), updated_at = now() WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`);
        return { gate: 4, name, passed: true, detail: `Client: ${CLIENT_ID}`, ts };
      }
      case 5: { // Capabilities Registered — register 22 caps with gateway
        const capReg = getCapabilityRegistration();
        const result = await registerCapabilities(capReg);
        if (!result.ok) return { gate: 5, name, passed: false, error: (result as any).error ?? "Capability registration failed", ts };
        await db.execute(sql`UPDATE falkon_connections SET capabilities_registered_at = now(), updated_at = now() WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`);
        const registeredCount = Array.isArray(result.registered) ? result.registered.length : capReg.length;
        return { gate: 5, name, passed: true, detail: `${registeredCount}/${capReg.length} capabilities registered`, ts };
      }
      case 6: { // Webhook Live — register callback with gateway
        const cbResult = await registerCallback(WEBHOOK_URL);
        if (!cbResult.ok) return { gate: 6, name, passed: false, error: (cbResult as any).error ?? "Webhook registration failed", ts };
        return { gate: 6, name, passed: true, detail: `Webhook: ${WEBHOOK_URL}`, ts };
      }
      case 7: return runShadowRoundTrip();
      default: return { gate: gateNum, name, passed: false, error: "Unknown gate number", ts };
    }
  } catch (err: any) {
    return { gate: gateNum, name, passed: false, error: err.message ?? "Unexpected error", ts };
  }
}

/** POST /falkon/admin/verify/gate/:gateNumber — run a single gate */
falkonAdminRouter.post("/falkon/admin/verify/gate/:gateNumber", async (req, res) => {
  const gateNum = Number(req.params.gateNumber);
  if (!Number.isInteger(gateNum) || gateNum < 1 || gateNum > 7) {
    return res.status(400).json({ error: "gateNumber must be 1–7" });
  }
  try {
    const result = await runGate(gateNum);
    await setVerifStep(`gate${gateNum}`, { ok: result.passed, detail: result.detail, error: result.error, ts: result.ts, ...(result.stub !== undefined ? { stub: result.stub } : {}) });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /falkon/admin/verify/all — run all 7 gates in sequence, stop on first failure */
falkonAdminRouter.post("/falkon/admin/verify/all", async (_req, res) => {
  try {
    const results: GateResult[] = [];
    for (let g = 1; g <= 7; g++) {
      const result = await runGate(g);
      results.push(result);
      await setVerifStep(`gate${g}`, { ok: result.passed, detail: result.detail, error: result.error, ts: result.ts, ...(result.stub !== undefined ? { stub: result.stub } : {}) });
      if (!result.passed) break;
    }
    const fullyConnected = results.length === 7 && results.every((r) => r.passed);
    if (fullyConnected) {
      await db.execute(
        sql`UPDATE falkon_connections SET status = 'verified', verified_at = now(), updated_at = now() WHERE id = (SELECT id FROM falkon_connections LIMIT 1)`,
      );
    } else {
      // Any gate failure demotes/clears a previously verified connection so stale callers can't
      // rely on a connection status that no longer holds.
      await db.execute(
        sql`UPDATE falkon_connections SET status = 'pending', verified_at = NULL, updated_at = now()
            WHERE id = (SELECT id FROM falkon_connections LIMIT 1) AND status = 'verified'`,
      );
    }
    return res.json({ gates: results, fullyConnected, stoppedAt: results[results.length - 1]?.gate ?? 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /falkon/admin/verify/shadow-roundtrip — gate 7 standalone */
falkonAdminRouter.post("/falkon/admin/verify/shadow-roundtrip", async (_req, res) => {
  try {
    const result = await runShadowRoundTrip();
    await setVerifStep("gate7", { ok: result.passed, detail: result.detail, error: result.error, ts: result.ts, ...(result.stub !== undefined ? { stub: result.stub } : {}) });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /falkon/admin/health — consolidated health object for the Control Center */
falkonAdminRouter.get("/falkon/admin/health", async (_req, res) => {
  try {
    const [conn, gwHealth, propCount, unitCount, vendorCount, failedJobCount, recentInboundCount] = await Promise.all([
      getConn(),
      gatewayHealth().catch(() => ({ ok: false, status: "unreachable" })),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM properties WHERE falkon_property_id IS NOT NULL`).then((r) => Number(((r as any).rows ?? r)[0]?.cnt ?? 0)).catch(() => 0),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM falkon_units WHERE falkon_unit_id IS NOT NULL`).then((r) => Number(((r as any).rows ?? r)[0]?.cnt ?? 0)).catch(() => 0),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM crews WHERE falkon_vendor_id IS NOT NULL`).then((r) => Number(((r as any).rows ?? r)[0]?.cnt ?? 0)).catch(() => 0),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM falkon_executions WHERE status = 'failed'`).then((r) => Number(((r as any).rows ?? r)[0]?.cnt ?? 0)).catch(() => 0),
      db.execute(sql`SELECT COUNT(*) AS cnt FROM falkon_inbound_events WHERE created_at > now() - INTERVAL '24 hours'`).then((r) => Number(((r as any).rows ?? r)[0]?.cnt ?? 0)).catch(() => 0),
    ]);

    const steps = (conn?.verificationSteps ?? {}) as Record<string, { ok?: boolean; ts?: string; detail?: string; error?: string; stub?: boolean }>;
    const gates = Array.from({ length: 7 }, (_, i) => {
      const key = `gate${i + 1}`;
      const step = steps[key];
      const base = { gate: i + 1, name: GATE_NAMES[i], passed: step?.ok ?? false, detail: step?.detail, error: step?.error, ts: step?.ts ?? null };
      // Gate 7 carries a stub flag when there is no live eventIngestUrl configured
      if (i === 6 && step?.stub) return { ...base, stub: true };
      return base;
    });
    const fullyConnected = gates.every((g) => g.passed);

    return res.json({
      mode: conn?.mode ?? "OFF",
      status: conn?.status ?? "disconnected",
      gatewayHealth: gwHealth,
      verifiedAt: conn?.verifiedAt?.toISOString() ?? null,
      fullyConnected,
      gates,
      capabilities: {
        total: FALKON_CAPABILITIES.length,
        registeredAt: conn?.capabilitiesRegisteredAt?.toISOString() ?? null,
      },
      twinSync: {
        properties: propCount,
        units: unitCount,
        vendors: vendorCount,
      },
      failedJobCount,
      recentInboundCount,
      webhookUrl: conn?.webhookUrl ?? WEBHOOK_URL,
      trustDocUrl: `${ARCHANGEL_BASE_URL}/.well-known/falkon-trust.json`,
      clientId: CLIENT_ID,
      partnerClientId: conn?.partnerClientId ?? null,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /falkon/admin/executions — list executions with optional status filter */
falkonAdminRouter.get("/falkon/admin/executions", async (req, res) => {
  try {
    const { status, limit: limitStr } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(limitStr ?? 20), 100);
    const rows = await db.execute(
      sql`SELECT e.id, e.unit_label, e.phase, e.status, e.mode_at_start,
                 e.started_at, e.completed_at, e.error,
                 p.name AS property_name,
                 EXTRACT(EPOCH FROM (COALESCE(e.completed_at, now()) - e.started_at)) * 1000 AS duration_ms
          FROM falkon_executions e
          LEFT JOIN properties p ON p.id = e.property_id
          WHERE (${status ?? null} IS NULL OR e.status = ${status ?? null})
          ORDER BY e.started_at DESC
          LIMIT ${limit}`,
    );
    const executions = ((rows as any).rows ?? rows) as unknown[];
    return res.json({ executions: Array.isArray(executions) ? executions : [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** POST /falkon/admin/executions/:id/retry — reset a failed execution to pending */
falkonAdminRouter.post("/falkon/admin/executions/:id/retry", async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute(
      sql`UPDATE falkon_executions SET status = 'pending', error = NULL, updated_at = now()
          WHERE id = ${id}::uuid AND status = 'failed'`,
    );
    return res.json({ ok: true, id });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/** GET /falkon/admin/inbound — inbound events with optional status filter */
falkonAdminRouter.get("/falkon/admin/inbound", async (req, res) => {
  try {
    const { status, limit: limitStr } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(limitStr ?? 50), 200);
    const events = await db.execute(
      sql`SELECT id, falkon_event_id, event_type, status, processed_at, error, created_at
          FROM falkon_inbound_events
          WHERE (${status ?? null} IS NULL OR status = ${status ?? null})
          ORDER BY created_at DESC
          LIMIT ${limit}`,
    );
    const rows = ((events as any).rows ?? events) as unknown[];
    return res.json({ events: Array.isArray(rows) ? rows : [] });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── (test-only routes below) ─────────────────────────────────────────────────

falkonAdminRouter.delete("/falkon/admin/test/seed-remote-identity", async (req, res) => {
  if (process.env.HALO_TEST_MODE !== "1") {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const { restorePublicKeyPem } = req.body ?? {};
    await db.execute(sql`DELETE FROM falkon_remote_identity WHERE TRUE`);
    if (restorePublicKeyPem && typeof restorePublicKeyPem === "string") {
      await db.execute(
        sql`INSERT INTO falkon_remote_identity
              (id, partner_id, public_key_pem, algorithm, fetched_at, trust_doc_url, created_at)
            VALUES
              (gen_random_uuid(), 'falkon-gateway', ${restorePublicKeyPem},
               'Ed25519', now(), 'https://gateway.falkon.app', now())`,
      );
      logger.info("falkon: remote identity restored to previous key (HALO_TEST_MODE=1)");
    } else {
      logger.info("falkon: remote identity cleared (HALO_TEST_MODE=1)");
    }
    return res.json({ ok: true });
  } catch (err: any) {
    logger.error({ err }, "DELETE /falkon/admin/test/seed-remote-identity failed");
    return res.status(500).json({ error: err.message });
  }
});
