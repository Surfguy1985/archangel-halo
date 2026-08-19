/**
 * Idempotent financial-reconciliation schema bootstrap.
 *
 * drizzle-kit push is unusable in this repo, so the reconciliation tables ship
 * as boot-time DDL like Falkon/Base44/reminders do. Without them the 5-minute
 * scheduler sweep throws on every tick, GET /api/discrepancies/open returns
 * 500, and POST /internal/work-logged silently fails its reconciliation pass —
 * which reads to the user as "the CPA brain does nothing".
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS master_price_list (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     service_code text NOT NULL,
     name text NOT NULL,
     category text NOT NULL,
     unit_type text NOT NULL,
     rate_cents integer,
     notes text,
     effective_from date NOT NULL DEFAULT '2026-08-01',
     effective_to date,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS master_price_list_code_unit_eff_uq
     ON master_price_list (service_code, unit_type, effective_from)`,

  `CREATE TABLE IF NOT EXISTS crew_payout_master (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     service_code text NOT NULL,
     name text NOT NULL,
     category text NOT NULL,
     unit_type text NOT NULL,
     rate_cents integer,
     trade text,
     notes text,
     effective_from date NOT NULL DEFAULT '2026-08-01',
     effective_to date,
     is_active boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crew_payout_master_code_unit_eff_uq
     ON crew_payout_master (service_code, unit_type, effective_from)`,

  `CREATE TABLE IF NOT EXISTS service_mapping (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     master_service_code text NOT NULL,
     crew_service_code text NOT NULL,
     notes text,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS reconciliation_runs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     started_at timestamptz NOT NULL DEFAULT now(),
     finished_at timestamptz,
     jobs_scanned integer NOT NULL DEFAULT 0,
     discrepancies_found integer NOT NULL DEFAULT 0,
     triggered_by text NOT NULL,
     notes text
   )`,

  `CREATE TABLE IF NOT EXISTS discrepancies (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     job_id uuid NOT NULL,
     invoice_id uuid,
     crew_payment_id uuid,
     type text NOT NULL,
     service_code text,
     expected_cents integer,
     actual_cents integer,
     variance_cents integer,
     severity text NOT NULL DEFAULT 'high',
     status text NOT NULL DEFAULT 'open',
     explanation text NOT NULL,
     suggested_fix jsonb,
     admin_override_cents integer,
     admin_reason text,
     resolved_by uuid,
     resolved_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS discrepancies_status_created_idx
     ON discrepancies (status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS discrepancies_job_idx ON discrepancies (job_id)`,
];

export async function ensureReconciliationSchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    try {
      await db.execute(sql.raw(statement));
    } catch (err) {
      logger.error({ err, statement }, "ensureReconciliationSchema statement failed");
    }
  }
}
