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
