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

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  base44SyncMapTable,
  propertiesTable,
  crewsTable,
  jobsTable,
  schedulesTable,
  invoicesTable,
  paymentRequestsTable,
  calendarEventsTable,
  priceItemsTable,
  propertyUnitsTable,
  contactsTable,
} from "@workspace/db";
import { logger } from "./logger";
import { randomUUID } from "crypto";

const BASE44_URL = "https://wakeful-ready-track-flow.base44.app/functions/haloRead";
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

/** Resolve a property by its display name (Base44 stores property as a name string). */
async function resolvePropertyByName(name: any): Promise<string | null> {
  if (!name || typeof name !== "string") return null;
  const rows = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.name, name.trim()))
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Resolve a Base44 crew reference to a HALO crew UUID. */
async function resolveCrewId(raw: any): Promise<string | null> {
  const ref = typeof raw === "object" && raw !== null ? (raw._id ?? raw.id ?? raw) : raw;
  if (!ref || typeof ref !== "string") return null;
  return lookupMap("crews", ref);
}

/** Given a Base44 unit ID, return the HALO propertyId for that unit. */
async function resolveUnitPropertyId(base44UnitId: any): Promise<string | null> {
  if (!base44UnitId || typeof base44UnitId !== "string") return null;
  const haloUnitId = await lookupMap("units", base44UnitId);
  if (!haloUnitId) return null;
  const rows = await db
    .select({ propertyId: propertyUnitsTable.propertyId })
    .from(propertyUnitsTable)
    .where(eq(propertyUnitsTable.id, haloUnitId))
    .limit(1);
  return rows[0]?.propertyId ?? null;
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
      // Base44 crews: skills[] → trade, phone may be null, no email field
      const skills = Array.isArray(rec.skills) ? rec.skills : [];
      const payload = {
        name: String(rec.name ?? rec.full_name ?? "Unnamed Crew"),
        phone: rec.phone ?? rec.phone_number ?? null,
        email: rec.email ?? null,
        trade: skills.length > 0 ? skills.join(", ") : (rec.trade ?? rec.specialty ?? null),
        active: rec.active !== false && rec.status !== "inactive",
        hireDate: toDateStr(rec.hire_date ?? rec.hireDate ?? rec.start_date),
        role: rec.role ?? null,
      };
      const existing = await lookupMap("crews", bid);
      if (existing) {
        await db.update(crewsTable).set(payload).where(eq(crewsTable.id, existing));
        updated++;
      } else {
        // Match by name first (phone is often null in Base44)
        const byName = await db
          .select({ id: crewsTable.id })
          .from(crewsTable)
          .where(eq(crewsTable.name, payload.name))
          .limit(1);
        const byPhone = !byName[0] && payload.phone
          ? await db.select({ id: crewsTable.id }).from(crewsTable)
              .where(eq(crewsTable.phone, payload.phone)).limit(1)
          : [];
        const match = byName[0] ?? byPhone[0];
        const haloId = match?.id ?? randomUUID();
        if (match) {
          await db.update(crewsTable).set(payload).where(eq(crewsTable.id, haloId));
          updated++;
        } else {
          await db.insert(crewsTable).values({ id: haloId, ...payload }).onConflictDoNothing();
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

/**
 * Auto-place a new unit in a 5-column grid on the site map.
 * Fractional coords (0–1).  Units are 0.18 wide × 0.08 tall with 0.02 gaps.
 * index = count of units already placed for this property.
 */
function autoUnitPosition(index: number): { x: number; y: number; w: number; h: number } {
  const col = index % 5;
  const row = Math.floor(index / 5);
  return { x: 0.01 + col * 0.20, y: 0.01 + row * 0.10, w: 0.18, h: 0.08 };
}

/**
 * Sync Base44 units → property_units (site map boxes).
 *
 * Three behaviours beyond a plain upsert:
 *
 * 1. POSITION PRESERVATION — existing unit boxes keep the x/y/w/h the user
 *    set in the HALO site-map editor; only label/propertyId are updated.
 *
 * 2. AUTO-LAYOUT — newly created units are placed in a 5-column grid so
 *    they don't all land at (0,0) on first import.
 *
 * 3. REMOVAL SYNC — units deleted from Base44 are deleted from property_units
 *    and their job-board cards are marked "removed".  Only Base44-sourced
 *    units (tracked in the sync map) are ever deleted this way; manually
 *    created HALO units are untouched.
 */
async function syncUnits(records: any[]): Promise<SyncStats & { deleted: number }> {
  let created = 0, updated = 0, errors = 0, deleted = 0;

  // Track Base44 IDs successfully processed in this run.
  const processedB44Ids = new Set<string>();

  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      // Base44 units: property is a string name, unit_number is the label
      const propertyId =
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) continue;
      const label = String(rec.unit_number ?? rec.label ?? rec.name ?? rec.unit_no ?? "");
      if (!label) continue;

      const existing = await lookupMap("units", bid);
      if (existing) {
        // POSITION PRESERVATION: only update label, not coords.
        await db
          .update(propertyUnitsTable)
          .set({ label, propertyId })
          .where(eq(propertyUnitsTable.id, existing));
        updated++;
        processedB44Ids.add(bid);
      } else {
        // New unit — check by label first to avoid duplication.
        const byLabel = await db
          .select({ id: propertyUnitsTable.id, x: propertyUnitsTable.x, y: propertyUnitsTable.y })
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
          // Existing row by label — bind it to the sync map but preserve its position.
          await db
            .update(propertyUnitsTable)
            .set({ label, propertyId })
            .where(eq(propertyUnitsTable.id, haloId));
          updated++;
        } else {
          // Brand-new unit — AUTO-LAYOUT: place in the next grid cell.
          const countRows = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(propertyUnitsTable)
            .where(eq(propertyUnitsTable.propertyId, propertyId));
          const pos = autoUnitPosition(Number(countRows[0]?.count ?? 0));
          await db
            .insert(propertyUnitsTable)
            .values({ id: haloId, propertyId, label, ...pos })
            .onConflictDoNothing();
          created++;
        }
        await saveMap("units", bid, haloId);
        processedB44Ids.add(bid);
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: unit error");
      errors++;
    }
  }

  // ── REMOVAL SYNC ──────────────────────────────────────────────────────────
  // Find all Base44-sourced units in the sync map and delete any that were
  // not in the current Base44 payload (they were removed from Base44).
  try {
    const allMapped = await db
      .select({ base44Id: base44SyncMapTable.base44Id, haloId: base44SyncMapTable.haloId })
      .from(base44SyncMapTable)
      .where(eq(base44SyncMapTable.resource, "units"));

    const stale = allMapped.filter((m) => !processedB44Ids.has(m.base44Id));

    for (const entry of stale) {
      try {
        // Delete the property_units row.
        await db.delete(propertyUnitsTable).where(eq(propertyUnitsTable.id, entry.haloId));

        // Mark the unit-job card "removed" on the board.
        const unitJobId = await lookupMap("unit_jobs", entry.base44Id);
        if (unitJobId) {
          await db
            .update(jobsTable)
            .set({ boardStatus: "removed", status: "cancelled" })
            .where(eq(jobsTable.id, unitJobId));
        }

        // Delete the schedule row if one was created.
        const schedId = await lookupMap("unit_schedules", entry.base44Id);
        if (schedId) {
          await db.delete(schedulesTable).where(eq(schedulesTable.id, schedId));
          await db
            .delete(base44SyncMapTable)
            .where(
              and(
                eq(base44SyncMapTable.resource, "unit_schedules"),
                eq(base44SyncMapTable.base44Id, entry.base44Id),
              ),
            );
        }

        // Remove the sync-map entries for units / unit_jobs.
        await db
          .delete(base44SyncMapTable)
          .where(
            and(
              inArray(base44SyncMapTable.resource, ["units", "unit_jobs"]),
              eq(base44SyncMapTable.base44Id, entry.base44Id),
            ),
          );

        deleted++;
      } catch (err) {
        logger.warn({ err, b44Id: entry.base44Id }, "base44 sync: unit removal error");
        errors++;
      }
    }
  } catch (err) {
    logger.warn({ err }, "base44 sync: stale-unit scan error");
  }

  return { created, updated, errors, deleted };
}

/** Map a Base44 unit status string to the HALO boardStatus that drives rail placement. */
function unitStatusToBoardStatus(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase().trim();
  if (!s || s === "pending" || s === "available" || s === "unassigned") return "active";
  if (s === "assigned" || s === "scheduled" || s === "in_progress") return "filled";
  if (s === "completed" || s === "done") return "completed";
  if (s === "billed" || s === "invoiced") return "billing";
  if (s === "cancelled" || s === "canceled") return "removed";
  return "active";
}

/**
 * Board-status rank — higher means further along in the job lifecycle.
 * The sync never downgrades a card: if HALO is already at rank N, a Base44
 * status at rank < N is ignored so crew progress (photos, line-item
 * completions) is never overwritten by the next pull.
 */
const BOARD_RANK: Record<string, number> = {
  removed:      -1,
  active:        0,
  reopened:      0,
  filled:        1,
  manual_check:  1,
  completed:     2,
  billing:       3,
  pay_alert:     3,
};

function boardRank(s: string | null | undefined): number {
  return BOARD_RANK[s ?? "active"] ?? 0;
}

/**
 * Sync Base44 units as HALO job board cards.
 *
 * Each unit becomes ONE job card on the board.  Two protections are applied:
 *
 * 1. STATUS PROTECTION — the sync never downgrades a card's rail.  If a crew
 *    completed line-items in HALO (card is now "Done"), a subsequent sync that
 *    reads "assigned" from Base44 will not slide the card back to "In progress".
 *    Only an equal-or-higher-rank Base44 status can update boardStatus.
 *
 * 2. SCHEDULE ROWS — when a unit has a crew + date, a row is upserted into the
 *    `schedules` table so the job appears in the crew's guided card and daily
 *    schedule in the crew portal — not just on the office Job Board.
 *
 * Map key: "unit_jobs" (separate from "units" → property_units).
 */
async function syncUnitsAsJobs(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      // Resolve property from the string name Base44 provides.
      const propertyId =
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) continue;

      // Resolve first assigned crew (crew_ids is an array in Base44).
      const crewIds: any[] = Array.isArray(rec.crew_ids) ? rec.crew_ids : [];
      const firstCrewRef = crewIds[0] ?? null;
      const crewLeaderId = firstCrewRef ? await resolveCrewId(firstCrewRef) : null;

      const services = Array.isArray(rec.services_needed) ? rec.services_needed : [];
      const unitNo = String(rec.unit_number ?? rec.unit_no ?? rec.label ?? "").trim() || null;
      const jobNo = unitNo ? `B44-${unitNo}` : `B44-${bid.slice(-6)}`;
      const inboundBoardStatus = unitStatusToBoardStatus(rec.status);
      const scheduledOn = toDateStr(rec.move_in_date ?? rec.scheduled_date ?? rec.date);

      // ── Resolve the HALO job ID ───────────────────────────────────────────
      let haloId = await lookupMap("unit_jobs", bid);
      let isNew = false;
      if (!haloId) {
        const byNo = await db
          .select({ id: jobsTable.id })
          .from(jobsTable)
          .where(eq(jobsTable.jobNo, jobNo))
          .limit(1);
        haloId = byNo[0]?.id ?? randomUUID();
        isNew = !byNo[0];
        await saveMap("unit_jobs", bid, haloId);
      }

      // ── Status-protection: never downgrade an existing card ───────────────
      let boardStatus = inboundBoardStatus;
      if (!isNew) {
        const cur = await db
          .select({ boardStatus: jobsTable.boardStatus })
          .from(jobsTable)
          .where(eq(jobsTable.id, haloId))
          .limit(1);
        const currentRank = boardRank(cur[0]?.boardStatus);
        const inboundRank = boardRank(inboundBoardStatus);
        if (inboundRank < currentRank) {
          // Crew has advanced the card further than Base44 knows — keep HALO's status.
          boardStatus = cur[0]?.boardStatus ?? inboundBoardStatus;
        }
      }

      const status = boardStatus === "completed" || boardStatus === "billing" ? "complete" : "open";
      const payload = {
        jobNo,
        propertyId,
        unitNo,
        category: services[0] ?? null,
        description: services.length > 0 ? services.join(", ") : (rec.notes ?? null),
        status,
        crewLeaderId: crewLeaderId ?? null,
        scheduledOn,
        boardStatus,
      };

      if (isNew) {
        await db.insert(jobsTable).values({ id: haloId, ...payload }).onConflictDoNothing();
        created++;
      } else {
        await db.update(jobsTable).set(payload).where(eq(jobsTable.id, haloId));
        updated++;
      }

      // ── Schedule row: makes the job appear in the crew portal ────────────
      // The crew portal schedule feed is built from the `schedules` table.
      // Without a row here the crew never sees a guided card for this job.
      if (crewLeaderId && scheduledOn) {
        const schedMap = await lookupMap("unit_schedules", bid);
        if (schedMap) {
          // Update the existing schedule row if date/crew changed.
          await db
            .update(schedulesTable)
            .set({ scheduledOn, crewLeaderId, status: status === "complete" ? "complete" : "scheduled" })
            .where(eq(schedulesTable.id, schedMap));
        } else {
          const schedId = randomUUID();
          await db
            .insert(schedulesTable)
            .values({ id: schedId, jobId: haloId, scheduledOn, crewLeaderId, status: "scheduled" })
            .onConflictDoNothing();
          await saveMap("unit_schedules", bid, schedId);
        }
      }
    } catch (err) {
      logger.warn({ err, bid }, "base44 sync: unit_job error");
      errors++;
    }
  }
  return { created, updated, errors };
}

/**
 * Sync Base44 crew_jobs.
 *
 * crew_jobs are payment records tied to a unit (via unit_id).  If the unit
 * was already synced as a job card by syncUnitsAsJobs we enrich that card
 * (crewRate, paid status, crew assignment) rather than create a duplicate.
 * Only when no unit_jobs mapping exists do we create a standalone job.
 */
async function syncCrewJobs(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const crewLeaderId = await resolveCrewId(rec.crew_id ?? rec.crew ?? rec.crewId);
      const crewRate = rec.amount ? Number(rec.amount) : null;
      const paid = !!rec.paid;

      // — Path A: enrich the existing unit-job card ———————————————————————
      if (rec.unit_id) {
        const unitJobId = await lookupMap("unit_jobs", rec.unit_id);
        if (unitJobId) {
          // Patch only the payment-related fields; never overwrite boardStatus
          // unless this payment confirms the work is done.
          const patch: Record<string, unknown> = { crewRate };
          if (crewLeaderId) patch.crewLeaderId = crewLeaderId;
          if (paid) {
            patch.boardStatus = "completed";
            patch.status = "complete";
          }
          await db.update(jobsTable).set(patch).where(eq(jobsTable.id, unitJobId));
          // Record the crew_job → same HALO job link so future syncs find it.
          await saveMap("crew_jobs", bid, unitJobId);
          updated++;
          continue;
        }
      }

      // — Path B: standalone job (no matching unit card) ————————————————
      const propertyId =
        (await resolveUnitPropertyId(rec.unit_id)) ??
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) continue;

      let unitNo: string | null = null;
      if (rec.unit_id) {
        const haloUnitId = await lookupMap("units", rec.unit_id);
        if (haloUnitId) {
          const uRows = await db.select({ label: propertyUnitsTable.label })
            .from(propertyUnitsTable).where(eq(propertyUnitsTable.id, haloUnitId)).limit(1);
          unitNo = uRows[0]?.label ?? null;
        }
      }
      const services = Array.isArray(rec.services_completed) ? rec.services_completed : [];
      const jobNo = String(rec.job_no ?? rec.jobNo ?? `B44-CJ-${bid.slice(-6)}`);
      const payload = {
        jobNo,
        propertyId,
        unitNo: unitNo ?? rec.unit_no ?? null,
        category: services[0] ?? null,
        description: services.length > 0 ? services.join(", ") : null,
        status: paid ? "complete" : "open",
        crewLeaderId: crewLeaderId ?? null,
        scheduledOn: toDateStr(rec.date ?? rec.scheduled_date),
        crewRate,
        boardStatus: paid ? "completed" : "filled",
      };
      const existing = await lookupMap("crew_jobs", bid);
      if (existing) {
        await db.update(jobsTable).set(payload).where(eq(jobsTable.id, existing));
        updated++;
      } else {
        const haloId = randomUUID();
        await db.insert(jobsTable).values({ id: haloId, ...payload }).onConflictDoNothing();
        created++;
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
      // Base44 invoices: property is a string name, invoice_number is the key field
      const propertyId =
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) continue;
      const invoiceNo = String(rec.invoice_number ?? rec.invoice_no ?? rec.invoiceNo ?? bid.slice(-8));
      const payload = {
        invoiceNo,
        propertyId,
        jobId: null,
        amount: Number(rec.amount ?? rec.total ?? 0),
        status: rec.status ?? (rec.date_paid ? "paid" : rec.date_sent ? "sent" : "draft"),
        issuedOn: toDateStr(rec.date_sent ?? rec.issued_date ?? rec.created_date),
        dueAt: null,
        paidAt: toDate(rec.date_paid ?? rec.paid_date ?? rec.paidDate),
        poNumber: rec.po_number ?? rec.poNumber ?? null,
        billToName: rec.property ?? rec.bill_to ?? rec.billTo ?? null,
        notes: rec.notes ?? null,
        taxAmount: 0,
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
      // Base44 payment_requests: property_name is a string, amount in cents
      const propertyId =
        (await resolvePropertyByName(rec.property_name ?? rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) continue;
      const requestNo = String((rec.crew_invoice_number || rec.request_no) ?? rec.requestNo ?? bid.slice(-8));
      const amountDollars = rec.amount_cents != null
        ? Number(rec.amount_cents) / 100
        : Number(rec.total ?? rec.amount ?? 0);
      const payload = {
        requestNo,
        token: rec.token ?? randomUUID(),
        propertyId,
        total: amountDollars,
        memo: rec.scope_summary ?? rec.memo ?? rec.notes ?? null,
        status: rec.state ?? rec.status ?? "draft",
        sentAt: toDate(rec.next_attempt_at ?? rec.sent_at ?? rec.sentAt),
        paidAt: toDate(rec.date_paid ?? rec.paid_at ?? rec.paidAt),
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
      // Base44: services_needed[] → title, property + unit_number as context
      const services = Array.isArray(rec.services_needed) ? rec.services_needed : [];
      const propertyPart = rec.property ? String(rec.property) : null;
      const unitPart = rec.unit_number ? `#${rec.unit_number}` : null;
      const contextParts = [propertyPart, unitPart].filter(Boolean).join(" ");
      const serviceLabel = services.length > 0 ? services.join(", ") : null;
      const title = [serviceLabel ?? rec.title ?? rec.name ?? "Scheduled Work", contextParts]
        .filter(Boolean).join(" — ");
      const noteParts = [
        rec.notes,
        rec.move_type ? `Move type: ${rec.move_type}` : null,
        rec.status ? `Status: ${rec.status}` : null,
      ].filter(Boolean);
      const payload = {
        title,
        notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
        eventDate,
        startTime: rec.start_time ?? rec.startTime ?? rec.time ?? null,
        endTime: rec.end_time ?? rec.endTime ?? null,
        allDay: rec.all_day ?? rec.allDay ?? true,
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
  // Base44 price_items have no property_id — broadcast to all HALO properties
  // so the full price book is available everywhere.
  const allProperties = await db.select({ id: propertiesTable.id }).from(propertiesTable);
  if (allProperties.length === 0) return { created, updated, errors };

  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) continue;
    try {
      const service = String(rec.service ?? rec.name ?? rec.item ?? "");
      if (!service) continue;
      // Base44 uses `price` field, not `rate`
      const rate = Number(rec.price ?? rec.rate ?? rec.unit_price ?? 0);

      for (const prop of allProperties) {
        const payload = {
          propertyId: prop.id,
          service,
          detail: rec.detail ?? rec.description ?? null,
          unit: rec.unit ?? null,
          rate,
          category: rec.category ?? null,
        };
        // The unique index is on (property_id, lower(trim(service))).
        const byService = await db
          .select({ id: priceItemsTable.id })
          .from(priceItemsTable)
          .where(
            and(
              eq(priceItemsTable.propertyId, prop.id),
              sql`lower(trim(${priceItemsTable.service})) = lower(trim(${service}))`,
            ),
          )
          .limit(1);
        const haloId = byService[0]?.id ?? randomUUID();
        if (byService[0]) {
          await db.update(priceItemsTable).set(payload).where(eq(priceItemsTable.id, haloId));
          updated++;
        } else {
          await db.insert(priceItemsTable).values({ id: haloId, ...payload }).onConflictDoNothing();
          created++;
        }
        // Only save map once (for the first property) to keep it idempotent
        if (prop.id === allProperties[0]!.id) {
          await saveMap("price_items", bid, haloId);
        }
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

    // 3. Units → property_units table AND unit_jobs (job board cards).
    //    price_items, calendar_slots, owners run in parallel with units.
    const parallel: Promise<void>[] = [];

    if (data.units?.length) {
      // syncUnits → property_units (unit map grid) + removal pruning
      parallel.push(
        syncUnits(data.units).then((s) => { resources.units = s; logger.info(s, "base44 sync: units done"); }),
      );
    } else {
      // No units in Base44 at all — prune everything previously synced.
      parallel.push(
        syncUnits([]).then((s) => { resources.units = s; logger.info(s, "base44 sync: units done (all removed)"); }),
      );
    }
    if (data.price_items?.length) {
      // price_items are synced sequentially to avoid expression-index conflicts.
      resources.price_items = await syncPriceItems(data.price_items);
      logger.info(resources.price_items, "base44 sync: price_items done");
    }
    if (data.calendar_slots?.length) {
      parallel.push(
        syncCalendarSlots(data.calendar_slots).then((s) => { resources.calendar_slots = s; logger.info(s, "base44 sync: calendar_slots done"); }),
      );
    }
    if (data.owners?.length) {
      parallel.push(
        syncOwners(data.owners, data.properties ?? []).then((s) => { resources.owners = s; logger.info(s, "base44 sync: owners done"); }),
      );
    }

    await Promise.all(parallel);

    // 4. syncUnitsAsJobs — one job board card per Base44 unit.
    //    Runs after syncUnits so the "units" map is populated (needed by
    //    syncCrewJobs which enriches these cards).
    if (data.units?.length) {
      resources.unit_jobs = await syncUnitsAsJobs(data.units);
      logger.info(resources.unit_jobs, "base44 sync: unit_jobs done");
    }

    // 5. crew_jobs enriches the unit-job cards (crewRate, paid status).
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
