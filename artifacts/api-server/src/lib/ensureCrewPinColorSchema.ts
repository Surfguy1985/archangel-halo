/**
 * Adds `crews.pin_color` — the saved colour a foreman's team wears on the map.
 *
 * The colour rule can derive a stable colour without this column, but the
 * office needs to be able to pin a specific colour to a specific foreman and
 * have it stay that way. Null means "derive one".
 *
 * drizzle-kit push is TTY-bound, so this runs at process start like the other
 * schema bootstraps.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  await db.execute(sql.raw(`ALTER TABLE crews ADD COLUMN IF NOT EXISTS pin_color text`));
  logger.info("crew pin colour schema ensured");
}

export function ensureCrewPinColorSchema(): Promise<void> {
  ready ??= run();
  return ready;
}
