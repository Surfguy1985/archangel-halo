/**
 * Idempotent crew_join_links bootstrap.
 * drizzle-kit push is TTY-bound; this runs at process start like the Falkon,
 * Base44 and reminders bootstraps so deployed environments pick the table up
 * without a manual migration.
 *
 * Without this table a foreman's paycard cannot mint QR invites and the
 * public /join/:token page 500s on every scan.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

// Legacy bearer shape: an interim build stored the join token verbatim in
// `label` so a printed code could be re-shown.
const LEGACY_BEARER_LABEL = "^join_[0-9a-f]{32,}$";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS crew_join_links (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     token_hash text NOT NULL UNIQUE,
     token_prefix text NOT NULL,
     foreman_crew_id uuid NOT NULL,
     label text,
     expires_at timestamptz NOT NULL,
     claimed_at timestamptz,
     claimed_crew_id uuid,
     claimed_name text,
     revoked_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `ALTER TABLE crew_join_links ADD COLUMN IF NOT EXISTS claimed_name text`,
  `ALTER TABLE crew_join_links ADD COLUMN IF NOT EXISTS revoked_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS crew_join_links_foreman_idx
     ON crew_join_links (foreman_crew_id, created_at DESC)`,
  // One-time sanitation: any row carrying a legacy bearer in `label` is a live
  // token sitting in the database and in every backup. Kill the unclaimed ones,
  // then scrub the label everywhere. Idempotent — matches only that shape.
  `UPDATE crew_join_links
      SET revoked_at = COALESCE(revoked_at, now())
    WHERE claimed_at IS NULL
      AND revoked_at IS NULL
      AND label ~ '${LEGACY_BEARER_LABEL}'`,
  `UPDATE crew_join_links
      SET label = 'crew QR'
    WHERE label ~ '${LEGACY_BEARER_LABEL}'`,
];

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  logger.info("crew join schema ensured");
}

export function ensureCrewJoinSchema(): Promise<void> {
  ready ??= run();
  return ready;
}

/**
 * Awaited by the join routes so a process that booted before this file existed
 * (or whose boot ensure failed) still self-heals on first use instead of 500ing.
 */
export async function crewJoinSchemaReady(): Promise<void> {
  try {
    await ensureCrewJoinSchema();
  } catch (err) {
    ready = null; // let the next request retry rather than caching the failure
    throw err;
  }
}
