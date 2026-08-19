/**
 * Board workspace bootstrap — office-defined job fields and saved views.
 *
 * Ships as boot-time idempotent DDL like the other schema bootstraps: this repo
 * cannot run drizzle-kit push (it dies on a pre-existing BigInt serialization
 * error before reaching any change).
 *
 * Awaited before listen. `jobs.custom_fields` is the reason: drizzle enumerates
 * every column of `jobs` on a plain select, so until the column exists the job
 * board, today's queues and the command snapshot all 500 — the same failure the
 * `priority` column caused.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS custom_fields jsonb`,
  `CREATE TABLE IF NOT EXISTS board_field_defs (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     scope text NOT NULL DEFAULT 'job',
     key text NOT NULL,
     label text NOT NULL,
     type text NOT NULL,
     options jsonb,
     show_on_card boolean NOT NULL DEFAULT false,
     position double precision NOT NULL DEFAULT 0,
     archived boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  // One live field per key per board. Archived rows are excluded so a key can
  // be retired and later re-created without tripping the constraint.
  `CREATE UNIQUE INDEX IF NOT EXISTS board_field_defs_scope_key_idx
     ON board_field_defs (scope, key) WHERE archived = false`,
  `CREATE TABLE IF NOT EXISTS board_views (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     scope text NOT NULL DEFAULT 'job',
     name text NOT NULL,
     view_type text NOT NULL DEFAULT 'board',
     filters jsonb,
     sort jsonb,
     group_by text NOT NULL DEFAULT 'rail',
     visible_columns jsonb,
     position double precision NOT NULL DEFAULT 0,
     is_default boolean NOT NULL DEFAULT false,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS board_views_scope_idx ON board_views (scope, position)`,
];

export async function ensureBoardWorkspaceSchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  logger.info("board workspace schema ensured");
}
