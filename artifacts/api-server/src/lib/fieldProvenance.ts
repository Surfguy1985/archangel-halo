/**
 * Persist field check-in / trail evidence. Best-effort: punch rows are SoR;
 * evidence must not fail the tap.
 */

import { eq } from "drizzle-orm";
import { db, base44EvidenceTable, base44SyncMapTable } from "@workspace/db";
import { logger } from "./logger";
import {
  buildFieldEvidence,
  type FieldProvenanceInput,
  type FieldProvenanceKind,
} from "./fieldProvenanceCore";

export async function lookupBase44JobId(haloJobId: string | null | undefined): Promise<string | null> {
  if (!haloJobId) return null;
  const rows = await db
    .select({
      resource: base44SyncMapTable.resource,
      base44Id: base44SyncMapTable.base44Id,
      status: base44SyncMapTable.status,
    })
    .from(base44SyncMapTable)
    .where(eq(base44SyncMapTable.haloId, haloJobId));
  const live = rows.filter((r) => r.status !== "stale");
  const pool = live.length > 0 ? live : rows;
  const crewJob = pool.find((r) => r.resource === "crew_jobs");
  return crewJob?.base44Id ?? pool[0]?.base44Id ?? null;
}

export async function persistFieldEvidence(input: FieldProvenanceInput): Promise<void> {
  const row = buildFieldEvidence(input);
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

export async function recordFieldProvenance(opts: {
  eventId: string;
  kind: FieldProvenanceKind;
  crewId: string;
  haloJobId: string | null;
  lat: number | null;
  lng: number | null;
  at?: Date;
  propertyName?: string | null;
}): Promise<void> {
  try {
    const base44JobId = await lookupBase44JobId(opts.haloJobId);
    await persistFieldEvidence({
      eventId: opts.eventId,
      kind: opts.kind,
      crewId: opts.crewId,
      haloJobId: opts.haloJobId,
      base44JobId,
      lat: opts.lat,
      lng: opts.lng,
      at: opts.at ?? new Date(),
      propertyName: opts.propertyName ?? null,
    });
  } catch (err) {
    logger.warn({ err, kind: opts.kind, eventId: opts.eventId }, "field provenance persist failed");
  }
}
