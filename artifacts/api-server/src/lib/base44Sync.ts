/**
 * Base44 → HALO one-way sync.
 *
 * Pulls the read-only snapshot from the Base44 "haloRead" function and
 * upserts each entity into the correct HALO table.  A side-table
 * (base44_sync_map) tracks Base44-ID → HALO-UUID so every re-sync is
 * idempotent and we never add external-ID columns to production tables.
 *
 * Execution order matters: properties and crews are synced first because
 * units, jobs, invoices, price_items, etc. need resolved HALO UUIDs.
 */

import { and, eq, sql } from "drizzle-orm";
import {
  db,
  base44SyncMapTable,
  propertiesTable,
  crewsTable,
  jobsTable,
  invoicesTable,
  paymentRequestsTable,
  calendarEventsTable,
  priceItemsTable,
  propertyUnitsTable,
  contactsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { randomUUID } from "crypto";

const BASE44_URL = "https://wakeful-ready-track-flow.base44.app/api/apps/wakeful-ready-track-flow/functions/haloRead";
const TOKEN = process.env.HALO_READ_TOKEN ?? "";

// Mutual-exclusion flag so a slow sync can't overlap itself.
let syncRunning = false;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Extract the Base44 entity ID from a record (supports _id and id). */
function b44Id(rec: Record<string, any>): string | null {
  return (rec._id ?? rec.id ?? null) as string | null;
}

/** Read the HALO UUID we previously assigned to a Base44 entity. */
async function lookupMap(resource: string, base44id: string): Promise<string | null> {
  const rows = await db
    .select({ haloId: base44SyncMapTable.haloId })
    .from(base44SyncMapTable)
    .where(
      and(
        eq(base44SyncMapTable.resource, resource),
        eq(base44SyncMapTable.base44Id, base44id),
      ),
    )
    .limit(1);
  return rows[0]?.haloId ?? null;
}

/** Write (or refresh) a Base44-ID → HALO-UUID mapping. */
async function saveMap(resource: string, base44id: string, haloId: string): Promise<void> {
  await db
    .insert(base44SyncMapTable)
    .values({ resource, base44Id: base44id, haloId, syncedAt: new Date() })
    .onConflictDoUpdate({
      target: [base44SyncMapTable.resource, base44SyncMapTable.base44Id],
      set: { haloId, syncedAt: new Date() },
    });
}

/** Coerce a Base44 date string / timestamp to a JS Date or null. */
function toDate(v: any): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/** Coerce to a YYYY-MM-DD string or null. */
function toDateStr(v: any): string | null {
  const d = toDate(v);
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

/** Resolve a Base44 property reference (id string or nested object) to a HALO property UUID. */
async function resolvePropertyId(raw: any): Promise<string | null> {
  const ref = typeof raw === "object" && raw !== null ? (raw._id ?? raw.id ?? raw) : raw;
  if (!ref || typeof ref !== "string") return null;
  return lookupMap("properties", ref);
}

/** Resolve a Base44 crew reference to a HALO crew UUID. */
async function resolveCrewId(raw: any): Promise<string | null> {
  const ref = typeof raw === "object" && raw !== null ? (raw._id ?? raw.id ?? raw) : raw;
  if (!ref || typeof ref !== "string") return null;
  return lookupMap("crews", ref);
}

// ─── fetch ───────────────────────────────────────────────────────────────────

async function fetchBase44(): Promise<Record<string, any[]>> {
  if (!TOKEN) throw new Error("HALO_READ_TOKEN not set");
  const resp = await fetch(BASE44_URL, {
    headers: { "x-halo-token": TOKEN },
  });
  if (!resp.ok) throw new Error(`Base44 returned ${resp.status}`);
  const body = await resp.json() as { data: Record<string, any> };
  const out: Record<string, any[]> = {};
  for (const [k, v] of Object.entries(body.data ?? {})) {
    out[k] = Array.isArray(v) ? v : [];
  }
  return out;
}

// ─── per-entity sync functions ───────────────────────────────────────────────

async function syncProperties(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const payload = {
        name: String(rec.name ?? rec.property_name ?? "Unnamed Property"),
        address: rec.address ?? rec.street_address ?? null,
        city: rec.city ?? null,
        units: rec.units ?? rec.unit_count ?? null,
        pmcName: rec.pmc_name ?? rec.management_company ?? rec.owner_name ?? null,
        status: rec.status === "inactive" ? "inactive" : "active",
      };
      const existing = await lookupMap("properties", bid);
      if (existing) {
        await db.update(propertiesTable).set(payload).where(eq(propertiesTable.id, existing));
        updated++;
      } else {
        // Check by name to avoid creating duplicates for records imported before the sync.
        const byName = await db
          .select({ id: propertiesTable.id })
          .from(propertiesTable)
          .where(eq(propertiesTable.name, payload.name))
          .limit(1);
        const haloId = byName[0]?.id ?? randomUUID();
        if (byName[0]) {
          await db.update(propertiesTable).set(payload).where(eq(propertiesTable.id, haloId));
          updated++;
        } else {
          await db.insert(propertiesTable).values({ id: haloId, ...payload }).onConflictDoNothing();
          created++;
        }
        await saveMap("properties", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: property error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncCrews(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const payload = {
        name: String(rec.name ?? rec.full_name ?? "Unnamed Crew"),
        phone: rec.phone ?? rec.phone_number ?? null,
        email: rec.email ?? null,
        trade: rec.trade ?? rec.specialty ?? null,
        active: rec.active !== false && rec.status !== "inactive",
        hireDate: toDateStr(rec.hire_date ?? rec.hireDate ?? rec.start_date),
        role: rec.role ?? null,
      };
      const existing = await lookupMap("crews", bid);
      if (existing) {
        await db.update(crewsTable).set(payload).where(eq(crewsTable.id, existing));
        updated++;
      } else {
        // Try to match by phone to avoid duplicates.
        const byPhone = payload.phone
          ? await db
              .select({ id: crewsTable.id })
              .from(crewsTable)
              .where(eq(crewsTable.phone, payload.phone))
              .limit(1)
          : [];
        const haloId = byPhone[0]?.id ?? randomUUID();
        if (byPhone[0]) {
          await db.update(crewsTable).set(payload).where(eq(crewsTable.id, haloId));
          updated++;
        } else {
          await db
            .insert(crewsTable)
            .values({ id: haloId, ...payload })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("crews", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: crew error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncUnits(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const propertyId = await resolvePropertyId(rec.property_id ?? rec.property ?? rec.propertyId);
      if (!propertyId) continue; // can't place without a property
      const label = String(rec.label ?? rec.unit_number ?? rec.name ?? rec.unit_no ?? "");
      if (!label) continue;
      const payload = {
        propertyId,
        label,
        x: Number(rec.x ?? 0),
        y: Number(rec.y ?? 0),
        w: Number(rec.w ?? 0.1),
        h: Number(rec.h ?? 0.08),
      };
      const existing = await lookupMap("units", bid);
      if (existing) {
        await db.update(propertyUnitsTable).set(payload).where(eq(propertyUnitsTable.id, existing));
        updated++;
      } else {
        const byLabel = await db
          .select({ id: propertyUnitsTable.id })
          .from(propertyUnitsTable)
          .where(
            and(
              eq(propertyUnitsTable.propertyId, propertyId),
              eq(propertyUnitsTable.label, label),
            ),
          )
          .limit(1);
        const haloId = byLabel[0]?.id ?? randomUUID();
        if (byLabel[0]) {
          await db.update(propertyUnitsTable).set(payload).where(eq(propertyUnitsTable.id, haloId));
          updated++;
        } else {
          await db
            .insert(propertyUnitsTable)
            .values({ id: haloId, ...payload })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("units", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: unit error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncCrewJobs(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const propertyId = await resolvePropertyId(rec.property_id ?? rec.property ?? rec.propertyId);
      if (!propertyId) continue;
      const crewLeaderId = await resolveCrewId(rec.crew_id ?? rec.crew ?? rec.crewId);
      const jobNo = String(rec.job_no ?? rec.jobNo ?? rec.job_number ?? bid.slice(-6));
      const payload = {
        jobNo,
        propertyId,
        unitNo: rec.unit ?? rec.unit_no ?? rec.unitNo ?? null,
        category: rec.category ?? rec.type ?? rec.trade ?? null,
        description: rec.description ?? rec.notes ?? null,
        status: rec.status ?? "open",
        crewLeaderId: crewLeaderId ?? null,
        scheduledOn: toDateStr(rec.date ?? rec.scheduled_date ?? rec.scheduledDate),
        boardStatus: rec.board_status ?? rec.boardStatus ?? "active",
      };
      const existing = await lookupMap("crew_jobs", bid);
      if (existing) {
        await db.update(jobsTable).set(payload).where(eq(jobsTable.id, existing));
        updated++;
      } else {
        const byNo = await db
          .select({ id: jobsTable.id })
          .from(jobsTable)
          .where(eq(jobsTable.jobNo, jobNo))
          .limit(1);
        const haloId = byNo[0]?.id ?? randomUUID();
        if (byNo[0]) {
          await db.update(jobsTable).set(payload).where(eq(jobsTable.id, haloId));
          updated++;
        } else {
          await db
            .insert(jobsTable)
            .values({ id: haloId, ...payload })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("crew_jobs", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: crew_job error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncInvoices(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const propertyId = await resolvePropertyId(rec.property_id ?? rec.property ?? rec.propertyId);
      if (!propertyId) continue;
      const jobId = await (async () => {
        const ref = rec.job_id ?? rec.job ?? rec.jobId;
        if (!ref) return null;
        const id = typeof ref === "object" ? (ref._id ?? ref.id) : ref;
        return id ? lookupMap("crew_jobs", id) : null;
      })();
      const invoiceNo = String(rec.invoice_no ?? rec.invoiceNo ?? rec.number ?? bid.slice(-8));
      const payload = {
        invoiceNo,
        propertyId,
        jobId: jobId ?? null,
        amount: Number(rec.amount ?? rec.total ?? 0),
        status: rec.status ?? "draft",
        issuedOn: toDateStr(rec.issued_date ?? rec.issuedDate ?? rec.created_date),
        dueAt: toDate(rec.due_date ?? rec.dueDate ?? rec.due_at),
        paidAt: toDate(rec.paid_date ?? rec.paidDate ?? rec.paid_at),
        poNumber: rec.po_number ?? rec.poNumber ?? null,
        billToName: rec.bill_to ?? rec.billTo ?? rec.client_name ?? null,
        notes: rec.notes ?? rec.memo ?? null,
        taxAmount: Number(rec.tax ?? rec.tax_amount ?? rec.taxAmount ?? 0),
      };
      const existing = await lookupMap("invoices", bid);
      if (existing) {
        await db.update(invoicesTable).set(payload).where(eq(invoicesTable.id, existing));
        updated++;
      } else {
        const byNo = await db
          .select({ id: invoicesTable.id })
          .from(invoicesTable)
          .where(eq(invoicesTable.invoiceNo, invoiceNo))
          .limit(1);
        const haloId = byNo[0]?.id ?? randomUUID();
        if (byNo[0]) {
          await db.update(invoicesTable).set(payload).where(eq(invoicesTable.id, haloId));
          updated++;
        } else {
          await db
            .insert(invoicesTable)
            .values({ id: haloId, ...payload })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("invoices", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: invoice error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncPaymentRequests(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const propertyId = await resolvePropertyId(rec.property_id ?? rec.property ?? rec.propertyId);
      if (!propertyId) continue;
      const requestNo = String(rec.request_no ?? rec.requestNo ?? rec.number ?? bid.slice(-8));
      const payload = {
        requestNo,
        token: rec.token ?? randomUUID(),
        propertyId,
        total: Number(rec.total ?? rec.amount ?? 0),
        memo: rec.memo ?? rec.notes ?? null,
        status: rec.status ?? "draft",
        sentAt: toDate(rec.sent_at ?? rec.sentAt),
        paidAt: toDate(rec.paid_at ?? rec.paidAt),
      };
      const existing = await lookupMap("payment_requests", bid);
      if (existing) {
        await db
          .update(paymentRequestsTable)
          .set(payload)
          .where(eq(paymentRequestsTable.id, existing));
        updated++;
      } else {
        const byNo = await db
          .select({ id: paymentRequestsTable.id })
          .from(paymentRequestsTable)
          .where(eq(paymentRequestsTable.requestNo, requestNo))
          .limit(1);
        const haloId = byNo[0]?.id ?? randomUUID();
        if (byNo[0]) {
          await db
            .update(paymentRequestsTable)
            .set(payload)
            .where(eq(paymentRequestsTable.id, haloId));
          updated++;
        } else {
          await db
            .insert(paymentRequestsTable)
            .values({ id: haloId, ...payload })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("payment_requests", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: payment_request error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncCalendarSlots(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const eventDate = toDateStr(rec.date ?? rec.event_date ?? rec.eventDate ?? rec.start_date);
      if (!eventDate) continue;
      const crewId = await resolveCrewId(rec.crew_id ?? rec.crew ?? rec.crewId);
      const payload = {
        title: String(rec.title ?? rec.name ?? rec.description ?? "Event"),
        notes: rec.notes ?? rec.description ?? null,
        eventDate,
        startTime: rec.start_time ?? rec.startTime ?? rec.time ?? null,
        endTime: rec.end_time ?? rec.endTime ?? null,
        allDay: rec.all_day ?? rec.allDay ?? false,
        crewId: crewId ?? null,
        color: rec.color ?? "gold",
      };
      const existing = await lookupMap("calendar_slots", bid);
      if (existing) {
        await db
          .update(calendarEventsTable)
          .set(payload)
          .where(eq(calendarEventsTable.id, existing));
        updated++;
      } else {
        const haloId = randomUUID();
        await db
          .insert(calendarEventsTable)
          .values({ id: haloId, ...payload })
          .onConflictDoNothing();
        created++;
        await saveMap("calendar_slots", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: calendar_slot error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncPriceItems(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const propertyId = await resolvePropertyId(rec.property_id ?? rec.property ?? rec.propertyId);
      if (!propertyId) continue;
      const service = String(rec.service ?? rec.name ?? rec.item ?? "");
      if (!service) continue;
      const payload = {
        propertyId,
        service,
        detail: rec.detail ?? rec.description ?? null,
        unit: rec.unit ?? null,
        rate: Number(rec.rate ?? rec.price ?? rec.unit_price ?? 0),
        category: rec.category ?? null,
      };
      const existing = await lookupMap("price_items", bid);
      if (existing) {
        await db.update(priceItemsTable).set(payload).where(eq(priceItemsTable.id, existing));
        updated++;
      } else {
        // The unique index is on (property_id, lower(trim(service))) — an expression
        // index that drizzle can't target directly.  Do a manual check+upsert instead.
        const byService = await db
          .select({ id: priceItemsTable.id })
          .from(priceItemsTable)
          .where(
            and(
              eq(priceItemsTable.propertyId, propertyId),
              sql`lower(trim(${priceItemsTable.service})) = lower(trim(${service}))`,
            ),
          )
          .limit(1);
        const haloId = byService[0]?.id ?? randomUUID();
        if (byService[0]) {
          await db.update(priceItemsTable).set(payload).where(eq(priceItemsTable.id, haloId));
          updated++;
        } else {
          await db
            .insert(priceItemsTable)
            .values({ id: haloId, ...payload })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("price_items", bid, haloId);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: price_item error");
      errors++;
    }
  }
  return { created, updated, errors };
}

async function syncOwners(records: any[], propertyRecords: any[]): Promise<SyncStats> {
  // Owners in Base44 = property managers / client contacts.
  // Strategy: if an owner is linked to a property, update propertiesTable.pmcName
  // and upsert a contact row.  Standalone owners become contact rows.
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const name = String(rec.name ?? rec.company ?? rec.full_name ?? "");
      const email = rec.email ?? null;
      const phone = rec.phone ?? rec.phone_number ?? null;

      // Update pmcName on any property that references this owner.
      const ownedProps = propertyRecords.filter((p) => {
        const ownerId = p.owner_id ?? p.owner?._id ?? p.owner?.id ?? p.owner;
        return ownerId === bid;
      });
      for (const prop of ownedProps) {
        const haloPropertyId = await resolvePropertyId(b44Id(prop));
        if (haloPropertyId && name) {
          await db
            .update(propertiesTable)
            .set({ pmcName: name })
            .where(eq(propertiesTable.id, haloPropertyId));
        }
      }

      // Also upsert as a contact (contacts table stores PM / owner contacts).
      const existing = await lookupMap("owners", bid);
      if (existing) {
        await db
          .update(contactsTable)
          .set({ name, email, phone })
          .where(eq(contactsTable.id, existing));
        updated++;
      } else {
        const haloId = randomUUID();
        // contactsTable has name, email, phone, propertyId (required on insert)
        // link to first owned property if available; otherwise skip.
        const firstPropId = ownedProps.length
          ? await resolvePropertyId(b44Id(ownedProps[0]))
          : null;
        if (firstPropId) {
          await db
            .insert(contactsTable)
            .values({ id: haloId, name, email, phone, propertyId: firstPropId })
            .onConflictDoNothing();
          created++;
          await saveMap("owners", bid, haloId);
        }
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: owner error");
      errors++;
    }
  }
  return { created, updated, errors };
}

// ─── main export ─────────────────────────────────────────────────────────────

export interface SyncStats {
  created: number;
  updated: number;
  errors: number;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  resources: Record<string, SyncStats>;
  totalCreated: number;
  totalUpdated: number;
  totalErrors: number;
}

let lastSyncResult: SyncResult | null = null;

export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

export async function runBase44Sync(): Promise<SyncResult> {
  if (syncRunning) {
    logger.info("base44 sync: already running — skip");
    return lastSyncResult ?? { startedAt: "", finishedAt: "", durationMs: 0, resources: {}, totalCreated: 0, totalUpdated: 0, totalErrors: 0 };
  }
  syncRunning = true;
  const startedAt = new Date();
  logger.info("base44 sync: starting");

  const resources: Record<string, SyncStats> = {};
  try {
    const data = await fetchBase44();

    // 1. Sync properties first (others depend on resolved property IDs).
    if (data.properties?.length) {
      resources.properties = await syncProperties(data.properties);
      logger.info(resources.properties, "base44 sync: properties done");
    }

    // 2. Sync crews (jobs depend on resolved crew IDs).
    if (data.crews?.length) {
      resources.crews = await syncCrews(data.crews);
      logger.info(resources.crews, "base44 sync: crews done");
    }

    // 3. Units, price_items, calendar_slots, jobs, invoices, payment_requests
    //    (all reference properties / crews).
    const parallel: Promise<void>[] = [];

    if (data.units?.length) {
      parallel.push(
        syncUnits(data.units).then((s) => { resources.units = s; logger.info(s, "base44 sync: units done"); }),
      );
    }
    if (data.price_items?.length) {
      // price_items are synced sequentially (not parallel) to avoid hitting
      // the expression-index unique constraint from concurrent inserts.
      resources.price_items = await syncPriceItems(data.price_items);
      logger.info(resources.price_items, "base44 sync: price_items done");
    }
    if (data.calendar_slots?.length) {
      parallel.push(
        syncCalendarSlots(data.calendar_slots).then((s) => { resources.calendar_slots = s; logger.info(s, "base44 sync: calendar_slots done"); }),
      );
    }

    // Owners patch properties, so run after properties.
    if (data.owners?.length) {
      parallel.push(
        syncOwners(data.owners, data.properties ?? []).then((s) => { resources.owners = s; logger.info(s, "base44 sync: owners done"); }),
      );
    }

    await Promise.all(parallel);

    // 4. crew_jobs after properties + crews.
    if (data.crew_jobs?.length) {
      resources.crew_jobs = await syncCrewJobs(data.crew_jobs);
      logger.info(resources.crew_jobs, "base44 sync: crew_jobs done");
    }

    // 5. Invoices and payment_requests after jobs.
    const parallel2: Promise<void>[] = [];
    if (data.invoices?.length) {
      parallel2.push(
        syncInvoices(data.invoices).then((s) => { resources.invoices = s; logger.info(s, "base44 sync: invoices done"); }),
      );
    }
    if (data.payment_requests?.length) {
      parallel2.push(
        syncPaymentRequests(data.payment_requests).then((s) => { resources.payment_requests = s; logger.info(s, "base44 sync: payment_requests done"); }),
      );
    }
    await Promise.all(parallel2);
  } catch (err) {
    logger.error({ err }, "base44 sync: fetch or top-level error");
    resources._error = { created: 0, updated: 0, errors: 1 };
  } finally {
    syncRunning = false;
  }

  const finishedAt = new Date();
  const result: SyncResult = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    resources,
    totalCreated: Object.values(resources).reduce((s, r) => s + r.created, 0),
    totalUpdated: Object.values(resources).reduce((s, r) => s + r.updated, 0),
    totalErrors: Object.values(resources).reduce((s, r) => s + r.errors, 0),
  };
  lastSyncResult = result;
  logger.info(
    { durationMs: result.durationMs, totalCreated: result.totalCreated, totalUpdated: result.totalUpdated },
    "base44 sync: complete",
  );
  return result;
}
