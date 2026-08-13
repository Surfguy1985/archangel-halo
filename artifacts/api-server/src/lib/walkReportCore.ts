/**
 * field.walk_report — HALO Walk → evidence projection (not a Base44 collection).
 * resource `halo_walk` is outside Base44 sync, so ingest will not mark it stale.
 */

import { createHash } from "node:crypto";

export const HALO_WALK_EVIDENCE_RESOURCE = "halo_walk";

export interface WalkReportInput {
  walkId: string;
  propertyName: string | null;
  kind: string;
  notes: string | null;
  captureCount: number;
  jobNos: string[];
  endedAt: Date | string | null;
}

export interface WalkEvidenceRow {
  resource: typeof HALO_WALK_EVIDENCE_RESOURCE;
  base44Id: string;
  kind: "walk_report";
  propertyName: string | null;
  unitLabel: null;
  title: string;
  body: string;
  mediaUrl: null;
  occurredAt: Date | null;
  payloadHash: string;
}

export function buildWalkEvidence(input: WalkReportInput): WalkEvidenceRow {
  const jobs = input.jobNos.length > 0 ? ` Jobs: ${input.jobNos.join(", ")}.` : "";
  const notes = input.notes?.trim() ? ` Notes: ${input.notes.trim()}` : "";
  const body = `${input.kind} walk — ${input.captureCount} capture${input.captureCount === 1 ? "" : "s"}.${jobs}${notes}`;
  const title = `Walk report${input.propertyName ? ` — ${input.propertyName}` : ""}`;
  const payloadHash = createHash("sha256")
    .update(`halo-walk:${input.walkId}:${input.captureCount}:${input.jobNos.join(",")}:${input.notes ?? ""}`)
    .digest("hex");
  const occurredAt = input.endedAt
    ? input.endedAt instanceof Date
      ? input.endedAt
      : new Date(input.endedAt)
    : null;
  return {
    resource: HALO_WALK_EVIDENCE_RESOURCE,
    base44Id: input.walkId,
    kind: "walk_report",
    propertyName: input.propertyName,
    unitLabel: null,
    title,
    body,
    mediaUrl: null,
    occurredAt: occurredAt && Number.isFinite(occurredAt.getTime()) ? occurredAt : null,
    payloadHash,
  };
}
