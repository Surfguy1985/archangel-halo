/**
 * Falkon Ops integration routes — Phase 0.
 *
 * OFFICE-GATED (behind officeGuard):
 *   GET  /falkon/connection            — current connection state
 *   POST /falkon/connect               — store partner key + webhook URL
 *   POST /falkon/verify                — run round-trip ping to verify webhook
 *   PATCH /falkon/connection           — update mode or webhook URL
 *   DELETE /falkon/connection          — disconnect (mode → OFF, clear secrets)
 *   GET  /falkon/events                — list outbox events (admin)
 *   POST /falkon/events/:id/retry      — reset a dead event for redelivery
 *   GET  /falkon/policies              — list policies
 *   PUT  /falkon/policies              — upsert global or per-property policy
 *   GET  /falkon/units/:propertyId     — list property units
 *   POST /falkon/units/bootstrap/:propertyId — seed units from distinct job unitNos
 *
 * PUBLIC (Falkon-key-gated, listed in officeAuth PUBLIC_PREFIXES):
 *   POST /falkon/inbound/:eventType    — receive signed Falkon → HALO events
 *   GET  /falkon/jobs/:id/evidence     — evidence bundle for a job (Falkon reads)
 *   POST /falkon/ping                  — verify round-trip; called by /falkon/verify
 */

import { Router } from "express";
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  falkonEventsTable,
  falkonInboundEventsTable,
  falkonPoliciesTable,
  falkonUnitsTable,
  jobsTable,
  crewPhotosTable,
  jobChecklistsTable,
  cleaningChecklistsTable,
  crewCheckinsTable,
  activitiesTable,
} from "@workspace/db/schema";
import { buildFalkonSignature } from "../lib/falkonEmit";
import { logger } from "../lib/logger";

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function getConnection() {
  const [conn] = await db
    .select()
    .from(falkonConnectionsTable)
    .limit(1);
  return conn ?? null;
}

/** Redact the secret fields so they never reach the browser. */
function redactConn(conn: typeof falkonConnectionsTable.$inferSelect) {
  return {
    id: conn.id,
    falkonOrgId: conn.falkonOrgId,
    webhookUrl: conn.webhookUrl,
    mode: conn.mode,
    // status is a non-secret field the UI reads to display pending/verified/etc.
    status: conn.status,
    capabilities: conn.capabilities,
    connectedAt: conn.connectedAt,
    verifiedAt: conn.verifiedAt,
    trustDocVerifiedAt: conn.trustDocVerifiedAt,
    capabilitiesRegisteredAt: conn.capabilitiesRegisteredAt,
    lastPingAt: conn.lastPingAt,
    updatedAt: conn.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET /falkon/connection
// ---------------------------------------------------------------------------
router.get("/falkon/connection", async (_req, res) => {
  try {
    const conn = await getConnection();
    if (!conn) return res.json({ connected: false });
    return res.json({ connected: true, connection: redactConn(conn) });
  } catch (err) {
    logger.error({ err }, "GET /falkon/connection failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/connect
// Body: {
//   webhookUrl:     string  (required — Falkon sends events here)
//   partnerKey?:    string  (optional — hashed for evidence endpoint gating)
//   webhookSecret?: string  (optional — used only for HALO /falkon/verify ping)
//   eventIngestUrl?: string (optional — Falkon's dedicated event-ingestion endpoint)
// }
// ---------------------------------------------------------------------------
router.post("/falkon/connect", async (req, res) => {
  try {
    const { partnerKey, webhookUrl, webhookSecret, eventIngestUrl } = req.body ?? {};
    if (!webhookUrl) {
      return res.status(400).json({ error: "webhookUrl is required" });
    }
    if (!/^https:\/\//i.test(webhookUrl)) {
      return res.status(400).json({ error: "webhookUrl must be HTTPS" });
    }
    if (eventIngestUrl && !/^https:\/\//i.test(eventIngestUrl)) {
      return res.status(400).json({ error: "eventIngestUrl must be HTTPS" });
    }

    const apiKeyHash = partnerKey ? hashKey(String(partnerKey)) : null;
    const now = new Date();

    // Upsert — one connection row per HALO deployment.
    // New connections start in SHADOW mode (all writes no-ops, safe by default).
    // Reconnecting FULLY resets verification state — all five steps must be
    // re-run against the new credentials. The cached remote identity (Falkon's
    // public key) is also wiped so the fail-closed signature check cannot
    // accept callbacks using a stale key from the previous connection.
    const existing = await getConnection();
    if (existing) {
      // Full reset: clear every partner/verification/identity field so a
      // reconnect cannot inherit any state from the previous connection.
      await db
        .update(falkonConnectionsTable)
        .set({
          ...(apiKeyHash ? { apiKeyHash } : {}),
          webhookUrl: String(webhookUrl),
          ...(webhookSecret ? { webhookSecret: String(webhookSecret) } : {}),
          // Reset all partner identity fields
          falkonOrgId: null,
          partnerClientId: null,
          partnerTenant: null,
          capabilities: [],
          // Reset mode to SHADOW and clear all verification state
          mode: "SHADOW",
          status: "pending",
          connectedAt: now,
          verifiedAt: null,
          lastPingAt: null,
          verificationSteps: null,
          trustDocVerifiedAt: null,
          capabilitiesRegisteredAt: null,
          updatedAt: now,
        } as any)
        .where(eq(falkonConnectionsTable.id, existing.id));
      // Store eventIngestUrl in a separate column if present
      if (eventIngestUrl) {
        await db.execute(
          sql`UPDATE falkon_connections SET event_ingest_url = ${eventIngestUrl}, updated_at = now()
              WHERE id = ${existing.id}::uuid`,
        );
      }
      // Wipe the cached remote identity key so verification cannot use a stale key.
      await db.execute(sql`DELETE FROM falkon_remote_identity WHERE TRUE`);
      // Cancel any pending outbox events from the previous connection —
      // delivering them to a new partner would be incorrect.
      await db.execute(
        sql`UPDATE falkon_events SET status = 'cancelled'
            WHERE status IN ('pending', 'failed')`,
      );
    } else {
      // Brand-new connections start in SHADOW + pending — same as reconnect.
      await db.insert(falkonConnectionsTable).values({
        ...(apiKeyHash ? { apiKeyHash } : {}),
        webhookUrl: String(webhookUrl),
        ...(webhookSecret ? { webhookSecret: String(webhookSecret) } : {}),
        mode: "SHADOW",
        status: "pending",
        connectedAt: now,
      } as any);
      if (eventIngestUrl) {
        await db.execute(
          sql`UPDATE falkon_connections SET event_ingest_url = ${eventIngestUrl}, updated_at = now()
              WHERE id = (SELECT id FROM falkon_connections ORDER BY created_at DESC LIMIT 1)`,
        );
      }
    }

    const conn = await getConnection();
    return res.json({ ok: true, connection: redactConn(conn!) });
  } catch (err) {
    logger.error({ err }, "POST /falkon/connect failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/verify
// Sends a test ping event to the configured webhookUrl and waits for Falkon
// to echo it back via POST /falkon/ping.
// ---------------------------------------------------------------------------
router.post("/falkon/verify", async (_req, res) => {
  try {
    const conn = await getConnection();
    if (!conn?.webhookUrl || !conn.webhookSecret) {
      return res.status(400).json({ error: "Connect first before verifying" });
    }

    const pingId = randomBytes(16).toString("hex");
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({ event: "ping", pingId, ts });
    const sig = buildFalkonSignature(conn.webhookSecret, ts, body);

    // Fire the ping — Falkon should echo it back to /falkon/ping
    const resp = await fetch(conn.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "HALO-Timestamp": String(ts),
        "HALO-Signature": sig,
        "HALO-Event": "ping",
      },
      body,
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);

    const now = new Date();
    if (resp && resp.ok) {
      await db
        .update(falkonConnectionsTable)
        .set({ verifiedAt: now, lastPingAt: now, updatedAt: now })
        .where(eq(falkonConnectionsTable.id, conn.id));
      const updated = await getConnection();
      return res.json({ ok: true, connection: redactConn(updated!) });
    }

    return res.status(502).json({
      error: "Falkon webhook did not respond successfully — check webhookUrl and try again",
    });
  } catch (err) {
    logger.error({ err }, "POST /falkon/verify failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /falkon/connection
// Body: { webhookUrl?: string }
//
// NOTE: Mode promotion is intentionally NOT allowed here.
// Use POST /falkon/admin/eligibility/promote which enforces the gated ladder
// (SHADOW → ASSISTED → LIVE, status=verified required, Ed25519 identity active).
// Reconnecting (new partnerKey/webhookUrl) resets status to 'pending' and clears
// verification so the five-step flow must be re-run.
// ---------------------------------------------------------------------------
router.patch("/falkon/connection", async (req, res) => {
  try {
    const conn = await getConnection();
    if (!conn) return res.status(404).json({ error: "No Falkon connection found" });

    const { mode, webhookUrl } = req.body ?? {};

    // Mode promotion via PATCH is explicitly forbidden — use /falkon/admin/eligibility/promote
    if (mode !== undefined) {
      return res.status(400).json({
        error: "Mode promotion is not allowed via this endpoint. Use POST /api/falkon/admin/eligibility/promote which enforces the gated SHADOW → ASSISTED → LIVE ladder.",
      });
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (webhookUrl !== undefined) {
      if (!/^https:\/\//i.test(webhookUrl)) {
        return res.status(400).json({ error: "webhookUrl must be HTTPS" });
      }
      updates.webhookUrl = webhookUrl;
      // Changing the webhook URL invalidates verification — reset to pending and
      // clear steps so the five-step flow must be re-run against the new URL.
      updates.verifiedAt = null;
      updates.status = "pending";
      updates.verificationSteps = null;
    }

    await db
      .update(falkonConnectionsTable)
      .set(updates as any)
      .where(eq(falkonConnectionsTable.id, conn.id));

    const updated = await getConnection();
    return res.json({ ok: true, connection: redactConn(updated!) });
  } catch (err) {
    logger.error({ err }, "PATCH /falkon/connection failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /falkon/connection — true disconnect: deletes the connection row
// and cancels all pending outbox events.
// ---------------------------------------------------------------------------
router.delete("/falkon/connection", async (_req, res) => {
  try {
    const conn = await getConnection();
    if (!conn) return res.status(404).json({ error: "No connection to disconnect" });

    // Cancel all pending outbox events before deleting the row so delivery
    // cannot continue after reconnect to a different partner.
    // falkon_events has no updated_at column; update only status.
    await db.execute(
      sql`UPDATE falkon_events SET status = 'cancelled'
          WHERE status IN ('pending', 'failed')`,
    );
    // Delete the singleton row — GET /falkon/connection will return
    // { connected: false } and the UI will show the Connect form.
    await db.delete(falkonConnectionsTable).where(eq(falkonConnectionsTable.id, conn.id));
    // Wipe the cached remote identity key.
    await db.execute(sql`DELETE FROM falkon_remote_identity WHERE TRUE`);

    return res.json({ ok: true, message: "Falkon integration disconnected. No events will be emitted." });
  } catch (err) {
    logger.error({ err }, "DELETE /falkon/connection failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/events?status=pending|delivered|failed|dead&limit=50
// ---------------------------------------------------------------------------
router.get("/falkon/events", async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);

    const rows = await db
      .select()
      .from(falkonEventsTable)
      .where(status ? eq(falkonEventsTable.status, status) : undefined)
      .orderBy(desc(falkonEventsTable.createdAt))
      .limit(limit);

    res.json({ events: rows });
  } catch (err) {
    logger.error({ err }, "GET /falkon/events failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/events/:id/retry — reset a dead/failed event for redelivery
// ---------------------------------------------------------------------------
router.post("/falkon/events/:id/retry", async (req, res) => {
  try {
    const { id } = req.params;
    await db
      .update(falkonEventsTable)
      .set({ status: "pending", attempts: 0, nextRetryAt: new Date(), error: null })
      .where(eq(falkonEventsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /falkon/events/:id/retry failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/policies
// ---------------------------------------------------------------------------
router.get("/falkon/policies", async (_req, res) => {
  try {
    const policies = await db.select().from(falkonPoliciesTable).orderBy(falkonPoliciesTable.createdAt);
    res.json({ policies });
  } catch (err) {
    logger.error({ err }, "GET /falkon/policies failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// PUT /falkon/policies — upsert global or per-property policy
// Body: { propertyId?: string | null; ... policy fields ... }
// ---------------------------------------------------------------------------
router.put("/falkon/policies", async (req, res) => {
  try {
    const body = req.body ?? {};
    const propertyId = body.propertyId ?? null;

    const values: Record<string, unknown> = {
      propertyId,
      updatedAt: new Date(),
    };
    const numericFields = [
      "maxAutoCrewRate", "maxAutoInvoiceAmount", "maxAutoChangeOrder",
      "requirePhotoMinBefore", "requirePhotoMinAfter", "requireArrivalRadius",
      "aiPhotoReviewThreshold", "marginFloorOverride",
    ];
    const boolFields = [
      "requireInspection", "autoDispatchEnabled", "aiPhotoReviewEnabled",
    ];
    // null / "" must clear a ceiling. Number(null) and Number("") both coerce to
    // 0, which reads as "auto-approve nothing" rather than "no limit configured"
    // — a silent and very different policy — so translate them explicitly.
    for (const f of numericFields) {
      if (body[f] === undefined) continue;
      const raw = body[f];
      if (raw === null || raw === "") {
        values[f] = null;
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        res.status(400).json({ error: `${f} must be a number or null` });
        return;
      }
      values[f] = n;
    }
    for (const f of boolFields) {
      if (body[f] !== undefined) values[f] = Boolean(body[f]);
    }

    // Check for existing row
    const [existing] = await db
      .select({ id: falkonPoliciesTable.id })
      .from(falkonPoliciesTable)
      .where(
        propertyId
          ? eq(falkonPoliciesTable.propertyId, propertyId)
          : isNull(falkonPoliciesTable.propertyId),
      )
      .limit(1);

    if (existing) {
      await db
        .update(falkonPoliciesTable)
        .set(values as any)
        .where(eq(falkonPoliciesTable.id, existing.id));
    } else {
      await db.insert(falkonPoliciesTable).values(values as any);
    }

    const updated = await db
      .select()
      .from(falkonPoliciesTable)
      .where(
        propertyId
          ? eq(falkonPoliciesTable.propertyId, propertyId)
          : isNull(falkonPoliciesTable.propertyId),
      )
      .limit(1);

    res.json({ ok: true, policy: updated[0] });
  } catch (err) {
    logger.error({ err }, "PUT /falkon/policies failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/units/:propertyId
// ---------------------------------------------------------------------------
router.get("/falkon/units/:propertyId", async (req, res) => {
  try {
    const { propertyId } = req.params;
    const units = await db
      .select()
      .from(falkonUnitsTable)
      .where(eq(falkonUnitsTable.propertyId, propertyId))
      .orderBy(falkonUnitsTable.unitLabel);
    res.json({ units });
  } catch (err) {
    logger.error({ err }, "GET /falkon/units/:propertyId failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/units/bootstrap/:propertyId
// Seeds property_units from distinct unitNo values in jobs for this property.
// Idempotent — skips units that already exist.
// ---------------------------------------------------------------------------
router.post("/falkon/units/bootstrap/:propertyId", async (req, res) => {
  try {
    const { propertyId } = req.params;

    // Distinct non-null unitNos from jobs for this property
    const rows = await db
      .selectDistinct({ unitNo: jobsTable.unitNo })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.propertyId, propertyId),
          sql`${jobsTable.unitNo} IS NOT NULL AND trim(${jobsTable.unitNo}) != ''`,
        ),
      );

    let created = 0;
    let skipped = 0;
    for (const { unitNo } of rows) {
      if (!unitNo) continue;
      const [existing] = await db
        .select({ id: falkonUnitsTable.id })
        .from(falkonUnitsTable)
        .where(
          and(
            eq(falkonUnitsTable.propertyId, propertyId),
            eq(falkonUnitsTable.unitLabel, unitNo),
          ),
        )
        .limit(1);

      if (existing) { skipped++; continue; }
      await db.insert(falkonUnitsTable).values({ propertyId, unitLabel: unitNo });
      created++;
    }

    res.json({ ok: true, created, skipped, total: rows.length });
  } catch (err) {
    logger.error({ err }, "POST /falkon/units/bootstrap/:propertyId failed");
    res.status(500).json({ error: "Internal error" });
  }
});

// ===========================================================================
// PUBLIC routes — listed in officeAuth PUBLIC_PREFIXES (/falkon/inbound, /falkon/ping)
// ===========================================================================

// ---------------------------------------------------------------------------
// POST /falkon/ping — echo endpoint for webhook verification round-trip
// ---------------------------------------------------------------------------
router.post("/falkon/ping", async (req, res) => {
  // Falkon calls this as part of Connect & Verify; we accept and respond 200.
  res.json({ ok: true, pong: true, ts: Date.now() });
});

// ---------------------------------------------------------------------------
// POST /falkon/inbound/:eventType
// Receives signed Falkon → HALO events.
// Verification: Ed25519 only (fail closed, no HMAC fallback).
// ---------------------------------------------------------------------------
router.post("/falkon/inbound/:eventType", async (req, res) => {
  try {
    const { eventType } = req.params;
    const conn = await getConnection();

    if (!conn || conn.mode === "OFF") {
      return res.status(503).json({ error: "Falkon integration is not active" });
    }

    const rawBody: string = (req as any).rawBody ?? JSON.stringify(req.body ?? {});

    // ── Header extraction (canonical X-Falkon-* or legacy HALO-*) ──────────
    const xTimestamp = req.headers["x-falkon-timestamp"] as string | undefined;
    const xNonce     = req.headers["x-falkon-nonce"]     as string | undefined;
    const xSig       = req.headers["x-falkon-signature"] as string | undefined;
    const xClientId  = req.headers["x-falkon-client-id"] as string | undefined;
    // Legacy header fallbacks (transition period only)
    const legacyTs   = req.headers["halo-timestamp"] as string | undefined;
    const legacySig  = req.headers["halo-signature"]  as string | undefined;

    const effectiveTs  = xTimestamp ?? legacyTs;
    const effectiveSig = xSig ?? legacySig;

    if (!effectiveTs || !effectiveSig) {
      return res.status(401).json({ error: "Missing signature headers" });
    }

    // ── Timestamp freshness ──────────────────────────────────────────────────
    const tsRaw = Number(effectiveTs);
    if (isNaN(tsRaw)) return res.status(400).json({ error: "Invalid timestamp" });
    const tsMs = tsRaw < 1_000_000_000_000 ? tsRaw * 1_000 : tsRaw;
    if (Math.abs(Date.now() - tsMs) > 5 * 60_000) {
      return res.status(400).json({ error: "Timestamp outside ±5-minute window" });
    }

    // ── Signature verification: Ed25519 only (fail closed, no HMAC fallback) ─
    let sigValid = false;

    if (xSig) {
      try {
        const remoteKeyRow = await db.execute(
          sql`SELECT public_key_pem FROM falkon_remote_identity ORDER BY fetched_at DESC LIMIT 1`,
        );
        const remoteKey = (
          (remoteKeyRow as any).rows?.[0] ??
          (Array.isArray(remoteKeyRow) ? remoteKeyRow[0] : undefined)
        )?.public_key_pem as string | undefined;

        if (!remoteKey) {
          logger.warn({ eventType }, "falkon inbound: no remote Ed25519 key — rejected");
          return res.status(401).json({ error: "Falkon identity is not bound" });
        }
        const { createHash, verify: edVerify } = await import("node:crypto");
        const bodyHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
        const sigStr = `${xClientId ?? ""}\n${String(tsMs)}\n${xNonce ?? ""}\n${bodyHash}`;
        const padded = xSig.replace(/-/g, "+").replace(/_/g, "/");
        const mod4 = padded.length % 4;
        const sigBuf = Buffer.from(mod4 ? padded + "=".repeat(4 - mod4) : padded, "base64");
        sigValid = edVerify(null, Buffer.from(sigStr, "utf8"), remoteKey, sigBuf);
      } catch {
        return res.status(500).json({ error: "Signature verification error" });
      }
    }

    if (!sigValid) {
      logger.warn({ eventType }, "falkon: inbound signature failed");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // ── Deduplicate by Falkon-assigned event ID or nonce ─────────────────────
    const falkonEventId = xNonce ?? req.body?.eventId ?? req.body?.id ?? null;
    if (falkonEventId) {
      const [dup] = await db
        .select({ id: falkonInboundEventsTable.id })
        .from(falkonInboundEventsTable)
        .where(eq(falkonInboundEventsTable.falkonEventId, String(falkonEventId)))
        .limit(1);
      if (dup) return res.json({ ok: true, duplicate: true });
    }

    // ── Store the inbound event ────────────────────────────────────────────
    await db.insert(falkonInboundEventsTable).values({
      falkonEventId: falkonEventId ? String(falkonEventId) : undefined,
      eventType,
      payload: req.body ?? {},
      status: "processed",
      processedAt: new Date(),
    });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /falkon/inbound/:eventType failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/jobs/:id/evidence — evidence bundle (Falkon reads, key-gated)
// ---------------------------------------------------------------------------
router.get("/falkon/jobs/:id/evidence", async (req, res) => {
  try {
    const conn = await getConnection();
    if (!conn || !conn.apiKeyHash) {
      return res.status(503).json({ error: "Falkon integration is not connected" });
    }

    // Verify the Falkon partner key from Authorization header
    const authHeader = req.headers.authorization ?? "";
    const raw = authHeader.replace(/^Bearer\s+/i, "");
    if (!raw || hashKey(raw) !== conn.apiKeyHash) {
      return res.status(401).json({ error: "Invalid Falkon partner key" });
    }

    const { id: jobId } = req.params;
    const [job] = await db
      .select({
        id: jobsTable.id,
        jobNo: jobsTable.jobNo,
        propertyId: jobsTable.propertyId,
        unitNo: jobsTable.unitNo,
        status: jobsTable.status,
        boardStatus: jobsTable.boardStatus,
        crewLeaderId: jobsTable.crewLeaderId,
        scheduledOn: jobsTable.scheduledOn,
        completedAt: jobsTable.completedAt,
        marginPct: jobsTable.marginPct,
        grossProfit: jobsTable.grossProfit,
      })
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .limit(1);

    if (!job) return res.status(404).json({ error: "Job not found" });

    // Photos
    const photos = await db
      .select({
        id: crewPhotosTable.id,
        phase: crewPhotosTable.phase,
        storagePath: crewPhotosTable.storagePath,
        note: crewPhotosTable.note,
        createdAt: crewPhotosTable.createdAt,
      })
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.jobId, jobId));

    // Checklists
    const checklists = await db
      .select({
        type: jobChecklistsTable.checklistType,
        checkedItems: jobChecklistsTable.checkedItems,
        signedOffAt: jobChecklistsTable.signedOffAt,
        signedOffBy: jobChecklistsTable.signedOffBy,
      })
      .from(jobChecklistsTable)
      .where(eq(jobChecklistsTable.jobId, jobId));

    const cleaningChecklist = await db
      .select({
        checkedItems: cleaningChecklistsTable.checkedItems,
        signedOffAt: cleaningChecklistsTable.signedOffAt,
        signedOffBy: cleaningChecklistsTable.signedOffBy,
      })
      .from(cleaningChecklistsTable)
      .where(eq(cleaningChecklistsTable.jobId, jobId))
      .limit(1);

    // GPS check-ins (kind = "checkin" | "checkout", coords in lat/lng)
    const checkins = await db
      .select({
        id: crewCheckinsTable.id,
        crewId: crewCheckinsTable.crewId,
        kind: crewCheckinsTable.kind,
        lat: crewCheckinsTable.lat,
        lng: crewCheckinsTable.lng,
        accuracy: crewCheckinsTable.accuracy,
        label: crewCheckinsTable.label,
        note: crewCheckinsTable.note,
        createdAt: crewCheckinsTable.createdAt,
      })
      .from(crewCheckinsTable)
      .where(eq(crewCheckinsTable.jobId, jobId));

    // Walk-approved activity
    const [walkApproved] = await db
      .select({ createdAt: activitiesTable.createdAt, body: activitiesTable.body })
      .from(activitiesTable)
      .where(
        and(
          eq(activitiesTable.entityType, "job"),
          eq(activitiesTable.entityId, jobId),
          sql`${activitiesTable.kind} IN ('walk_approved', 'note')`,
          sql`${activitiesTable.body} ILIKE '%walk%approv%'`,
        ),
      )
      .orderBy(desc(activitiesTable.createdAt))
      .limit(1);

    return res.json({
      job,
      evidence: {
        photos,
        checklists: [
          ...checklists,
          ...(cleaningChecklist[0]
            ? [{ type: "cleaning", ...cleaningChecklist[0] }]
            : []),
        ],
        checkins,
        walkApprovedAt: walkApproved?.createdAt ?? null,
      },
    });
  } catch (err) {
    logger.error({ err }, "GET /falkon/jobs/:id/evidence failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
