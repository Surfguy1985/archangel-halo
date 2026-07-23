import { db, wingAuditTable } from "@workspace/db";

export async function logWingAudit(entry: {
  actorType?: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}): Promise<void> {
  await db.insert(wingAuditTable).values({
    actorType: entry.actorType ?? "SYSTEM",
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: (entry.before ?? null) as object | null,
    after: (entry.after ?? null) as object | null,
    reason: entry.reason ?? null,
  });
}
