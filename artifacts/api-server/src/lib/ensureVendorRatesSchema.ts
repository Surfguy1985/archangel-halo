/**
 * Creates the vendor_rates table if it doesn't exist.
 *
 * vendor_rates anchors a per-vendor rate to a catalog_items row so that the
 * office can record what each subcontractor charges for a service, then compare
 * it to the master price inline. The table has no DB foreign keys (matching
 * project convention) but is logically keyed by (vendor_id, catalog_item_id).
 *
 * drizzle-kit push is TTY-bound, so this runs at process start like all other
 * schema bootstraps.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS vendor_rates (
      id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      vendor_id       uuid        NOT NULL,
      catalog_item_id uuid        NOT NULL,
      rate            float8      NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (vendor_id, catalog_item_id)
    )
  `));

  logger.info("vendor_rates schema ensured");
}

export function ensureVendorRatesSchema(): Promise<void> {
  ready ??= run().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
