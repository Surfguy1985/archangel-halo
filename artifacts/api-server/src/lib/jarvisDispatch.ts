/**
 * Jarvis action executors for HALO Command.
 * Called from dispatchAutoAction after Falkon + identity gates.
 */

import { eq } from "drizzle-orm";
import {
  db,
  activitiesTable,
  calendarEventsTable,
  catalogItemsTable,
  contactsTable,
  crewsTable,
  haloSmsMessagesTable,
  inventoryItemsTable,
  jobsTable,
  notificationsTable,
  propertiesTable,
  purchaseOrdersTable,
  schedulesTable,
  vendorsTable,
  workRequestsTable,
} from "@workspace/db";
import { sendSms, smsEnabled, getTwilioSettings } from "./sms";
import { sendEmail } from "./email";
import { toE164 } from "./smsCore";
import {
  extractUnitLabel,
  formatOrderPacket,
  matchPerson,
  matchUnitJob,
  resolveRelativeDate,
  sourceMaterials,
  sourceVendors,
  type MaterialCandidate,
  type UnitJobCandidate,
  type VendorCandidate,
} from "./jarvisOpsCore";
import { mintPmToken } from "./pmLiveCore";
import { pmLiveLinksTable } from "@workspace/db/schema";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function loadUnitJobs(): Promise<UnitJobCandidate[]> {
  const [jobs, props] = await Promise.all([
    db.select({
      id: jobsTable.id,
      jobNo: jobsTable.jobNo,
      unitNo: jobsTable.unitNo,
      propertyId: jobsTable.propertyId,
      status: jobsTable.status,
      scheduledOn: jobsTable.scheduledOn,
    }).from(jobsTable),
    db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable),
  ]);
  const names = new Map(props.map((p) => [p.id, p.name]));
  return jobs.map((j) => ({
    ...j,
    propertyName: names.get(j.propertyId) ?? "",
  }));
}

async function resolveJobContext(params: Record<string, unknown>, description: string) {
  const blob = `${str(params.unitNo)} ${str(params.body)} ${description}`;
  const unitNo = str(params.unitNo) || extractUnitLabel(blob);
  const jobs = await loadUnitJobs();
  const job = unitNo ? matchUnitJob(unitNo, jobs) : null;
  let property: { id: string; name: string; city: string | null; address: string | null } | undefined;
  const propertyName = str(params.propertyName);
  if (job) {
    const [p] = await db.select({ id: propertiesTable.id, name: propertiesTable.name, city: propertiesTable.city, address: propertiesTable.address })
      .from(propertiesTable).where(eq(propertiesTable.id, job.propertyId)).limit(1);
    property = p;
  } else if (propertyName) {
    const props = await db.select({ id: propertiesTable.id, name: propertiesTable.name, city: propertiesTable.city, address: propertiesTable.address }).from(propertiesTable);
    const hit = matchPerson(propertyName, props);
    property = hit?.record;
  }
  return { unitNo, job, property };
}

export async function executeNoteLog(params: Record<string, unknown>, description: string): Promise<string> {
  const body = str(params.body) || description;
  const { unitNo, job, property } = await resolveJobContext(params, description);
  const entityType = job ? "job" : property ? "property" : "command";
  const entityId = job?.id ?? property?.id ?? "halo";
  await db.insert(activitiesTable).values({
    entityType,
    entityId,
    kind: "note",
    body: unitNo ? `Unit ${unitNo}: ${body}` : body,
  });
  await db.insert(notificationsTable).values({
    kind: "note",
    priority: "normal",
    entityType,
    entityId,
    title: unitNo ? `Note · Unit ${unitNo}` : "HALO note",
    body,
  });
  return `Note logged${unitNo ? ` for unit ${unitNo}` : ""}${job ? ` on ${job.jobNo}` : ""}.`;
}

export async function executeReminderSet(params: Record<string, unknown>, description: string): Promise<string> {
  const title = str(params.title) || description || "HALO reminder";
  const date = str(params.date) || resolveRelativeDate(`${str(params.date)} ${description}`) || resolveRelativeDate("tomorrow");
  if (!date) return "Could not resolve a reminder date.";
  const { job } = await resolveJobContext(params, description);
  await db.insert(calendarEventsTable).values({
    title,
    notes: str(params.notes) || description,
    eventDate: date,
    allDay: true,
    color: "gold",
    jobId: job?.id ?? null,
    crewId: null,
  });
  return `Reminder set for ${date}: ${title}`;
}

export async function executeSupplyOrder(params: Record<string, unknown>, description: string): Promise<string> {
  const material = str(params.material) || str(params.query) || "materials";
  const { unitNo, job, property } = await resolveJobContext(params, description);
  const neededBy = str(params.neededBy) || resolveRelativeDate(description);

  const [catalog, inventory, vendors] = await Promise.all([
    db.select({ id: catalogItemsTable.id, service: catalogItemsTable.service, unit: catalogItemsTable.unit, rate: catalogItemsTable.rate }).from(catalogItemsTable),
    db.select().from(inventoryItemsTable),
    db.select().from(vendorsTable),
  ]);

  const materialPool: MaterialCandidate[] = [
    ...catalog.map((c) => ({ id: c.id, name: c.service, kind: "catalog" as const, unit: c.unit, rate: c.rate })),
    ...inventory.map((i) => ({ id: i.id, name: i.name, kind: "inventory" as const, qty: i.qty, preferredVendor: i.preferredVendor })),
  ];
  const vendorPool: VendorCandidate[] = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    trade: v.trade,
    phone: v.phone,
  }));

  const sourced = sourceMaterials(material, materialPool);
  const nearby = sourceVendors(material, vendorPool, property?.city ?? null);
  const packet = formatOrderPacket({
    material,
    unitNo,
    propertyName: property?.name ?? null,
    city: property?.city ?? null,
    neededBy,
    materials: sourced,
    vendors: nearby,
  });

  let requestId: string | null = null;
  if (property) {
    const [wr] = await db.insert(workRequestsTable).values({
      propertyId: property.id,
      requesterName: "HALO",
      serviceLabel: `Order: ${material}`,
      unitNo: unitNo,
      units: unitNo ? [unitNo] : null,
      notes: packet,
      neededBy,
      emergency: false,
      status: "pending",
      jobId: job?.id ?? null,
    }).returning({ id: workRequestsTable.id });
    requestId = wr?.id ?? null;
  }

  const vendorId = nearby[0]?.id ?? null;
  const poRows = await db.select({ id: purchaseOrdersTable.id }).from(purchaseOrdersTable);
  const poNo = `PO-${String(700 + poRows.length + 1)}`;
  const [po] = await db.insert(purchaseOrdersTable).values({
    poNo,
    vendorId,
    jobId: job?.id ?? null,
    expectedOn: neededBy,
    status: "open",
  }).returning({ id: purchaseOrdersTable.id, poNo: purchaseOrdersTable.poNo });

  await db.insert(activitiesTable).values({
    entityType: job ? "job" : property ? "property" : "command",
    entityId: job?.id ?? property?.id ?? "halo",
    kind: "order",
    body: packet,
  });

  return JSON.stringify({
    type: "supply_order",
    poNo: po?.poNo ?? poNo,
    requestId,
    packet,
    vendors: nearby,
    materials: sourced,
    unitNo,
    propertyName: property?.name ?? null,
    neededBy,
  });
}

export async function executeCrewSms(params: Record<string, unknown>, description: string): Promise<string> {
  const crewName = str(params.crewName) || str(params.name);
  const body = str(params.body) || description;
  const crews = await db.select({ id: crewsTable.id, name: crewsTable.name, phone: crewsTable.phone })
    .from(crewsTable).where(eq(crewsTable.active, true));
  const hit = crewName ? matchPerson(crewName, crews) : null;
  if (!hit) return `No crew member matching "${crewName || "that name"}".`;
  const crew = hit.record;
  if (!crew.phone) {
    return JSON.stringify({ type: "sms_draft", crewName: crew.name, body, sent: false, reason: "No phone on file" });
  }
  if (!(await smsEnabled())) {
    return JSON.stringify({ type: "sms_draft", crewName: crew.name, phone: crew.phone, body, sent: false, reason: "SMS not configured — copy and send manually" });
  }
  const result = await sendSms(crew.phone, body);
  const settings = await getTwilioSettings();
  await db.insert(haloSmsMessagesTable).values({
    direction: "outbound",
    crewId: crew.id,
    fromE164: toE164(settings?.phoneNumber ?? "") ?? "unknown",
    toE164: toE164(crew.phone) ?? crew.phone,
    body,
    status: result.ok ? "sent" : "failed",
  });
  if (!result.ok) {
    return JSON.stringify({ type: "sms_draft", crewName: crew.name, body, sent: false, reason: result.error ?? "Twilio failed" });
  }
  return JSON.stringify({ type: "sms_sent", crewName: crew.name, body, sent: true });
}

export async function executeCrewSchedule(params: Record<string, unknown>, description: string): Promise<string> {
  const crewName = str(params.crewName) || str(params.name);
  const scheduledOn = str(params.scheduledOn) || resolveRelativeDate(description) || resolveRelativeDate("tomorrow");
  if (!scheduledOn) return "Could not resolve an install date.";
  const { unitNo, job, property } = await resolveJobContext(params, description);
  const crews = await db.select().from(crewsTable).where(eq(crewsTable.active, true));
  const hit = crewName ? matchPerson(crewName, crews) : null;
  const crew = hit?.record;

  let target = job;
  if (!target && property) {
    const jobNoRows = await db.select({ id: jobsTable.id }).from(jobsTable);
    const jobNo = `J-${String(2000 + jobNoRows.length + 1)}`;
    const [created] = await db.insert(jobsTable).values({
      jobNo,
      propertyId: property.id,
      unitNo: unitNo,
      category: str(params.material) || "install",
      description,
      status: "scheduled",
      scheduledOn,
      crewLeaderId: crew?.id ?? null,
    }).returning();
    target = created
      ? {
          id: created.id,
          jobNo: created.jobNo,
          unitNo: created.unitNo,
          propertyId: created.propertyId,
          propertyName: property.name,
          status: created.status,
          scheduledOn: created.scheduledOn,
        }
      : null;
  }

  if (!target) return `No job found for unit ${unitNo ?? "unknown"} — name a property or existing unit.`;

  await db.update(jobsTable).set({
    scheduledOn,
    crewLeaderId: crew?.id ?? null,
    status: crew ? "scheduled" : "open",
    crewVacatedAt: null,
  }).where(eq(jobsTable.id, target.id));

  await db.delete(schedulesTable).where(eq(schedulesTable.jobId, target.id));
  if (crew) {
    await db.insert(schedulesTable).values({
      jobId: target.id,
      scheduledOn,
      crewLeaderId: crew.id,
    });
  }

  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: target.id,
    kind: "schedule",
    body: `HALO scheduled ${target.jobNo}${unitNo ? ` (Unit ${unitNo})` : ""} for ${scheduledOn}${crew ? ` · ${crew.name}` : ""}.`,
  });

  return JSON.stringify({
    type: "schedule",
    jobNo: target.jobNo,
    unitNo,
    scheduledOn,
    crewName: crew?.name ?? null,
    propertyName: property?.name ?? target.propertyName,
  });
}

export async function executePmNotify(params: Record<string, unknown>, description: string, baseUrl: string): Promise<string> {
  const { unitNo, job, property } = await resolveJobContext(params, description);
  if (!property) return "Name a property so I can reach the manager.";
  const contacts = await db.select().from(contactsTable).where(eq(contactsTable.propertyId, property.id));
  const pm = contacts.find((c) => /pm|manager|owner|billing/i.test(`${c.role ?? ""} ${c.name}`)) ?? contacts[0];
  const message = str(params.message) || description;

  const minted = mintPmToken();
  const expiresAt = new Date(Date.now() + 24 * 3_600_000);
  await db.insert(pmLiveLinksTable).values({
    token: `h:${minted.tokenHash}`,
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
    propertyId: property.id,
    permissions: { map: true, kanban: true, money: false },
    expiresAt,
    label: `HALO ${unitNo ? `unit ${unitNo}` : "ops"}`,
  });
  const url = `${baseUrl}/live/${minted.token}`;
  const smsText =
    `HALO update${unitNo ? ` · Unit ${unitNo}` : ""} at ${property.name}:\n\n${message}\n\nLive board:\n${url}`;

  let emailed = false;
  if (pm?.email) {
    const sent = await sendEmail({
      to: pm.email,
      subject: `HALO · ${property.name}${unitNo ? ` Unit ${unitNo}` : ""}`,
      html: `<p>${message.replace(/\n/g, "<br/>")}</p><p><a href="${url}">Open live board</a></p>`,
    });
    emailed = sent.ok;
  }

  await db.insert(notificationsTable).values({
    kind: "pm_notify",
    priority: "normal",
    entityType: "property",
    entityId: property.id,
    title: `PM update · ${property.name}`,
    body: message,
  });

  return JSON.stringify({
    type: "live_link",
    kind: "pm_link",
    propertyName: property.name,
    url,
    token: minted.token,
    smsText,
    expiresAt: expiresAt.toISOString(),
    emailed,
    contactName: pm?.name ?? null,
    jobNo: job?.jobNo ?? null,
  });
}
