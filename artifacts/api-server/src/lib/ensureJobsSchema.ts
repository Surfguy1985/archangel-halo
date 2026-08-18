/**
 * Idempotent jobs schema bootstrap.
 *
 * drizzle-kit push is not usable in this repo (it dies on a pre-existing BigInt
 * serialization error before it reaches any change), so column adds ship as
 * boot-time DDL the way the Falkon/Base44/reminders bootstraps do.
 *
 * Unlike those, this one is AWAITED BEFORE THE SERVER LISTENS. `priority` is a
 * NOT NULL column on `jobs`, and Drizzle enumerates every column in a plain
 * `select().from(jobsTable)` — so on a deployed database that predates the
 * column, the job board, today's queues and the command snapshot all 500 until
 * the DDL lands. A post-listen bootstrap would leave that window open on every
 * cold start.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  // Manual ordering for the job board and today's feed. Ascending — lower
  // sorts first — following the client-board card ordering precedent. Default 0
  // leaves every existing row in its previous (creation-order) position.
  `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS priority double precision NOT NULL DEFAULT 0`,
  // The board orders by (priority, created_at) on open jobs.
  `CREATE INDEX IF NOT EXISTS jobs_priority_idx ON jobs (priority, created_at DESC)`,
];

export async function ensureJobsSchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  logger.info("jobs schema ensured");
}
