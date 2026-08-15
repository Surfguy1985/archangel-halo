/**
 * Segment 5 — evidence ledger, Unit Turn Record, Merkle verify.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientTurnsTable,
  clientTurnStageEventsTable,
  clientTurnMetricsMvTable,
  clientUnitsTable,
  clientEvidenceItemsTable,
  clientGpsEventsTable,
  clientTurnRecordsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientTurnInvoicesTable,
  clientTurnInvoiceLinesTable,
  computeTurnVerificationHash,
  pairRooms,
  roomLabel,
  explainIntegrityFlags,
  haversineM,
  DEFAULT_GEOFENCE_M,
  formatStageClock,
  stageVisitsFromEvents,
  formatUsd,
  sha256Hex,
  type TurnRecordVariant,
} from "@workspace/db";
import { fileUrl, issueSignedFile, EVIDENCE_URL_TTL_SEC } from "./evidenceSign";
import { renderTurnRecordPdf } from "./turnRecordPdf";

export class EvidenceNotFoundError extends Error {
  constructor(message = "Turn not found") {
    super(message);
    this.name = "EvidenceNotFoundError";
  }
}

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function recordDir(): string {
  return process.env.CLIENT_BOARD_RECORD_DIR ?? join(tmpdir(), "halo-turn-records");
}

function civilStamp(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

function deviceLabel(exif: unknown): string {
  if (!exif || typeof exif !== "object") return "Unknown device";
  const rec = exif as Record<string, unknown>;
  const make = typeof rec.Make === "string" ? rec.Make : typeof rec.make === "string" ? rec.make : "";
  const model = typeof rec.Model === "string" ? rec.Model : typeof rec.model === "string" ? rec.model : "";
  const label = `${make} ${model}`.trim();
  return label || "Unknown device";
}

async function loadTurn(turnId: string, orgId: string) {
  const [turn] = await db
    .select({
      id: clientTurnsTable.id,
      orgId: clientTurnsTable.orgId,
      propertyId: clientTurnsTable.propertyId,
      unitId: clientTurnsTable.unitId,
      status: clientTurnsTable.status,
      verificationHash: clientTurnsTable.verificationHash,
      actualVacateAt: clientTurnsTable.actualVacateAt,
      readyAt: clientTurnsTable.readyAt,
      unitNumber: clientUnitsTable.unitNumber,
      unitLat: clientUnitsTable.latitude,
      unitLng: clientUnitsTable.longitude,
      bedrooms: clientUnitsTable.bedrooms,
      propertyName: propertiesTable.name,
      timezone: propertiesTable.timezone,
      targetTurnDays: propertiesTable.targetTurnDays,
      propertyLat: propertiesTable.latitude,
      daysVacant: clientTurnMetricsMvTable.daysVacant,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientTurnsTable.propertyId))
    .leftJoin(clientTurnMetricsMvTable, eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id))
    .where(and(eq(clientTurnsTable.id, turnId), eq(clientTurnsTable.orgId, orgId)))
    .limit(1);
  if (!turn) throw new EvidenceNotFoundError();
  return turn;
}

async function loadLeaves(turnId: string) {
  const [evidence, timeline] = await Promise.all([
    db
      .select({
        id: clientEvidenceItemsTable.id,
        sha256: clientEvidenceItemsTable.sha256,
      })
      .from(clientEvidenceItemsTable)
      .where(eq(clientEvidenceItemsTable.turnId, turnId)),
    db
      .select({
        id: clientTurnStageEventsTable.id,
        stage: clientTurnStageEventsTable.stage,
        event: clientTurnStageEventsTable.event,
        occurredAt: clientTurnStageEventsTable.occurredAt,
      })
      .from(clientTurnStageEventsTable)
      .where(eq(clientTurnStageEventsTable.turnId, turnId)),
  ]);
  return {
    evidence,
    timeline: timeline.map((t) => ({
      id: t.id,
      stage: t.stage,
      event: t.event,
      occurredAt: t.occurredAt.toISOString(),
    })),
  };
}

export async function persistVerificationHash(turnId: string, orgId: string): Promise<string> {
  const leaves = await loadLeaves(turnId);
  const hash = computeTurnVerificationHash(leaves);
  await db
    .update(clientTurnsTable)
    .set({ verificationHash: hash, updatedAt: new Date() })
    .where(and(eq(clientTurnsTable.id, turnId), eq(clientTurnsTable.orgId, orgId)));
  return hash;
}

export async function computeTurnEvidence(args: { turnId: string; orgId: string }) {
  const turn = await loadTurn(args.turnId, args.orgId);
  const items = await db
    .select()
    .from(clientEvidenceItemsTable)
    .where(
      and(eq(clientEvidenceItemsTable.turnId, args.turnId), isNull(clientEvidenceItemsTable.tombstonedAt)),
    );
  const fenceLat = turn.unitLat ?? turn.propertyLat ?? null;
  const fenceLng = turn.unitLng ?? null;
  const photos = await Promise.all(
    items.map(async (item) => {
    const distanceM =
      item.deviceLat != null && item.deviceLng != null && fenceLat != null && fenceLng != null
        ? haversineM(item.deviceLat, item.deviceLng, fenceLat, fenceLng)
        : item.gpsAccuracyM ?? null;
    const captured = item.deviceCapturedAt ?? item.serverReceivedAt;
    const signedThumb = await issueSignedFile({
      kind: "evidence",
      id: item.id,
      size: "thumb",
      ttlSec: EVIDENCE_URL_TTL_SEC,
    });
    const signedView = await issueSignedFile({
      kind: "evidence",
      id: item.id,
      size: "view",
      ttlSec: EVIDENCE_URL_TTL_SEC,
    });
    return {
      id: item.id,
      phase: item.phase as "before" | "during" | "after" | "qc",
      room: item.room ?? "other",
      thumbUrl: fileUrl(`/v1/evidence/${item.id}/file`, signedThumb, "thumb"),
      viewUrl: fileUrl(`/v1/evidence/${item.id}/file`, signedView, "view"),
      capturedAt: captured.toISOString(),
      capturedAtLabel: civilStamp(captured, turn.timezone),
      device: deviceLabel(item.exif),
      distanceM,
      capturedByName: item.capturedByUserId ?? "Crew",
      integrityFlags: explainIntegrityFlags(item.integrityFlags, distanceM),
    };
    }),
  );
  const rooms = pairRooms(photos).map((r) => ({
    room: r.room,
    label: roomLabel(r.room),
    before: r.before,
    after: r.after,
    during: r.during,
    qc: r.qc,
  }));

  const gps = await db
    .select()
    .from(clientGpsEventsTable)
    .where(eq(clientGpsEventsTable.turnId, args.turnId));
  const points = gps
    .slice()
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .map((g) => ({
      lat: g.lat,
      lng: g.lng,
      at: g.occurredAt.toISOString(),
      type: g.type,
    }));
  const checkIn = points.find((p) => p.type === "check_in") ?? points[0] ?? null;
  const checkOut =
    [...points].reverse().find((p) => p.type === "check_out") ??
    (points.length > 1 ? points[points.length - 1]! : null);

  return {
    turnId: turn.id,
    timezone: turn.timezone,
    rooms,
    trail: {
      checkIn,
      checkOut,
      points,
      geofence: {
        lat: fenceLat ?? checkIn?.lat ?? 0,
        lng: fenceLng ?? checkIn?.lng ?? 0,
        radiusM: fenceLat != null ? DEFAULT_GEOFENCE_M : 0,
      },
    },
    verificationHash: turn.verificationHash,
  };
}

export async function verifyTurn(args: { turnId: string; orgId: string }) {
  const turn = await loadTurn(args.turnId, args.orgId);
  const leaves = await loadLeaves(args.turnId);
  const computedHash = computeTurnVerificationHash(leaves);
  let storedHash = turn.verificationHash;
  if (!storedHash) {
    storedHash = computedHash;
    await db
      .update(clientTurnsTable)
      .set({ verificationHash: storedHash, updatedAt: new Date() })
      .where(eq(clientTurnsTable.id, args.turnId));
  }
  return {
    turnId: turn.id,
    storedHash,
    computedHash,
    matches: storedHash === computedHash,
    evidenceCount: leaves.evidence.length,
    timelineEventCount: leaves.timeline.length,
  };
}

async function toRecordDoc(row: {
  id: string;
  turnId: string;
  variant: TurnRecordVariant;
  status: string;
  sha256: string | null;
  bytes: bigint | null;
  error: string | null;
}) {
  const ready = row.status === "ready";
  const signed = ready
    ? await issueSignedFile({ kind: "record", id: row.id, ttlSec: EVIDENCE_URL_TTL_SEC })
    : null;
  return {
    id: row.id,
    turnId: row.turnId,
    variant: row.variant,
    status: row.status as "queued" | "rendering" | "ready" | "failed",
    url: signed ? fileUrl(`/v1/records/${row.id}/file`, signed) : null,
    expiresAt: signed ? new Date(Number(signed.exp) * 1000).toISOString() : null,
    sha256: row.sha256,
    bytes: row.bytes != null ? row.bytes.toString() : null,
    error: row.error,
  };
}

export async function getTurnRecord(args: { recordId: string; orgId: string }) {
  const [row] = await db
    .select()
    .from(clientTurnRecordsTable)
    .where(
      and(eq(clientTurnRecordsTable.id, args.recordId), eq(clientTurnRecordsTable.orgId, args.orgId)),
    )
    .limit(1);
  if (!row) throw new EvidenceNotFoundError("Record not found");
  return await toRecordDoc(row);
}

export async function createTurnRecord(args: {
  turnId: string;
  orgId: string;
  variant: TurnRecordVariant;
  actorId: string;
}) {
  const [inserted] = await db
    .insert(clientTurnRecordsTable)
    .values({
      turnId: args.turnId,
      orgId: args.orgId,
      variant: args.variant,
      status: "rendering",
    })
    .returning();
  const row = inserted!;
  try {
    const pdf = await buildRecordPdf(args.turnId, args.orgId, args.variant);
    const dir = recordDir();
    await mkdir(dir, { recursive: true });
    const storageKey = join(dir, `${row.id}.pdf`);
    await writeFile(storageKey, pdf);
    const hash = sha256Hex(Buffer.from(pdf));
    const [updated] = await db
      .update(clientTurnRecordsTable)
      .set({
        status: "ready",
        storageKey,
        sha256: hash,
        bytes: BigInt(pdf.byteLength),
        readyAt: new Date(),
        error: null,
      })
      .where(eq(clientTurnRecordsTable.id, row.id))
      .returning();
    await persistVerificationHash(args.turnId, args.orgId);
    return await toRecordDoc(updated!);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Record failed";
    const [failed] = await db
      .update(clientTurnRecordsTable)
      .set({ status: "failed", error: message })
      .where(eq(clientTurnRecordsTable.id, row.id))
      .returning();
    return await toRecordDoc(failed!);
  }
}

export async function readRecordFile(recordId: string): Promise<Buffer> {
  const [row] = await db
    .select({ storageKey: clientTurnRecordsTable.storageKey, status: clientTurnRecordsTable.status })
    .from(clientTurnRecordsTable)
    .where(eq(clientTurnRecordsTable.id, recordId))
    .limit(1);
  if (!row?.storageKey || row.status !== "ready") throw new EvidenceNotFoundError("Record not ready");
  return readFile(row.storageKey);
}

export async function readEvidenceFile(_id: string): Promise<{ bytes: Buffer; mime: string }> {
  return { bytes: PNG_1X1, mime: "image/png" };
}

async function buildRecordPdf(turnId: string, orgId: string, variant: TurnRecordVariant) {
  const turn = await loadTurn(turnId, orgId);
  const hash = turn.verificationHash ?? (await persistVerificationHash(turnId, orgId));
  const events = await db
    .select()
    .from(clientTurnStageEventsTable)
    .where(eq(clientTurnStageEventsTable.turnId, turnId));
  const visits = stageVisitsFromEvents(
    events.map((e) => ({
      id: e.id,
      stage: e.stage,
      event: e.event,
      occurredAt: e.occurredAt,
      actorId: e.actorId,
    })),
    turn.readyAt ?? new Date(),
  );
  const items = await db
    .select()
    .from(clientEvidenceItemsTable)
    .where(and(eq(clientEvidenceItemsTable.turnId, turnId), isNull(clientEvidenceItemsTable.tombstonedAt)));
  const gps = await db
    .select()
    .from(clientGpsEventsTable)
    .where(eq(clientGpsEventsTable.turnId, turnId));
  const [invoice] = await db
    .select()
    .from(clientTurnInvoicesTable)
    .where(eq(clientTurnInvoicesTable.turnId, turnId))
    .limit(1);
  const invoiceLines = invoice
    ? await db
        .select()
        .from(clientTurnInvoiceLinesTable)
        .where(eq(clientTurnInvoiceLinesTable.invoiceId, invoice.id))
    : [];
  const scopes = await db.select().from(clientScopesTable).where(eq(clientScopesTable.turnId, turnId));
  const scopeLines =
    scopes.length > 0
      ? await db
          .select()
          .from(clientScopeLinesTable)
          .where(eq(clientScopeLinesTable.scopeId, scopes[0]!.id))
      : [];

  const datesLabel = [
    turn.actualVacateAt ? `Vacated ${civilStamp(turn.actualVacateAt, turn.timezone)}` : "Not vacated",
    turn.readyAt ? `Ready ${civilStamp(turn.readyAt, turn.timezone)}` : "Open",
  ].join("  ·  ");

  return renderTurnRecordPdf({
    variant,
    propertyName: turn.propertyName,
    unitNumber: turn.unitNumber,
    timezone: turn.timezone,
    daysVacant: typeof turn.daysVacant === "number" ? turn.daysVacant : 0,
    targetTurnDays: turn.targetTurnDays,
    finalCostLabel: invoice ? formatUsd(invoice.totalCents) : "—",
    verificationHash: hash,
    datesLabel,
    timeline: visits.map((v) => ({
      stage: v.stage,
      enteredAt: civilStamp(v.enteredAt, turn.timezone),
      exitedAt: v.exitedAt ? civilStamp(v.exitedAt, turn.timezone) : "now",
      duration: formatStageClock(v.durationMs),
      owner: v.owner,
    })),
    photos: items.map((item) => ({
      room: roomLabel(item.room),
      phase: item.phase,
      caption: civilStamp(item.deviceCapturedAt ?? item.serverReceivedAt, turn.timezone),
      bytes: PNG_1X1,
    })),
    scopeLines: scopeLines.map((l) => ({
      description: l.description,
      qty: l.qty,
      price: formatUsd(l.extendedCents),
      revision: "active",
    })),
    qcLabel: items.some((i) => i.phase === "qc") ? "QC photos on file" : "No QC photos yet",
    attendance: gps.map((g) => ({
      type: g.type,
      at: civilStamp(g.occurredAt, turn.timezone),
      distance: g.distanceFromUnitM != null ? `${Math.round(g.distanceFromUnitM)}m` : "—",
    })),
    invoiceLines: invoiceLines.map((l) => ({
      description: l.description,
      amount: formatUsd(l.extendedCents),
    })),
    poNumber: invoice?.poNumber ?? "",
    complianceScore: invoice?.complianceScore ?? "",
    chain: items.map((item) => ({
      id: item.id,
      sha256: item.sha256,
      capturedAt: civilStamp(item.deviceCapturedAt ?? item.serverReceivedAt, turn.timezone),
      receivedAt: civilStamp(item.serverReceivedAt, turn.timezone),
      flags: explainIntegrityFlags(
        item.integrityFlags,
        item.deviceLat != null && turn.unitLat != null && turn.unitLng != null && item.deviceLng != null
          ? haversineM(item.deviceLat, item.deviceLng, turn.unitLat, turn.unitLng)
          : null,
      )
        .map((f) => f.explanation)
        .join("; "),
    })),
  });
}
