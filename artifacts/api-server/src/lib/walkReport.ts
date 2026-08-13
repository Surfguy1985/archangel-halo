import { db, base44EvidenceTable } from "@workspace/db";
import { buildWalkEvidence, type WalkReportInput } from "./walkReportCore";

export async function persistWalkEvidence(input: WalkReportInput): Promise<void> {
  const row = buildWalkEvidence(input);
  const now = new Date();
  await db
    .insert(base44EvidenceTable)
    .values({
      resource: row.resource,
      base44Id: row.base44Id,
      kind: row.kind,
      propertyName: row.propertyName,
      unitLabel: row.unitLabel,
      title: row.title,
      body: row.body,
      mediaUrl: row.mediaUrl,
      occurredAt: row.occurredAt,
      sourceUpdatedAt: now,
      lastSeenAt: now,
      stale: false,
      payloadHash: row.payloadHash,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [base44EvidenceTable.resource, base44EvidenceTable.base44Id],
      set: {
        kind: row.kind,
        propertyName: row.propertyName,
        title: row.title,
        body: row.body,
        occurredAt: row.occurredAt,
        sourceUpdatedAt: now,
        lastSeenAt: now,
        stale: false,
        payloadHash: row.payloadHash,
        updatedAt: now,
      },
    });
}
