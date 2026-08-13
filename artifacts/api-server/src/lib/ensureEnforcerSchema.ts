/**
 * Idempotent public-link schema: PM live + crew check-in hash-at-rest + audit.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `ALTER TABLE pm_live_links ADD COLUMN IF NOT EXISTS token_hash text`,
  `ALTER TABLE pm_live_links ADD COLUMN IF NOT EXISTS token_prefix text`,
  `ALTER TABLE pm_live_links ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz`,
  `CREATE UNIQUE INDEX IF NOT EXISTS pm_live_links_token_hash_uq ON pm_live_links (token_hash)`,
  `CREATE TABLE IF NOT EXISTS pm_link_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id uuid NOT NULL,
    action text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    ip_hash text,
    detail jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS pm_link_audit_link_idx ON pm_link_audit (link_id, at)`,
  `ALTER TABLE crew_checkin_links ADD COLUMN IF NOT EXISTS token_hash text`,
  `ALTER TABLE crew_checkin_links ADD COLUMN IF NOT EXISTS token_prefix text`,
  `ALTER TABLE crew_checkin_links ADD COLUMN IF NOT EXISTS last_accessed_at timestamptz`,
  `CREATE UNIQUE INDEX IF NOT EXISTS crew_checkin_links_token_hash_uq ON crew_checkin_links (token_hash)`,
  `CREATE TABLE IF NOT EXISTS crew_checkin_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id uuid NOT NULL,
    action text NOT NULL,
    at timestamptz NOT NULL DEFAULT now(),
    ip_hash text,
    detail jsonb
  )`,
  `CREATE INDEX IF NOT EXISTS crew_checkin_audit_link_idx ON crew_checkin_audit (link_id, at)`,
];

export async function ensureEnforcerSchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  logger.info("enforcer/public-link schema ensured");
}
