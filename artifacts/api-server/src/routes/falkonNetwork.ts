/**
 * Falkon Network — Phase 1 cross-business network routes.
 *
 * PUBLIC (in PUBLIC_PREFIXES — no passcode):
 *   GET  /falkon/network/capabilities   — HALO's published Phase-1 capability catalog
 *
 * OFFICE-SIDE (no gate — HALO has no passcode; see lib/publicPaths.ts):
 *   GET  /falkon/network/identity       — HALO's network business identity
 *   GET  /falkon/network/health         — real-time network health
 *
 *   GET  /falkon/network/peers          — known Falkon peers with health state
 *   POST /falkon/network/peers          — register a new peer (upsert by domain)
 *   DELETE /falkon/network/peers/:id    — remove a peer
 *   POST /falkon/network/peers/:id/refresh — force health check for one peer
 *
 *   GET  /falkon/network/requests       — all cross-business requests
 *   GET  /falkon/network/requests/:id   — request detail + event history
 *   POST /falkon/network/requests/outbound  — create & queue outbound request
 *   POST /falkon/network/requests/:id/approve  — approve inbound request
 *   POST /falkon/network/requests/:id/reject   — reject inbound request
 *   POST /falkon/network/requests/:id/cancel   — cancel before fulfillment
 *   POST /falkon/network/requests/:id/retry    — retry failed delivery (idempotent)
 *
 *   GET  /falkon/network/phases         — Phase 1–6 with activation state + manifests
 *   POST /falkon/network/phases/:phase/activate  — activate a phase (readiness-gated)
 *   POST /falkon/network/phases/:phase/rollback  — roll back to previous phase
 *
 *   GET  /falkon/network/audit          — append-only audit log (paginated)
 */

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import {
  falkonConnectionsTable,
  businessSettingsTable,
} from "@workspace/db/schema";
import { sql } from "drizzle-orm";
import { getPublicKeyPem } from "../lib/falkonIdentity";
import { gatewayHealth } from "../lib/falkonGateway";
import { CLIENT_ID, GATEWAY_ORIGIN } from "../lib/falkonGateway";
import { PHASE_MANIFESTS, PHASE1_CAPABILITIES } from "../lib/falkonPhaseManifests";
import { writeAuditLog } from "../lib/falkonNetworkPoller";
import { logger } from "../lib/logger";

export const falkonNetworkRouter = Router();

const BASE_URL = process.env.REPLIT_DOMAINS
  ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]!.trim()}`
  : "https://archangel-halo.replit.app";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getSettings() {
  const [s] = await db.select().from(businessSettingsTable).limit(1);
  return s ?? null;
}

async function getConnection() {
  const [c] = await db.select().from(falkonConnectionsTable).limit(1);
  return c ?? null;
}

function rowsOf(result: unknown): unknown[] {
  const r = result as any;
  const rows = r?.rows ?? r;
  return Array.isArray(rows) ? rows : [];
}

function firstRow(result: unknown): Record<string, unknown> | null {
  const rows = rowsOf(result);
  return (rows[0] as Record<string, unknown>) ?? null;
}

/** Returns current enabled phase (highest enabled phase number). */
async function getCurrentPhase(): Promise<number> {
  const row = await db.execute(
    sql`SELECT MAX(phase) AS max_phase FROM falkon_phase_gates WHERE enabled = true`,
  );
  return Number(firstRow(row)?.max_phase ?? 1);
}

// ---------------------------------------------------------------------------
// Phase readiness checks (used by activate endpoint)
// ---------------------------------------------------------------------------

async function checkPhaseReadiness(phase: number): Promise<{
  ready: boolean;
  checks: { id: string; label: string; pass: boolean; detail: string }[];
}> {
  const checks: { id: string; label: string; pass: boolean; detail: string }[] = [];
  const conn = await getConnection();

  if (phase === 1) {
    checks.push({
      id: "identity",
      label: "Ed25519 Signing Identity",
      pass: !!getPublicKeyPem(),
      detail: getPublicKeyPem() ? "Identity active" : "Restart server to generate identity",
    });
    const peerCount = firstRow(
      await db.execute(sql`SELECT COUNT(*) AS cnt FROM falkon_peers`),
    );
    checks.push({
      id: "peers",
      label: "Peer Registered",
      pass: Number(peerCount?.cnt ?? 0) > 0,
      detail: Number(peerCount?.cnt ?? 0) > 0 ? "At least one peer registered" : "No peers registered",
    });
  } else if (phase === 2) {
    const prevEnabled = firstRow(
      await db.execute(sql`SELECT enabled FROM falkon_phase_gates WHERE phase = 1`),
    );
    checks.push({
      id: "phase1",
      label: "Phase 1 Active",
      pass: !!prevEnabled?.enabled,
      detail: prevEnabled?.enabled ? "Phase 1 active" : "Activate Phase 1 first",
    });
    const fulfilled = firstRow(
      await db.execute(
        sql`SELECT COUNT(*) AS cnt FROM falkon_cross_requests WHERE approval_state = 'fulfilled'`,
      ),
    );
    checks.push({
      id: "fulfilled_requests",
      label: "At Least 1 Request Fulfilled",
      pass: Number(fulfilled?.cnt ?? 0) >= 1,
      detail: `${fulfilled?.cnt ?? 0} fulfilled cross-business request(s)`,
    });
    checks.push({
      id: "mode",
      label: "Gateway ASSISTED Mode or Higher",
      pass: conn?.mode === "ASSISTED" || conn?.mode === "LIVE",
      detail: conn?.mode
        ? `Current mode: ${conn.mode}`
        : "No gateway connection configured",
    });
  } else if (phase === 3) {
    const prevEnabled = firstRow(
      await db.execute(sql`SELECT enabled FROM falkon_phase_gates WHERE phase = 2`),
    );
    checks.push({
      id: "phase2",
      label: "Phase 2 Active",
      pass: !!prevEnabled?.enabled,
      detail: prevEnabled?.enabled ? "Phase 2 active" : "Activate Phase 2 first",
    });
    checks.push({
      id: "mode",
      label: "Gateway LIVE Mode",
      pass: conn?.mode === "LIVE",
      detail: conn?.mode === "LIVE" ? "LIVE mode active" : `Current mode: ${conn?.mode ?? "none"}`,
    });
    const fulfilled = firstRow(
      await db.execute(
        sql`SELECT COUNT(*) AS cnt FROM falkon_cross_requests WHERE approval_state = 'fulfilled'`,
      ),
    );
    checks.push({
      id: "fulfilled_requests",
      label: "At Least 5 Requests Fulfilled",
      pass: Number(fulfilled?.cnt ?? 0) >= 5,
      detail: `${fulfilled?.cnt ?? 0} fulfilled cross-business request(s)`,
    });
  } else {
    // Phases 4-6: require previous phase active
    const prevPhase = phase - 1;
    const prevEnabled = firstRow(
      await db.execute(
        sql`SELECT enabled FROM falkon_phase_gates WHERE phase = ${prevPhase}`,
      ),
    );
    checks.push({
      id: `phase${prevPhase}`,
      label: `Phase ${prevPhase} Active`,
      pass: !!prevEnabled?.enabled,
      detail: prevEnabled?.enabled
        ? `Phase ${prevPhase} active`
        : `Activate Phase ${prevPhase} first`,
    });
    checks.push({
      id: "manual_review",
      label: "Manual Review Required",
      pass: false,
      detail: `Phase ${phase} requires a manual review and agreement. Contact the Falkon Network team.`,
    });
  }

  return {
    ready: checks.every((c) => c.pass),
    checks,
  };
}

// ===========================================================================
// PUBLIC — GET /falkon/network/capabilities
// No passcode required — external peers need to discover HALO's capabilities
// ===========================================================================

falkonNetworkRouter.get("/falkon/network/capabilities", async (_req, res) => {
  try {
    const currentPhase = await getCurrentPhase();
    return res.json({
      partnerId: "archangel-halo",
      clientId: CLIENT_ID,
      trustDocUrl: `${BASE_URL}/.well-known/falkon-trust.json`,
      phase: currentPhase,
      capabilities: PHASE1_CAPABILITIES.map((cap) => ({
        ...cap,
        approvalRequired: true,
        phase: 1,
        provider: "Archangel Ventures LLC",
      })),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/capabilities failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ===========================================================================
// OFFICE-SIDE — all routes below are the operator's own surface (no passcode)
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /falkon/network/identity
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/identity", async (_req, res) => {
  try {
    const [settings, conn] = await Promise.all([getSettings(), getConnection()]);
    const currentPhase = await getCurrentPhase();

    const peers = rowsOf(
      await db.execute(
        sql`SELECT id, name, domain, health_state, last_health_check_at FROM falkon_peers ORDER BY created_at ASC`,
      ),
    );

    return res.json({
      businessName: settings?.companyName ?? "Archangel Ventures LLC",
      partnerId: "archangel-halo",
      clientId: CLIENT_ID,
      trustDocUrl: `${BASE_URL}/.well-known/falkon-trust.json`,
      webhookUrl: `${BASE_URL}/api/falkon/webhook`,
      gatewayUrl: GATEWAY_ORIGIN,
      publicKeyFingerprint: (() => {
        const pem = getPublicKeyPem();
        if (!pem) return null;
        const clean = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
        return clean.slice(0, 16) + "…" + clean.slice(-16);
      })(),
      identityActive: !!getPublicKeyPem(),
      currentPhase,
      gatewayMode: conn?.mode ?? "OFF",
      gatewayStatus: conn?.status ?? "disconnected",
      verifiedAt: conn?.verifiedAt ?? null,
      capabilities: PHASE1_CAPABILITIES,
      peers: peers.map((p: any) => ({
        id: p.id,
        name: p.name,
        domain: p.domain,
        healthState: p.health_state,
        lastCheckedAt: p.last_health_check_at,
      })),
    });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/identity failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/network/health
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/health", async (_req, res) => {
  try {
    const [conn, currentPhase] = await Promise.all([
      getConnection(),
      getCurrentPhase(),
    ]);

    // Check gateway health (timeout-guarded)
    const gwHealth = await gatewayHealth().catch(() => ({ ok: false, status: "unreachable" }));

    // Get all peer health states
    const peers = rowsOf(
      await db.execute(
        sql`SELECT id, name, domain, health_state, last_health_check_at FROM falkon_peers ORDER BY created_at ASC`,
      ),
    );

    // Count pending inbound requests
    const pendingRow = firstRow(
      await db.execute(
        sql`SELECT COUNT(*) AS cnt FROM falkon_cross_requests
            WHERE direction = 'inbound' AND approval_state = 'awaiting_approval'`,
      ),
    );

    // Last audit entry
    const lastAudit = firstRow(
      await db.execute(
        sql`SELECT created_at FROM falkon_audit_log ORDER BY created_at DESC LIMIT 1`,
      ),
    );

    const connectedPeers = peers.filter((p: any) => p.health_state === "connected");
    const overallHealth = (() => {
      if (peers.length === 0) return "no_peers";
      if (connectedPeers.length === peers.length) return "healthy";
      if (connectedPeers.length === 0) return "degraded";
      return "partial";
    })();

    return res.json({
      identityActive: !!getPublicKeyPem(),
      gatewayConnected: gwHealth.ok,
      gatewayMode: conn?.mode ?? "OFF",
      currentPhase,
      overallHealth,
      peers: peers.map((p: any) => ({
        id: p.id,
        name: p.name,
        domain: p.domain,
        healthState: p.health_state,
        lastCheckedAt: p.last_health_check_at,
      })),
      pendingInboundRequests: Number(pendingRow?.cnt ?? 0),
      lastAuditAt: lastAudit?.created_at ?? null,
    });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/health failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/network/peers
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/peers", async (_req, res) => {
  try {
    const peers = rowsOf(
      await db.execute(
        sql`SELECT id, name, domain, trust_doc_url, capabilities_url,
                   health_state, last_health_check_at, capabilities_data,
                   trust_doc_data, notes, created_at, updated_at
            FROM falkon_peers ORDER BY created_at ASC`,
      ),
    );
    return res.json({ peers });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/peers failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/peers — upsert by domain
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/peers", async (req, res) => {
  try {
    const { name, domain, trustDocUrl, capabilitiesUrl, notes } = req.body ?? {};
    if (!name || !domain) {
      return res.status(400).json({ error: "name and domain are required" });
    }

    const cleanDomain = String(domain).replace(/^https?:\/\//, "").split("/")[0]!.trim();
    const defaultTrustDocUrl = trustDocUrl ?? `https://${cleanDomain}/.well-known/falkon-trust.json`;
    const defaultCapUrl = capabilitiesUrl ?? `https://${cleanDomain}/api/falkon/network/capabilities`;

    await db.execute(
      sql`INSERT INTO falkon_peers
            (id, name, domain, trust_doc_url, capabilities_url, health_state, notes, created_at, updated_at)
          VALUES
            (gen_random_uuid(), ${name}, ${cleanDomain}, ${defaultTrustDocUrl},
             ${defaultCapUrl}, 'pending_peer', ${notes ?? null}, now(), now())
          ON CONFLICT (domain) DO UPDATE
          SET name = EXCLUDED.name,
              trust_doc_url = EXCLUDED.trust_doc_url,
              capabilities_url = EXCLUDED.capabilities_url,
              notes = EXCLUDED.notes,
              updated_at = now()`,
    );

    await writeAuditLog({
      eventType: "peer.registered",
      actor: "office",
      entityType: "peer",
      summary: `Peer registered: ${name} (${cleanDomain})`,
      payload: { domain: cleanDomain },
    });

    const peer = firstRow(
      await db.execute(sql`SELECT * FROM falkon_peers WHERE domain = ${cleanDomain}`),
    );

    return res.status(201).json({ ok: true, peer });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/peers failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /falkon/network/peers/:id
// ---------------------------------------------------------------------------
falkonNetworkRouter.delete("/falkon/network/peers/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const peer = firstRow(
      await db.execute(sql`SELECT name, domain FROM falkon_peers WHERE id = ${id}::uuid`),
    );
    if (!peer) return res.status(404).json({ error: "Peer not found" });

    await db.execute(sql`DELETE FROM falkon_peers WHERE id = ${id}::uuid`);
    await writeAuditLog({
      eventType: "peer.removed",
      actor: "office",
      entityType: "peer",
      entityId: id,
      summary: `Peer removed: ${peer.name} (${peer.domain})`,
    });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "DELETE /falkon/network/peers/:id failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/peers/:id/refresh — force health re-check
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/peers/:id/refresh", async (req, res) => {
  try {
    const { id } = req.params;
    const peer = firstRow(
      await db.execute(
        sql`SELECT id, name, domain, trust_doc_url, capabilities_url, health_state
            FROM falkon_peers WHERE id = ${id}::uuid`,
      ),
    ) as any;
    if (!peer) return res.status(404).json({ error: "Peer not found" });

    // Run health check inline (same logic as poller, small enough to inline here)
    let newState: string;
    let trustDocData: unknown = null;
    try {
      const r = await fetch(peer.trust_doc_url, {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: "application/json" },
      });
      if (r.ok) {
        trustDocData = await r.json().catch(() => null);
        newState = "connected";
      } else {
        newState = "degraded";
      }
    } catch {
      newState = "disconnected";
    }

    await db.execute(
      sql`UPDATE falkon_peers
          SET health_state = ${newState},
              last_health_check_at = now(),
              trust_doc_data = ${trustDocData ? JSON.stringify(trustDocData) : null}::jsonb,
              updated_at = now()
          WHERE id = ${id}::uuid`,
    );

    if (newState !== peer.health_state) {
      await writeAuditLog({
        eventType: "peer.health_changed",
        actor: "office",
        entityType: "peer",
        entityId: id,
        summary: `${peer.name} health: ${peer.health_state} → ${newState} (manual refresh)`,
        payload: { from: peer.health_state, to: newState },
      });
    }

    const updated = firstRow(
      await db.execute(sql`SELECT * FROM falkon_peers WHERE id = ${id}::uuid`),
    );
    return res.json({ ok: true, peer: updated, newState });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/peers/:id/refresh failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ===========================================================================
// Cross-Business Requests
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /falkon/network/requests
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/requests", async (req, res) => {
  try {
    const { direction, state, limit: lim } = req.query as Record<string, string | undefined>;
    const limit = Math.min(Number(lim ?? "50") || 50, 200);

    const rows = rowsOf(
      await db.execute(
        sql`SELECT cr.id, cr.direction, cr.peer_id, cr.peer_name, cr.capability_id,
                   cr.capability_name, cr.correlation_id, cr.external_ref,
                   cr.approval_state, cr.summary, cr.attempts, cr.last_attempt_at,
                   cr.last_error, cr.created_at, cr.updated_at,
                   p.health_state AS peer_health
            FROM falkon_cross_requests cr
            LEFT JOIN falkon_peers p ON p.id = cr.peer_id
            WHERE (${direction ?? null} IS NULL OR cr.direction = ${direction ?? null})
              AND (${state ?? null} IS NULL OR cr.approval_state = ${state ?? null})
            ORDER BY cr.created_at DESC
            LIMIT ${limit}`,
      ),
    );

    return res.json({ requests: rows });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/requests failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// GET /falkon/network/requests/:id — full detail including event history
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const row = firstRow(
      await db.execute(
        sql`SELECT cr.*, p.name AS peer_name_live, p.domain AS peer_domain, p.health_state AS peer_health
            FROM falkon_cross_requests cr
            LEFT JOIN falkon_peers p ON p.id = cr.peer_id
            WHERE cr.id = ${id}::uuid`,
      ),
    );
    if (!row) return res.status(404).json({ error: "Request not found" });
    return res.json(row);
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/requests/:id failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/requests/outbound — create and queue outbound request
// Body: { peerId, capabilityId, summary, sharedData }
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/requests/outbound", async (req, res) => {
  try {
    const { peerId, capabilityId, summary, sharedData } = req.body ?? {};
    if (!peerId || !capabilityId || !summary) {
      return res.status(400).json({ error: "peerId, capabilityId, and summary are required" });
    }

    // Validate peer exists
    const peer = firstRow(
      await db.execute(sql`SELECT id, name, domain, health_state FROM falkon_peers WHERE id = ${peerId}::uuid`),
    ) as any;
    if (!peer) return res.status(404).json({ error: "Peer not found" });

    // Find capability
    const capability = PHASE1_CAPABILITIES.find((c) => c.id === capabilityId);
    if (!capability) {
      return res.status(400).json({ error: `Unknown capabilityId: ${capabilityId}` });
    }

    // Build requester identity from HALO's trust doc
    const settings = await getSettings();
    const requesterIdentity = {
      partnerId: "archangel-halo",
      clientId: CLIENT_ID,
      businessName: settings?.companyName ?? "Archangel Ventures LLC",
      trustDocUrl: `${BASE_URL}/.well-known/falkon-trust.json`,
    };

    // Generate correlation ID (idempotency key)
    const correlationId = randomUUID();
    const requestId = randomUUID();

    const initEvent = JSON.stringify([{
      ts: Date.now(),
      event: "created",
      detail: "Outbound request created and queued for delivery",
    }]);

    await db.execute(
      sql`INSERT INTO falkon_cross_requests
            (id, direction, peer_id, peer_name, capability_id, capability_name,
             correlation_id, approval_state, summary, shared_data_snapshot,
             requester_identity, provider_identity, attempts, request_events,
             created_at, updated_at)
          VALUES
            (${requestId}::uuid, 'outbound', ${peerId}::uuid, ${peer.name},
             ${capabilityId}, ${capability.name},
             ${correlationId}, 'pending_delivery', ${String(summary)},
             ${sharedData ? JSON.stringify(sharedData) : null}::jsonb,
             ${JSON.stringify(requesterIdentity)}::jsonb,
             ${JSON.stringify({ domain: peer.domain, businessName: peer.name })}::jsonb,
             0, ${initEvent}::jsonb,
             now(), now())`,
    );

    await writeAuditLog({
      eventType: "request.created",
      actor: "office",
      entityType: "cross_request",
      entityId: requestId,
      summary: `Outbound ${capabilityId} request queued for ${peer.name}`,
      payload: { correlationId, capabilityId, peer: peer.domain },
    });

    const created = firstRow(
      await db.execute(sql`SELECT * FROM falkon_cross_requests WHERE id = ${requestId}::uuid`),
    );
    return res.status(201).json({ ok: true, request: created });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/requests/outbound failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/requests/:id/approve — approve inbound request
// Binding to the stored payload snapshot (prevents bait-and-switch)
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/requests/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const row = firstRow(
      await db.execute(
        sql`SELECT id, direction, approval_state, shared_data_snapshot, peer_name, capability_id
            FROM falkon_cross_requests WHERE id = ${id}::uuid`,
      ),
    ) as any;

    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.direction !== "inbound") {
      return res.status(400).json({ error: "Only inbound requests can be approved here" });
    }
    if (row.approval_state !== "awaiting_approval") {
      return res.status(409).json({
        error: `Cannot approve: request is in state '${row.approval_state}'`,
        currentState: row.approval_state,
      });
    }

    const event = JSON.stringify([{
      ts: Date.now(),
      event: "approved",
      detail: "Approved by office operator",
    }]);

    await db.execute(
      sql`UPDATE falkon_cross_requests
          SET approval_state = 'approved',
              updated_at = now(),
              request_events = COALESCE(request_events, '[]'::jsonb) || ${event}::jsonb
          WHERE id = ${id}::uuid AND approval_state = 'awaiting_approval'`,
    );

    // Re-check to guard against concurrent approval
    const after = firstRow(
      await db.execute(
        sql`SELECT approval_state FROM falkon_cross_requests WHERE id = ${id}::uuid`,
      ),
    ) as any;
    if (after?.approval_state !== "approved") {
      return res.status(409).json({ error: "Request was already processed by another action" });
    }

    await writeAuditLog({
      eventType: "request.approved",
      actor: "office",
      entityType: "cross_request",
      entityId: id,
      summary: `Inbound ${row.capability_id} request approved (from ${row.peer_name})`,
    });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/requests/:id/approve failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/requests/:id/reject
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/requests/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body ?? {};
    const row = firstRow(
      await db.execute(
        sql`SELECT id, direction, approval_state, peer_name, capability_id
            FROM falkon_cross_requests WHERE id = ${id}::uuid`,
      ),
    ) as any;

    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.direction !== "inbound") {
      return res.status(400).json({ error: "Only inbound requests can be rejected here" });
    }
    if (row.approval_state !== "awaiting_approval") {
      return res.status(409).json({
        error: `Cannot reject: request is in state '${row.approval_state}'`,
      });
    }

    const event = JSON.stringify([{
      ts: Date.now(),
      event: "rejected",
      detail: reason ? `Rejected: ${String(reason).slice(0, 200)}` : "Rejected by office operator",
    }]);

    await db.execute(
      sql`UPDATE falkon_cross_requests
          SET approval_state = 'rejected',
              updated_at = now(),
              request_events = COALESCE(request_events, '[]'::jsonb) || ${event}::jsonb
          WHERE id = ${id}::uuid`,
    );

    await writeAuditLog({
      eventType: "request.rejected",
      actor: "office",
      entityType: "cross_request",
      entityId: id,
      summary: `Inbound ${row.capability_id} request rejected (from ${row.peer_name})`,
      payload: { reason },
    });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/requests/:id/reject failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/requests/:id/cancel
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/requests/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const row = firstRow(
      await db.execute(
        sql`SELECT id, approval_state, peer_name, capability_id
            FROM falkon_cross_requests WHERE id = ${id}::uuid`,
      ),
    ) as any;

    if (!row) return res.status(404).json({ error: "Request not found" });

    const cancellable = ["pending_delivery", "awaiting_approval", "sent"];
    if (!cancellable.includes(row.approval_state)) {
      return res.status(409).json({
        error: `Cannot cancel: request is in state '${row.approval_state}'`,
        cancellableStates: cancellable,
      });
    }

    const event = JSON.stringify([{
      ts: Date.now(),
      event: "cancelled",
      detail: "Cancelled by office operator",
    }]);

    await db.execute(
      sql`UPDATE falkon_cross_requests
          SET approval_state = 'cancelled',
              updated_at = now(),
              request_events = COALESCE(request_events, '[]'::jsonb) || ${event}::jsonb
          WHERE id = ${id}::uuid`,
    );

    await writeAuditLog({
      eventType: "request.cancelled",
      actor: "office",
      entityType: "cross_request",
      entityId: id,
      summary: `Request cancelled: ${row.capability_id} (${row.peer_name})`,
    });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/requests/:id/cancel failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/requests/:id/retry — idempotent retry for failed delivery
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/requests/:id/retry", async (req, res) => {
  try {
    const { id } = req.params;
    const row = firstRow(
      await db.execute(
        sql`SELECT id, direction, approval_state, attempts
            FROM falkon_cross_requests WHERE id = ${id}::uuid`,
      ),
    ) as any;

    if (!row) return res.status(404).json({ error: "Request not found" });
    if (row.direction !== "outbound") {
      return res.status(400).json({ error: "Only outbound requests can be retried" });
    }
    if (row.approval_state !== "delivery_failed") {
      return res.status(409).json({
        error: `Cannot retry: request is in state '${row.approval_state}'`,
      });
    }

    const event = JSON.stringify([{
      ts: Date.now(),
      event: "retry_queued",
      detail: "Manually queued for retry by office operator",
    }]);

    await db.execute(
      sql`UPDATE falkon_cross_requests
          SET approval_state = 'pending_delivery',
              attempts = 0,
              last_error = null,
              next_retry_at = now(),
              updated_at = now(),
              request_events = COALESCE(request_events, '[]'::jsonb) || ${event}::jsonb
          WHERE id = ${id}::uuid`,
    );

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/requests/:id/retry failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ===========================================================================
// Phase Gates
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /falkon/network/phases
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/phases", async (_req, res) => {
  try {
    const gateRows = rowsOf(
      await db.execute(
        sql`SELECT phase, enabled, activated_at, activated_by, rollback_to, readiness_snapshot
            FROM falkon_phase_gates ORDER BY phase ASC`,
      ),
    );

    const gatesByPhase = new Map(gateRows.map((r: any) => [r.phase, r]));

    const phases = await Promise.all(
      PHASE_MANIFESTS.map(async (manifest) => {
        const gate = gatesByPhase.get(manifest.phase) as any;
        const { checks } = await checkPhaseReadiness(manifest.phase);
        return {
          ...manifest,
          enabled: gate?.enabled ?? false,
          activatedAt: gate?.activated_at ?? null,
          activatedBy: gate?.activated_by ?? null,
          rollbackTo: gate?.rollback_to ?? null,
          readinessChecks: checks,
          ready: checks.every((c) => c.pass),
        };
      }),
    );

    return res.json({ phases });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/phases failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/phases/:phase/activate
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/phases/:phase/activate", async (req, res) => {
  try {
    const phase = parseInt(req.params.phase ?? "", 10);
    if (isNaN(phase) || phase < 1 || phase > 6) {
      return res.status(400).json({ error: "Phase must be 1–6" });
    }

    // Check if already enabled
    const existing = firstRow(
      await db.execute(sql`SELECT enabled FROM falkon_phase_gates WHERE phase = ${phase}`),
    ) as any;
    if (existing?.enabled) {
      return res.status(409).json({ error: `Phase ${phase} is already active` });
    }

    // Run readiness checks
    const { ready, checks } = await checkPhaseReadiness(phase);
    if (!ready) {
      return res.status(400).json({
        error: `Phase ${phase} prerequisites not met`,
        missing: checks.filter((c) => !c.pass).map((c) => c.label),
        checks,
      });
    }

    // Current phase (for rollback reference)
    const currentPhase = await getCurrentPhase();

    const readinessSnapshot = JSON.stringify(checks);

    await db.execute(
      sql`INSERT INTO falkon_phase_gates
            (id, phase, enabled, activated_at, activated_by, rollback_to, readiness_snapshot, created_at, updated_at)
          VALUES
            (gen_random_uuid(), ${phase}, true, now(), 'office', ${currentPhase}, ${readinessSnapshot}::jsonb, now(), now())
          ON CONFLICT (phase) DO UPDATE
          SET enabled = true,
              activated_at = now(),
              activated_by = 'office',
              rollback_to = ${currentPhase},
              readiness_snapshot = ${readinessSnapshot}::jsonb,
              updated_at = now()`,
    );

    await writeAuditLog({
      eventType: "phase.activated",
      actor: "office",
      entityType: "phase_gate",
      entityId: String(phase),
      summary: `Phase ${phase} (${PHASE_MANIFESTS[phase - 1]?.name ?? ""}) activated`,
      payload: { phase, previousPhase: currentPhase, checks },
    });

    logger.info({ phase }, "falkon network: phase activated");
    return res.json({
      ok: true,
      phase,
      name: PHASE_MANIFESTS[phase - 1]?.name,
      activatedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/phases/:phase/activate failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ---------------------------------------------------------------------------
// POST /falkon/network/phases/:phase/rollback — kill switch
// ---------------------------------------------------------------------------
falkonNetworkRouter.post("/falkon/network/phases/:phase/rollback", async (req, res) => {
  try {
    const phase = parseInt(req.params.phase ?? "", 10);
    if (isNaN(phase) || phase < 2 || phase > 6) {
      return res.status(400).json({ error: "Phase must be 2–6 (Phase 1 cannot be rolled back)" });
    }

    const gate = firstRow(
      await db.execute(sql`SELECT enabled, rollback_to FROM falkon_phase_gates WHERE phase = ${phase}`),
    ) as any;
    if (!gate?.enabled) {
      return res.status(409).json({ error: `Phase ${phase} is not currently active` });
    }

    await db.execute(
      sql`UPDATE falkon_phase_gates
          SET enabled = false, updated_at = now()
          WHERE phase = ${phase}`,
    );

    await writeAuditLog({
      eventType: "phase.rolled_back",
      actor: "office",
      entityType: "phase_gate",
      entityId: String(phase),
      summary: `Phase ${phase} (${PHASE_MANIFESTS[phase - 1]?.name ?? ""}) rolled back to Phase ${gate.rollback_to ?? phase - 1}`,
      payload: { phase, rolledBackTo: gate.rollback_to },
    });

    logger.info({ phase, rolledBackTo: gate.rollback_to }, "falkon network: phase rolled back");
    return res.json({
      ok: true,
      phase,
      rolledBackTo: gate.rollback_to ?? phase - 1,
    });
  } catch (err) {
    logger.error({ err }, "POST /falkon/network/phases/:phase/rollback failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ===========================================================================
// Audit Log
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /falkon/network/audit?limit=50&offset=0
// ---------------------------------------------------------------------------
falkonNetworkRouter.get("/falkon/network/audit", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? "50") || 50, 200);
    const offset = Number(req.query.offset ?? "0") || 0;

    const rows = rowsOf(
      await db.execute(
        sql`SELECT id, event_type, actor, entity_type, entity_id, summary, payload, created_at
            FROM falkon_audit_log
            ORDER BY created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
      ),
    );

    const total = firstRow(
      await db.execute(sql`SELECT COUNT(*) AS cnt FROM falkon_audit_log`),
    );

    return res.json({
      audit: rows,
      total: Number(total?.cnt ?? 0),
      limit,
      offset,
    });
  } catch (err) {
    logger.error({ err }, "GET /falkon/network/audit failed");
    return res.status(500).json({ error: "Internal error" });
  }
});
