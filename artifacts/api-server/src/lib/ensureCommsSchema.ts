/**
 * Idempotent SMS delivery-tracking schema bootstrap.
 * drizzle-kit push is TTY-bound; this runs at process start like Falkon/Base44
 * so deployed environments pick the columns up without a manual migration.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

const STATEMENTS: string[] = [
  `ALTER TABLE halo_sms_messages
     ADD COLUMN IF NOT EXISTS error_code integer`,
  `ALTER TABLE halo_sms_messages
     ADD COLUMN IF NOT EXISTS error_message text`,
  `ALTER TABLE halo_sms_messages
     ADD COLUMN IF NOT EXISTS callback_nonce text`,
  `ALTER TABLE halo_sms_messages
     ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`,
  `CREATE UNIQUE INDEX IF NOT EXISTS halo_sms_messages_nonce_uq
     ON halo_sms_messages (callback_nonce)`,
];

export async function ensureCommsSchema(): Promise<void> {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
  logger.info("comms schema ensured");
}
