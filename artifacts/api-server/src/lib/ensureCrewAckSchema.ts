/**
 * Idempotent crew_link_acknowledgements bootstrap.
 * drizzle-kit push is TTY-bound; this runs at process start like the Falkon,
 * Base44, reminders and crew-join bootstraps so deployed environments pick the
 * table up without a manual migration.
 *
 * Without this table every crew QR link 500s on the instructions gate and no
 * check-in can be recorded, so the routes also await the lazy `ready` helper.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS crew_link_acknowledgements (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     crew_id uuid NOT NULL,
     link_kind text NOT NULL,
     link_id uuid,
     token_prefix text,
     lang text NOT NULL DEFAULT 'en',
     version text NOT NULL,
     terms_text text NOT NULL,
     agreed_at timestamptz NOT NULL DEFAULT now(),
     agreed_by text NOT NULL,
     ip_hash text,
     user_agent text
   )`,
  `CREATE INDEX IF NOT EXISTS crew_link_acks_crew_agreed_idx
     ON crew_link_acknowledgements (crew_id, agreed_at)`,
];

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  logger.info("crew link acknowledgement schema ensured");
}

export function ensureCrewAckSchema(): Promise<void> {
  ready ??= run();
  return ready;
}

/**
 * Awaited by every route that reads or writes an acknowledgement so a process
 * that booted before this file existed (or whose boot ensure failed) still
 * self-heals on first use instead of 500ing.
 */
export async function crewAckSchemaReady(): Promise<void> {
  try {
    await ensureCrewAckSchema();
  } catch (err) {
    ready = null; // let the next request retry rather than caching the failure
    throw err;
  }
}
