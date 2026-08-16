/**
 * Idempotent reminders schema bootstrap.
 * drizzle-kit push is TTY-bound; this runs at process start like Falkon/Base44
 * so deployed environments pick the table up without a manual migration.
 *
 * Without this table BOTH /reminders and GET /today/briefing return 500 —
 * the briefing is the chat's "what needs my attention" card, so a missing
 * reminders table reads to the user as "HALO ask is broken".
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS reminders (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     text text NOT NULL,
     entity_type text,
     entity_id text,
     entity_label text,
     remind_at timestamptz,
     dismissed_at timestamptz,
     snoozed_until timestamptz,
     created_by text NOT NULL DEFAULT 'office',
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  // Column adds cover databases that already have an older reminders table.
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS entity_type text`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS entity_id text`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS entity_label text`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS remind_at timestamptz`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS dismissed_at timestamptz`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS snoozed_until timestamptz`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'office'`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()`,
  `ALTER TABLE reminders ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
  `CREATE INDEX IF NOT EXISTS reminders_open_idx
     ON reminders (dismissed_at, remind_at)`,
];

export async function ensureRemindersSchema(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  logger.info("reminders schema ensured");
}
