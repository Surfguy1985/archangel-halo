/**
 * Field-proof provenance — HALO check-in / trail → evidence (pure).
 * resource `halo_field` is outside Base44 sync, so ingest will not mark it stale.
 * Body carries the mapped Base44 job id when the HALO job is in base44_sync_map.
 */

import { createHash } from "node:crypto";

export const HALO_FIELD_EVIDENCE_RESOURCE = "halo_field";

export type FieldProvenanceKind = "checkin" | "checkout" | "location";

export interface FieldProvenanceInput {
  eventId: string;
  kind: FieldProvenanceKind;
  crewId: string;
  haloJobId: string | null;
  base44JobId: string | null;
  lat: number | null;
  lng: number | null;
  at: Date;
  propertyName?: string | null;
}

export interface FieldEvidenceRow {
  resource: typeof HALO_FIELD_EVIDENCE_RESOURCE;
  base44Id: string;
  kind: FieldProvenanceKind;
  propertyName: string | null;
  unitLabel: null;
  title: string;
  body: string;
  mediaUrl: null;
  occurredAt: Date;
  payloadHash: string;
}

export function buildFieldEvidence(input: FieldProvenanceInput): FieldEvidenceRow {
  const gps =
    input.lat != null && input.lng != null ? ` GPS ${input.lat.toFixed(5)},${input.lng.toFixed(5)}.` : "";
  const haloJob = input.haloJobId ? ` HALO job ${input.haloJobId}.` : " HALO job unknown.";
  const base44Job = input.base44JobId
    ? ` Base44 crew_job ${input.base44JobId}.`
    : " Base44 job unmapped.";
  const title = `Field ${input.kind}`;
  const body = `${title} crew ${input.crewId}.${haloJob}${base44Job}${gps}`;
  const payloadHash = createHash("sha256")
    .update(
      `halo-field:${input.kind}:${input.eventId}:${input.crewId}:${input.haloJobId ?? ""}:${input.base44JobId ?? ""}`,
    )
    .digest("hex");
  return {
    resource: HALO_FIELD_EVIDENCE_RESOURCE,
    base44Id: input.eventId,
    kind: input.kind,
    propertyName: input.propertyName ?? null,
    unitLabel: null,
    title,
    body,
    mediaUrl: null,
    occurredAt: input.at,
    payloadHash,
  };
}
