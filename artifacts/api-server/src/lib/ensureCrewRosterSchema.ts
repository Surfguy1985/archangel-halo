/**
 * Boot-time DDL for the shared crew roster code.
 *
 * Two pieces: the code itself on the settings singleton, and the extra portal
 * bearers a self-claim mints. drizzle-kit push is not usable in this repo, so
 * columns ship as idempotent ensure DDL and are awaited before the server
 * accepts traffic — every `select * from crews`/`business_settings` reads them.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE business_settings
    ADD COLUMN IF NOT EXISTS crew_roster_code text
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS crew_portal_bearers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      crew_id uuid NOT NULL,
      token_hash text NOT NULL UNIQUE,
      source text NOT NULL DEFAULT 'roster',
      status text NOT NULL DEFAULT 'pending',
      requested_name text,
      approved_at timestamptz,
      denied_at timestamptz,
      last_seen_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  // Columns added after the table first shipped. Rows that predate the
  // approval gate were working links, so they backfill as 'approved' — adding
  // the column with that default fills them in place. New rows must start
  // 'pending', hence the default flip immediately after.
  await db.execute(sql`
    ALTER TABLE crew_portal_bearers
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved',
    ADD COLUMN IF NOT EXISTS requested_name text,
    ADD COLUMN IF NOT EXISTS approved_at timestamptz,
    ADD COLUMN IF NOT EXISTS denied_at timestamptz
  `);
  await db.execute(sql`
    ALTER TABLE crew_portal_bearers ALTER COLUMN status SET DEFAULT 'pending'
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS crew_portal_bearers_crew_idx
    ON crew_portal_bearers (crew_id)
  `);
  logger.info("crew roster schema ensured");
}

export function ensureCrewRosterSchema(): Promise<void> {
  ready ??= run();
  return ready;
}

export const crewRosterSchemaReady = ensureCrewRosterSchema;
