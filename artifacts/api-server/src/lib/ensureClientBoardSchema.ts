/**
 * Client Board v1 schema bootstrap.
 * drizzle-kit push is TTY-bound; this runs at process start like Falkon/Base44.
 */

import { db, CLIENT_BOARD_DDL, CLIENT_STAGE_OWNERSHIP_SEED_SQL, CLIENT_BOARD_FLAGS_SEED_SQL } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function ensureClientBoardSchema(): Promise<void> {
  let ok = 0;
  let failed = 0;
  for (const stmt of CLIENT_BOARD_DDL) {
    try {
      await db.execute(sql.raw(stmt));
      ok++;
    } catch (err) {
      failed++;
      logger.warn(
        { err, stmt: stmt.slice(0, 96) },
        "client-board: schema bootstrap statement failed (non-fatal)",
      );
    }
  }
  try {
    await db.execute(sql.raw(CLIENT_STAGE_OWNERSHIP_SEED_SQL));
    await db.execute(sql.raw(CLIENT_BOARD_FLAGS_SEED_SQL));
    await db.execute(
      sql.raw(
        `UPDATE client_board_flags SET enabled = true, updated_at = now() WHERE segment IN ('turnEngine', 'pulse', 'propertyBoard') AND enabled IS DISTINCT FROM true`,
      ),
    );
  } catch (err) {
    failed++;
    logger.warn({ err }, "client-board: ownership/flag seed failed (non-fatal)");
  }
  logger.info({ ok, failed }, "client-board: schema bootstrap complete");
}
