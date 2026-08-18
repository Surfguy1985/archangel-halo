/**
 * Idempotency guards for field photo capture.
 *
 * Phone uploads retry: a crew on bad LTE registers a photo, the response is
 * lost, and the app sends it again. Without a database-level guard the same
 * capture lands twice — twice in the crew vault, twice in the office activity
 * feed, and twice in the recap. These unique indexes make the retry a no-op
 * instead of a duplicate, and let the insert paths rely on the constraint.
 *
 * A storage path is a server-minted UUID, so two rows sharing one path are
 * always the same capture recorded twice — never two photos. That is why the
 * collapse below is safe to run before creating the indexes: it keeps the
 * earliest row (the one already referenced elsewhere) and drops the replays.
 *
 * drizzle-kit push is TTY-bound, so this runs at process start like the other
 * schema bootstraps.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/** Collapse pre-existing duplicates so the unique indexes can be created. */
const COLLAPSE: { label: string; stmt: string }[] = [
  {
    label: "crew_photos",
    stmt: `DELETE FROM crew_photos a
             USING crew_photos b
             WHERE a.storage_path = b.storage_path
               AND (b.created_at, b.id) < (a.created_at, a.id)`,
  },
  {
    label: "activities photo mirrors",
    stmt: `DELETE FROM activities a
             USING activities b
             WHERE a.storage_path IS NOT NULL
               AND a.kind IN ('photo_before', 'photo_after')
               AND b.kind IN ('photo_before', 'photo_after')
               AND a.entity_type = b.entity_type
               AND a.entity_id = b.entity_id
               AND a.storage_path = b.storage_path
               AND (b.created_at, b.id) < (a.created_at, a.id)`,
  },
];

const INDEXES: string[] = [
  // One stored object = one photo row.
  `CREATE UNIQUE INDEX IF NOT EXISTS crew_photos_storage_path_uniq
     ON crew_photos (storage_path)`,
  // One mirrored before/after activity per (job, object).
  `CREATE UNIQUE INDEX IF NOT EXISTS activities_photo_mirror_uniq
     ON activities (entity_type, entity_id, storage_path)
     WHERE storage_path IS NOT NULL AND kind IN ('photo_before', 'photo_after')`,
];

export async function ensureFieldPhotoSchema(): Promise<void> {
  for (const { label, stmt } of COLLAPSE) {
    const res = await db.execute(sql.raw(stmt));
    const removed = res.rowCount ?? 0;
    if (removed > 0) {
      logger.warn({ removed, table: label }, "collapsed duplicate field photo rows");
    }
  }
  // No catch: if a unique index cannot be created the duplicate protection is
  // absent, and that must be loud (the caller logs it) rather than assumed.
  for (const stmt of INDEXES) {
    await db.execute(sql.raw(stmt));
  }
  logger.info("field photo idempotency schema ensured");
}
