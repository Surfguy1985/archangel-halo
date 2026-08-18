/**
 * Adds `vendors.vendor_type` / `vendors.contract_status` and makes sure the
 * in-house crew organization exists as exactly one vendor row.
 *
 * The vendors module is organized around "who are we contracted with", with
 * the in-house organization pinned first. Existing rows default to a
 * contracted subcontractor so nothing disappears from the list on rollout.
 *
 * Exactly one in-house row is an invariant, not a convention: every in-house
 * row is pinned, undeletable, and carries the same aggregate turn average, so
 * a second one is a duplicate of the company itself. A partial unique index
 * enforces it in the database, where concurrent servers can't race past it.
 *
 * drizzle-kit push is TTY-bound, so this runs at process start like the other
 * schema bootstraps.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { DEFAULT_CONTRACTOR } from "./crewPinIdentity";

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  await db.execute(
    sql.raw(
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS vendor_type text NOT NULL DEFAULT 'subcontractor'`,
    ),
  );
  await db.execute(
    sql.raw(
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS contract_status text NOT NULL DEFAULT 'contracted'`,
    ),
  );

  // A pre-existing row for our own organization should not read as a sub.
  // At most one is promoted, and only when there is no in-house row yet.
  await db.execute(sql`
    UPDATE vendors
       SET vendor_type = 'in_house'
     WHERE id = (
             SELECT id FROM vendors
              WHERE vendor_type = 'subcontractor'
                AND lower(name) LIKE ${"%" + DEFAULT_CONTRACTOR.toLowerCase() + "%"}
              ORDER BY created_at
              LIMIT 1
           )
       AND NOT EXISTS (SELECT 1 FROM vendors WHERE vendor_type = 'in_house')
  `);

  // Created before the seed below, so two servers booting at once collide on
  // the index instead of both inserting.
  try {
    await db.execute(
      sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS vendors_single_in_house
           ON vendors (vendor_type) WHERE vendor_type = 'in_house'`,
      ),
    );
  } catch (err) {
    // Only fails if a database already holds duplicates — worth a loud line,
    // but not worth refusing to boot over.
    logger.warn({ err }, "vendors: could not enforce a single in-house row");
  }

  // The module pins the in-house organization at the top; without a row there
  // is nothing to pin, and our own crews' work has nowhere to be counted.
  await db.execute(sql`
    INSERT INTO vendors (name, trade, vendor_type, contract_status)
    SELECT ${DEFAULT_CONTRACTOR}, 'In-house crews', 'in_house', 'contracted'
     WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE vendor_type = 'in_house')
    ON CONFLICT DO NOTHING
  `);

  logger.info("vendor contract schema ensured");
}

export function ensureVendorContractSchema(): Promise<void> {
  // A failed bootstrap must not be cached: the next caller retries instead of
  // inheriting a permanently rejected promise.
  ready ??= run().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}
