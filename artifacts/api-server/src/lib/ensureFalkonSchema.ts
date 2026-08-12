/**
 * Falkon Ops — Phase 1 schema bootstrap.
 *
 * Run at server startup via `ensureFalkonSchema()`. Uses
 * `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS`
 * so it is idempotent and safe on every restart.
 *
 * drizzle-kit push requires TTY — this avoids that requirement entirely.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// ---------------------------------------------------------------------------
// Statement list
// ---------------------------------------------------------------------------

const STATEMENTS: string[] = [
  // ── HALO's own Ed25519 signing identity ───────────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_identity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id text NOT NULL,
    client_id text NOT NULL,
    private_key_enc text NOT NULL,
    public_key_pem text NOT NULL,
    algorithm text NOT NULL DEFAULT 'Ed25519',
    issued_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Falkon's published Ed25519 public key (cached, refreshed periodically) ──
  `CREATE TABLE IF NOT EXISTS falkon_remote_identity (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id text NOT NULL,
    public_key_pem text NOT NULL,
    algorithm text NOT NULL DEFAULT 'Ed25519',
    fetched_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz,
    trust_doc_url text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Replay-prevention nonces for inbound webhook ──────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_webhook_nonces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    jti text UNIQUE NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS falkon_webhook_nonces_expires_idx
   ON falkon_webhook_nonces (expires_at)`,

  // ── Durable make-ready execution tracking ────────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_executions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id uuid NOT NULL,
    unit_id uuid,
    unit_label text NOT NULL,
    job_id uuid,
    falkon_execution_id text,
    phase text NOT NULL DEFAULT 'needs_turn',
    status text NOT NULL DEFAULT 'active',
    gates_snapshot jsonb NOT NULL DEFAULT '{}',
    policy_snapshot jsonb NOT NULL DEFAULT '{}',
    evidence_snapshot jsonb NOT NULL DEFAULT '{}',
    mode_at_start text NOT NULL DEFAULT 'SHADOW',
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    resident_ready_at timestamptz,
    error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS falkon_executions_property_idx
   ON falkon_executions (property_id, status)`,

  // ── Append-only event log for each execution ─────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_execution_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id uuid NOT NULL,
    event_kind text NOT NULL,
    from_phase text,
    to_phase text,
    gate_id text,
    gate_pass boolean,
    gate_detail text,
    payload jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS falkon_execution_events_exec_idx
   ON falkon_execution_events (execution_id, created_at)`,

  // ── Per-capability daily usage meters ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_usage_meters (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    capability text NOT NULL,
    date date NOT NULL,
    calls integer NOT NULL DEFAULT 0,
    shadow_calls integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    compute_ms integer NOT NULL DEFAULT 0,
    cost_usd_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS falkon_usage_meters_cap_date_uq
   ON falkon_usage_meters (capability, date)`,

  // ── Add Phase-1 columns to falkon_connections ────────────────────────
  `ALTER TABLE falkon_connections
   ADD COLUMN IF NOT EXISTS status text`,

  `ALTER TABLE falkon_connections
   ADD COLUMN IF NOT EXISTS capabilities_registered_at timestamptz`,

  `ALTER TABLE falkon_connections
   ADD COLUMN IF NOT EXISTS verification_steps jsonb`,

  `ALTER TABLE falkon_connections
   ADD COLUMN IF NOT EXISTS partner_client_id text`,

  `ALTER TABLE falkon_connections
   ADD COLUMN IF NOT EXISTS partner_tenant text`,

  `ALTER TABLE falkon_connections
   ADD COLUMN IF NOT EXISTS trust_doc_verified_at timestamptz`,

  // ── Add jti / processed columns to falkon_inbound_events ─────────────
  // The Phase 0 table exists but the Phase 1 webhook receiver uses
  // these new columns for nonce-based deduplication.
  `ALTER TABLE falkon_inbound_events
   ADD COLUMN IF NOT EXISTS jti text`,

  `ALTER TABLE falkon_inbound_events
   ADD COLUMN IF NOT EXISTS received_at timestamptz`,

  `ALTER TABLE falkon_inbound_events
   ADD COLUMN IF NOT EXISTS processed boolean NOT NULL DEFAULT false`,

  `ALTER TABLE falkon_inbound_events
   ADD COLUMN IF NOT EXISTS processed_at timestamptz`,

  `CREATE UNIQUE INDEX IF NOT EXISTS falkon_inbound_events_jti_uq
   ON falkon_inbound_events (jti) WHERE jti IS NOT NULL`,

  // ── Add COI / compliance columns to crews ────────────────────────────
  `ALTER TABLE crews
   ADD COLUMN IF NOT EXISTS coi_cert text`,

  `ALTER TABLE crews
   ADD COLUMN IF NOT EXISTS coi_expiry date`,

  `ALTER TABLE crews
   ADD COLUMN IF NOT EXISTS falkon_compliance_status text`,

  // ── Add reconciliation columns to falkon_units ────────────────────────
  `ALTER TABLE falkon_units
   ADD COLUMN IF NOT EXISTS reconciled_job_ids jsonb`,

  `ALTER TABLE falkon_units
   ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz`,

  `ALTER TABLE falkon_units
   ADD COLUMN IF NOT EXISTS reconciliation_status text`,

  // ── Falkon Network — peer registry ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_peers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    domain text NOT NULL,
    trust_doc_url text NOT NULL,
    capabilities_url text NOT NULL,
    health_state text NOT NULL DEFAULT 'pending_peer',
    last_health_check_at timestamptz,
    trust_doc_data jsonb,
    capabilities_data jsonb,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS falkon_peers_domain_uq ON falkon_peers (domain)`,

  // ── Falkon Network — cross-business request model ─────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_cross_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    direction text NOT NULL,
    peer_id uuid,
    peer_name text,
    capability_id text NOT NULL,
    capability_name text,
    correlation_id text NOT NULL,
    external_ref text,
    approval_state text NOT NULL DEFAULT 'pending_delivery',
    summary text,
    shared_data_snapshot jsonb,
    requester_identity jsonb,
    provider_identity jsonb,
    request_events jsonb DEFAULT '[]'::jsonb,
    attempts integer NOT NULL DEFAULT 0,
    last_attempt_at timestamptz,
    next_retry_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS falkon_cross_requests_correlation_uq ON falkon_cross_requests (correlation_id)`,

  // ── Falkon Network — phase gate activation state ──────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_phase_gates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phase integer NOT NULL,
    enabled boolean NOT NULL DEFAULT false,
    activated_at timestamptz,
    activated_by text,
    rollback_to integer,
    readiness_snapshot jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS falkon_phase_gates_phase_uq ON falkon_phase_gates (phase)`,

  // ── Falkon Network — append-only audit log ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS falkon_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL,
    actor text NOT NULL DEFAULT 'system',
    entity_type text NOT NULL,
    entity_id text,
    summary text NOT NULL,
    payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── Seed Phase 1 as active, Phases 2–6 as dormant ─────────────────────────
  `INSERT INTO falkon_phase_gates (id, phase, enabled, activated_at, activated_by, created_at, updated_at)
   VALUES (gen_random_uuid(), 1, true, now(), 'system', now(), now())
   ON CONFLICT (phase) DO NOTHING`,

  `INSERT INTO falkon_phase_gates (id, phase, enabled, created_at, updated_at)
   VALUES (gen_random_uuid(), 2, false, now(), now())
   ON CONFLICT (phase) DO NOTHING`,

  `INSERT INTO falkon_phase_gates (id, phase, enabled, created_at, updated_at)
   VALUES (gen_random_uuid(), 3, false, now(), now())
   ON CONFLICT (phase) DO NOTHING`,

  `INSERT INTO falkon_phase_gates (id, phase, enabled, created_at, updated_at)
   VALUES (gen_random_uuid(), 4, false, now(), now())
   ON CONFLICT (phase) DO NOTHING`,

  `INSERT INTO falkon_phase_gates (id, phase, enabled, created_at, updated_at)
   VALUES (gen_random_uuid(), 5, false, now(), now())
   ON CONFLICT (phase) DO NOTHING`,

  `INSERT INTO falkon_phase_gates (id, phase, enabled, created_at, updated_at)
   VALUES (gen_random_uuid(), 6, false, now(), now())
   ON CONFLICT (phase) DO NOTHING`,

  // ── Seed UR Founders as HALO's first Falkon peer ──────────────────────────
  `INSERT INTO falkon_peers
     (id, name, domain, trust_doc_url, capabilities_url, health_state, notes, created_at, updated_at)
   VALUES
     (gen_random_uuid(),
      'UR Founders',
      'urfounders.com',
      'https://www.urfounders.com/.well-known/falkon-trust.json',
      'https://www.urfounders.com/api/falkon/network/capabilities',
      'pending_peer',
      'HALO''s first Falkon Network peer — entity formation, compliance, and LLC services.',
      now(), now())
   ON CONFLICT (domain) DO NOTHING`,
];

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

export async function ensureFalkonSchema(): Promise<void> {
  let ok = 0;
  let failed = 0;

  for (const stmt of STATEMENTS) {
    try {
      await db.execute(sql.raw(stmt));
      ok++;
    } catch (err) {
      failed++;
      logger.warn(
        { err, stmt: stmt.slice(0, 80) },
        "falkon: schema bootstrap statement failed (non-fatal)",
      );
    }
  }

  logger.info({ ok, failed }, "falkon: schema bootstrap complete");
}
