/**
 * Idempotent DDL for purchase_orders columns added after initial launch.
 * Safe to run on every boot — ADD COLUMN IF NOT EXISTS is a no-op when the
 * column already exists.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS catalog_item_id uuid`,
  `ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS amount double precision`,
];

export async function ensureInventorySchema(): Promise<void> {
  for (const statement of STATEMENTS) {
    await db.execute(sql.raw(statement));
  }
  logger.info("inventory schema ensured");
}
