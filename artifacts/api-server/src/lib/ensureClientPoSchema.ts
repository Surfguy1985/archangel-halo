/**
 * Idempotent client-PO-intake schema bootstrap.
 * drizzle-kit push is TTY-bound; this runs at process start like Falkon/Base44
 * so deployed environments pick the columns up without a manual migration.
 *
 * Backs the office-chat PO intake flow ("here's PO 12345 for unit 204 at
 * Maple Ridge, send to vendor") and the flashing purple "PO RECEIVED" banner:
 *   po_received_at        — when the property sent the PO over (drives banner)
 *   po_received_source    — free-text provenance (e.g. "office chat")
 *   po_acknowledged_at    — when the office acknowledged/dismissed the banner
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `ALTER TABLE jobs
     ADD COLUMN IF NOT EXISTS po_received_at timestamptz`,
  `ALTER TABLE jobs
     ADD COLUMN IF NOT EXISTS po_received_source text`,
  `ALTER TABLE jobs
     ADD COLUMN IF NOT EXISTS po_acknowledged_at timestamptz`,
];

export async function ensureClientPoSchema(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  logger.info("client PO intake schema ensured");
}
