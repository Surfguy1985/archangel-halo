/**
 * Stamp a client PO onto a live job, notify the assigned crew, and push the
 * number into Base44 dispatch + field. Pulse and Command share this writer.
 */

import { and, eq, notInArray } from "drizzle-orm";
import {
  db,
  activitiesTable,
  base44SyncMapTable,
  crewsTable,
  jobsTable,
  notificationsTable,
  propertiesTable,
} from "@workspace/db";
import { CLOSED_STATUSES, normalizePoNumber } from "./clientPoIntakeCore";
import { emitBoardEvent } from "./boardEvents";
import { sendSms, smsEnabled } from "./sms";
import { pushToCrewId } from "./pushNotification";
import { pushPoToBase44 } from "./base44Write";
import { logger } from "./logger";

export type StampJobPoResult =
  | {
      ok: true;
      already: boolean;
      jobId: string;
      jobNo: string;
      unitNo: string | null;
      propertyName: string;
      poNumber: string;
      notify: string[];
      base44: { ok: boolean; error: string | null };
    }
  | { ok: false; status: 400 | 404 | 409; error: string; code: string };

async function notifyCrew(input: {
  crewId: string | null;
  poNumber: string;
  propertyName: string;
  unitLabel: string;
  jobId: string;
  jobNo: string;
}): Promise<string[]> {
  const lines: string[] = [];
  if (!input.crewId) {
    lines.push("No crew is assigned yet — dispatch will show the PO as soon as a crew is on the unit.");
    return lines;
  }
  const [crew] = await db
    .select({ id: crewsTable.id, name: crewsTable.name, phone: crewsTable.phone })
    .from(crewsTable)
    .where(eq(crewsTable.id, input.crewId));
  const smsBody = `PO ${input.poNumber} received for ${input.propertyName} Unit ${input.unitLabel} (${input.jobNo}). Complete final walkthrough and get invoices in ASAP.`;
  if (crew?.phone && (await smsEnabled())) {
    const result = await sendSms(crew.phone, smsBody, { crewId: crew.id });
    lines.push(
      result.ok
        ? `Texted ${crew.name} — field has the PO.`
        : `Couldn't text ${crew.name} (${result.error ?? "SMS failed"}).`,
    );
  } else if (crew) {
    lines.push(
      crew.phone
        ? `SMS isn't configured — ${crew.name} still sees the PO in the field app.`
        : `${crew.name} has no phone on file — they still see the PO in the field app.`,
    );
  }
  await pushToCrewId(input.crewId, {
    title: `PO ${input.poNumber} received`,
    body: smsBody,
    data: { type: "po_received", jobId: input.jobId },
  });
  return lines;
}

export async function stampJobClientPo(input: {
  jobId: string;
  poNumber: unknown;
  source: string;
}): Promise<StampJobPoResult> {
  const poNumber = normalizePoNumber(input.poNumber);
  if (!poNumber) {
    return { ok: false, status: 400, error: "Enter the PO number.", code: "po_required" };
  }

  const [job] = await db
    .select({
      id: jobsTable.id,
      jobNo: jobsTable.jobNo,
      unitNo: jobsTable.unitNo,
      propertyId: jobsTable.propertyId,
      status: jobsTable.status,
      crewLeaderId: jobsTable.crewLeaderId,
      poNumber: jobsTable.poNumber,
    })
    .from(jobsTable)
    .where(eq(jobsTable.id, input.jobId))
    .limit(1);
  if (!job) return { ok: false, status: 404, error: "That unit is not on the board.", code: "not_found" };

  const [prop] = await db
    .select({ name: propertiesTable.name })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId))
    .limit(1);
  const siteName = prop?.name ?? "Property";
  const unitLabel = (job.unitNo ?? "").trim() || "—";

  if ((job.poNumber ?? "").toUpperCase() === poNumber) {
    return {
      ok: true,
      already: true,
      jobId: job.id,
      jobNo: job.jobNo,
      unitNo: job.unitNo,
      propertyName: siteName,
      poNumber,
      notify: [],
      base44: { ok: true, error: null },
    };
  }

  const stamped = await db.transaction(async (tx) => {
    const updated = await tx
      .update(jobsTable)
      .set({
        poNumber,
        poReceivedAt: new Date(),
        poReceivedSource: input.source,
        poAcknowledgedAt: null,
      })
      .where(
        and(
          eq(jobsTable.id, job.id),
          eq(jobsTable.propertyId, job.propertyId),
          notInArray(jobsTable.status, [...CLOSED_STATUSES]),
        ),
      )
      .returning({ id: jobsTable.id, crewLeaderId: jobsTable.crewLeaderId, jobNo: jobsTable.jobNo });
    const row = updated[0];
    if (!row) return null;
    await tx.insert(activitiesTable).values({
      entityType: "job",
      entityId: job.id,
      kind: "po_received",
      body: `Property sent PO ${poNumber} for ${siteName} · Unit ${unitLabel} (${job.jobNo}) — via ${input.source}.`,
    });
    await tx.insert(notificationsTable).values({
      kind: "po_received",
      priority: "high",
      entityType: "job",
      entityId: job.id,
      title: `PO received · ${siteName} Unit ${unitLabel}`,
      body: `PO ${poNumber} on ${job.jobNo}. Complete final walkthrough and send invoices ASAP.`,
    });
    return row;
  });

  if (!stamped) {
    return {
      ok: false,
      status: 409,
      error: "That unit is no longer live, so the PO was not saved.",
      code: "not_live",
    };
  }

  emitBoardEvent(job.propertyId);

  const maps = await db
    .select({
      resource: base44SyncMapTable.resource,
      base44Id: base44SyncMapTable.base44Id,
    })
    .from(base44SyncMapTable)
    .where(eq(base44SyncMapTable.haloId, job.id));

  let base44: { ok: boolean; error: string | null } = { ok: false, error: null };
  try {
    base44 = await pushPoToBase44({
      poNumber,
      jobNo: job.jobNo,
      unitNo: job.unitNo,
      propertyName: siteName,
      unitId: maps.find((m) => m.resource === "unit_jobs")?.base44Id ?? null,
      crewJobIds: maps.filter((m) => m.resource === "crew_jobs").map((m) => m.base44Id),
    });
  } catch (err) {
    logger.warn({ err, jobId: job.id }, "client-po: Base44 write failed");
    base44 = { ok: false, error: "Work app did not accept the PO yet." };
  }

  const notify = await notifyCrew({
    crewId: stamped.crewLeaderId,
    poNumber,
    propertyName: siteName,
    unitLabel,
    jobId: job.id,
    jobNo: stamped.jobNo,
  });

  return {
    ok: true,
    already: false,
    jobId: job.id,
    jobNo: stamped.jobNo,
    unitNo: job.unitNo,
    propertyName: siteName,
    poNumber,
    notify,
    base44,
  };
}
