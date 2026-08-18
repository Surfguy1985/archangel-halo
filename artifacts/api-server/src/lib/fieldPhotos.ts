/**
 * Field photos arrive from crews and land in `crew_photos`, but most of the
 * office side reads before/after photos from the `activities` feed
 * (`photo_before` / `photo_after`): job board tiles, the AI before/after
 * compare, the recap email, portal offer previews. A photo that only exists in
 * the vault is invisible to all of them — the crew uploads it, the office sees
 * an empty grid.
 *
 * So every vault write mirrors an activity row keyed by the same storage path.
 * Readers that merge both sources must dedupe by `storagePath`; that is why the
 * mirror never invents a second path.
 */
import { db, activitiesTable, crewPhotosTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

/**
 * Mirror a crew photo into the job activity feed. Idempotent per
 * (job, storagePath) and never throws: the photo row is already committed by
 * the time this runs, so a mirror failure must not fail the upload.
 */
export async function mirrorFieldPhotoActivity(input: {
  jobId: string | null;
  phase: string | null;
  storagePath: string;
  crewName?: string | null;
  note?: string | null;
}): Promise<void> {
  const { jobId, phase, storagePath } = input;
  // Only before/after belong in the activity feed — progress shots have no
  // consumer there and would inflate before/after counts.
  if (!jobId || !storagePath) return;
  if (phase !== "before" && phase !== "after") return;
  const kind = phase === "before" ? "photo_before" : "photo_after";
  try {
    const who = input.crewName?.trim();
    // ON CONFLICT, not select-then-insert: a retried upload can race itself,
    // and the unique index (see ensureFieldPhotoSchema) is the only thing that
    // settles it atomically.
    await db
      .insert(activitiesTable)
      .values({
        entityType: "job",
        entityId: jobId,
        kind,
        storagePath,
        body:
          input.note?.trim() ||
          `${who ? `${who} uploaded` : "Crew uploaded"} ${phase === "after" ? "an after" : "a before"} photo from the field`,
      })
      .onConflictDoNothing();
  } catch (err) {
    logger.warn({ err, jobId, kind }, "Could not mirror field photo into activities");
  }
}

/** The shape our presign endpoint mints: `/objects/uploads/<uuid>`. */
const MINTED_UPLOAD_RE =
  /^\/objects\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMintedUploadPath(storagePath: unknown): storagePath is string {
  return typeof storagePath === "string" && MINTED_UPLOAD_RE.test(storagePath.trim());
}

/**
 * Drop an object that was uploaded but never registered. Without this a failed
 * registration leaves paid-for bytes in the bucket that nothing will ever
 * reference or clean up.
 *
 * Deleting on behalf of a *failed* request is dangerous: the path came from an
 * unauthenticated crew link, so it must be proven to be this request's own
 * garbage before anything is removed. Two proofs, both required:
 *
 *   - it is a freshly minted upload path (not a hand-written path pointing at
 *     some other part of the bucket), and
 *   - nothing in the database references it — a path that any photo row or
 *     activity points at is somebody's evidence, never an orphan.
 *
 * If either check fails we leak a few bytes. That is the correct trade against
 * deleting a photo somebody still needs.
 */
export async function discardOrphanedUpload(storagePath: string): Promise<void> {
  if (!isMintedUploadPath(storagePath)) {
    logger.warn({ storagePath }, "Refusing to discard a path we did not mint");
    return;
  }
  try {
    const [photo] = await db
      .select({ id: crewPhotosTable.id })
      .from(crewPhotosTable)
      .where(eq(crewPhotosTable.storagePath, storagePath))
      .limit(1);
    const [activity] = await db
      .select({ id: activitiesTable.id })
      .from(activitiesTable)
      .where(eq(activitiesTable.storagePath, storagePath))
      .limit(1);
    if (photo || activity) {
      logger.warn({ storagePath }, "Refusing to discard an upload something still references");
      return;
    }
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(storagePath);
    await file.delete({ ignoreNotFound: true });
  } catch (err) {
    logger.warn({ err, storagePath }, "Could not discard orphaned upload");
  }
}
