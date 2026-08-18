/**
 * Adds `crews.company` — the contractor a crew works for.
 *
 * Every map pin carries a contractor badge, and a pin with no badge (or the
 * wrong one) is worse than no pin: it tells a client that our people are on
 * their property when the crew is actually a sub. Null means in-house.
 *
 * drizzle-kit push is TTY-bound, so this runs at process start like the other
 * schema bootstraps.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

let ready: Promise<void> | null = null;

async function run(): Promise<void> {
  await db.execute(sql.raw(`ALTER TABLE crews ADD COLUMN IF NOT EXISTS company text`));
  logger.info("crew company schema ensured");
}

export function ensureCrewCompanySchema(): Promise<void> {
  ready ??= run();
  return ready;
}
