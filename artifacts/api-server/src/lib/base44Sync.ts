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

import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  base44SyncMapTable,
  base44SyncRunsTable,
  base44EvidenceTable,
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
import { Base44ClientError, fetchBase44Snapshot } from "./base44Client";
import { ensureBase44Schema } from "./ensureBase44Schema";
import {
  applyIngest,
  computeFreshness,
  parseBase44Body,
  shouldApplyCollection,
  type CollectionPresence,
  type Freshness,
  type IngestState,
  type MapEntry,
  type ProjectionRecord,
  type SyncErrorCode,
  mapKey,
} from "./base44SyncCore";

// Mutual-exclusion flag so a slow sync can't overlap itself.
let syncRunning = false;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Extract the Base44 entity ID from a record (supports _id and id). */
function b44Id(rec: Record<string, any>): string | null {
  return (rec._id ?? rec.id ?? null) as string | null;
}

/** Read the HALO UUID we previously assigned to a Base44 entity. */
// Skip accounting (noteSkip & friends) lives in base44SyncSkips.ts so the
// behaviour is locked in by unit tests without a database. Every guard clause
// in the sync functions below must call noteSkip — never a bare `continue` —
// or upstream rows silently vanish (undetected for 881 runs once already).
import {
  foldSkipsIntoResources,
  getLastSyncSkips,
  getSkipSummary,
  noteSkip,
  resetSkips,
  type SyncSkip,
} from "./base44SyncSkips";

export { getLastSyncSkips, type SyncSkip };

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
  const now = new Date();
  await db
    .insert(base44SyncMapTable)
    .values({
      resource,
      base44Id: base44id,
      haloId,
      syncedAt: now,
      lastSeenAt: now,
      staleAt: null,
      status: "active",
    })
    .onConflictDoUpdate({
      target: [base44SyncMapTable.resource, base44SyncMapTable.base44Id],
      set: {
        haloId,
        syncedAt: now,
        lastSeenAt: now,
        staleAt: null,
        status: "active",
      },
    });
}

async function markMappedStale(resource: string, liveIds: Set<string>): Promise<number> {
  const allMapped = await db
    .select({
      base44Id: base44SyncMapTable.base44Id,
      haloId: base44SyncMapTable.haloId,
      status: base44SyncMapTable.status,
    })
    .from(base44SyncMapTable)
    .where(eq(base44SyncMapTable.resource, resource));
  const now = new Date();
  let n = 0;
  for (const entry of allMapped) {
    if (liveIds.has(entry.base44Id)) continue;
    if (entry.status === "stale") continue;
    await db
      .update(base44SyncMapTable)
      .set({ status: "stale", staleAt: now })
      .where(
        and(
          eq(base44SyncMapTable.resource, resource),
          eq(base44SyncMapTable.base44Id, entry.base44Id),
        ),
      );
    n++;
  }
  return n;
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

async function loadIngestState(): Promise<IngestState> {
  const rows = await db
    .select({
      resource: base44SyncMapTable.resource,
      base44Id: base44SyncMapTable.base44Id,
      status: base44SyncMapTable.status,
      payloadHash: base44SyncMapTable.payloadHash,
      lastSeenAt: base44SyncMapTable.lastSeenAt,
      staleAt: base44SyncMapTable.staleAt,
      sourceUpdatedAt: base44SyncMapTable.sourceUpdatedAt,
    })
    .from(base44SyncMapTable);
  const maps = new Map<string, MapEntry>();
  for (const row of rows) {
    maps.set(mapKey(row.resource, row.base44Id), {
      resource: row.resource,
      base44Id: row.base44Id,
      status: row.status === "stale" ? "stale" : "active",
      payloadHash: row.payloadHash ?? "",
      lastSeenAt: row.lastSeenAt?.toISOString() ?? new Date(0).toISOString(),
      staleAt: row.staleAt?.toISOString() ?? null,
      sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    });
  }
  return { maps };
}

async function persistEvidence(records: ProjectionRecord[], now: Date): Promise<void> {
  for (const row of records) {
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
        occurredAt: row.occurredAt ? new Date(row.occurredAt) : null,
        sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null,
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
          unitLabel: row.unitLabel,
          title: row.title,
          body: row.body,
          mediaUrl: row.mediaUrl,
          occurredAt: row.occurredAt ? new Date(row.occurredAt) : null,
          sourceUpdatedAt: row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null,
          lastSeenAt: now,
          stale: false,
          payloadHash: row.payloadHash,
          updatedAt: now,
        },
      });
  }
}

async function persistMapStatuses(state: IngestState): Promise<void> {
  for (const entry of state.maps.values()) {
    const existing = await lookupMap(entry.resource, entry.base44Id);
    const haloId = existing ?? randomUUID();
    const now = new Date(entry.lastSeenAt);
    await db
      .insert(base44SyncMapTable)
      .values({
        resource: entry.resource,
        base44Id: entry.base44Id,
        haloId,
        syncedAt: now,
        lastSeenAt: now,
        staleAt: entry.staleAt ? new Date(entry.staleAt) : null,
        sourceUpdatedAt: entry.sourceUpdatedAt ? new Date(entry.sourceUpdatedAt) : null,
        status: entry.status,
        payloadHash: entry.payloadHash || null,
      })
      .onConflictDoUpdate({
        target: [base44SyncMapTable.resource, base44SyncMapTable.base44Id],
        set: {
          lastSeenAt: now,
          staleAt: entry.staleAt ? new Date(entry.staleAt) : null,
          sourceUpdatedAt: entry.sourceUpdatedAt ? new Date(entry.sourceUpdatedAt) : null,
          status: entry.status,
          payloadHash: entry.payloadHash || null,
          syncedAt: now,
        },
      });
  }
}

async function markEvidenceStale(state: IngestState): Promise<void> {
  for (const entry of state.maps.values()) {
    if (entry.status !== "stale") continue;
    await db
      .update(base44EvidenceTable)
      .set({ stale: true, updatedAt: new Date() })
      .where(
        and(
          eq(base44EvidenceTable.resource, entry.resource),
          eq(base44EvidenceTable.base44Id, entry.base44Id),
        ),
      );
  }
}

// ─── per-entity sync functions ───────────────────────────────────────────────

async function syncProperties(records: any[]): Promise<SyncStats> {
  let created = 0, updated = 0, errors = 0;
  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) { noteSkip("properties", null, "missing_id"); continue; }
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
    if (!bid) { noteSkip("crews", null, "missing_id"); continue; }
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
 * 3. STALE MARKING — units missing from a successful non-empty Base44
 *    payload are marked stale in the sync map. HALO rows are never deleted
 *    by a sync (empty/missing payloads never prune).
 */
async function syncUnits(records: any[]): Promise<SyncStats & { stale: number }> {
  let created = 0, updated = 0, errors = 0, stale = 0;

  // Track Base44 IDs successfully processed in this run.
  const processedB44Ids = new Set<string>();

  for (const rec of records) {
    const bid = b44Id(rec);
    if (!bid) { noteSkip("units", null, "missing_id"); continue; }
    try {
      // Base44 units: property is a string name, unit_number is the label
      const propertyId =
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) { noteSkip("units", bid, "unresolved_property"); continue; }
      const label = String(rec.unit_number ?? rec.label ?? rec.name ?? rec.unit_no ?? "");
      if (!label) { noteSkip("units", bid, "missing_label"); continue; }

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

  // ── STALE MARKING ─────────────────────────────────────────────────────────
  // Never delete operational rows. A successful non-empty collection may
  // mark mapped units that vanished from Base44 as stale.
  try {
    stale = await markMappedStale("units", processedB44Ids);
  } catch (err) {
    logger.warn({ err }, "base44 sync: stale-unit scan error");
  }

  return { created, updated, errors, stale };
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
    if (!bid) { noteSkip("unit_jobs", null, "missing_id"); continue; }
    try {
      // Resolve property from the string name Base44 provides.
      const propertyId =
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) { noteSkip("unit_jobs", bid, "unresolved_property"); continue; }

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
    if (!bid) { noteSkip("crew_jobs", null, "missing_id"); continue; }
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
      let existing = await lookupMap("crew_jobs", bid);
      let propertyId =
        (await resolveUnitPropertyId(rec.unit_id)) ??
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));

      // RESCUE 1 — last known placement. If this crew_job was already filed
      // into HALO on an earlier run (before its unit vanished upstream), the
      // existing job row remembers the property. A dead unit_id must not
      // orphan a record we have already placed correctly.
      if (!propertyId && existing) {
        const prev = await db
          .select({ propertyId: jobsTable.propertyId })
          .from(jobsTable)
          .where(eq(jobsTable.id, existing))
          .limit(1);
        if (prev[0] && prev[0].propertyId) {
          // The job is already filed. It may have been created by the
          // unit-card path (its own jobNo, board progress), so patch only the
          // payment fields — exactly like Path A — instead of overwriting it.
          const patch: Record<string, unknown> = { crewRate };
          if (crewLeaderId) patch.crewLeaderId = crewLeaderId;
          if (paid) {
            patch.boardStatus = "completed";
            patch.status = "complete";
          }
          await db.update(jobsTable).set(patch).where(eq(jobsTable.id, existing));
          updated++;
          continue;
        }
        // Map points at a job that no longer exists — treat as unmapped.
        existing = null;
      }

      // RESCUE 2 — infer from the crew's other work that day. Only accepted
      // when it is unambiguous: every HALO job for this crew on this date is
      // at ONE property. Anything ambiguous stays unplaced — never guess.
      const workDate = toDateStr(rec.date ?? rec.scheduled_date);
      if (!propertyId && crewLeaderId && workDate) {
        const sameDay = await db
          .select({ propertyId: jobsTable.propertyId })
          .from(jobsTable)
          .where(
            and(
              eq(jobsTable.crewLeaderId, crewLeaderId),
              eq(jobsTable.scheduledOn, workDate),
            ),
          );
        const distinct = [...new Set(sameDay.map((r) => r.propertyId).filter(Boolean))];
        if (distinct.length === 1) propertyId = distinct[0] as string;
      }

      if (!propertyId) { noteSkip("crew_jobs", bid, "unresolved_property"); continue; }

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
      // Only write unitNo when we actually resolved one — a dead unit_id must
      // not blank the label a previous run (or the office) already stored.
      const resolvedUnitNo: string | null = unitNo ?? rec.unit_no ?? null;
      const payload = {
        jobNo,
        propertyId,
        category: services[0] ?? null,
        description: services.length > 0 ? services.join(", ") : null,
        status: paid ? "complete" : "open",
        crewLeaderId: crewLeaderId ?? null,
        scheduledOn: workDate,
        crewRate,
        boardStatus: paid ? "completed" : "filled",
        ...(resolvedUnitNo || !existing ? { unitNo: resolvedUnitNo } : {}),
      };
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
    if (!bid) { noteSkip("invoices", null, "missing_id"); continue; }
    try {
      // Base44 invoices: property is a string name, invoice_number is the key field
      const propertyId =
        (await resolvePropertyByName(rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) { noteSkip("invoices", bid, "unresolved_property"); continue; }
      const invoiceNo = String(rec.invoice_number ?? rec.invoice_no ?? rec.invoiceNo ?? bid.slice(-8));
      // Try to link to a specific job via unit_id / unit_number → unit_jobs map.
      let jobId: string | null = null;
      const rawUnitId = rec.unit_id ?? rec.unitId;
      if (rawUnitId) {
        jobId = await lookupMap("unit_jobs", String(rawUnitId));
      }
      if (!jobId && (rec.unit_no ?? rec.unit_number) && propertyId) {
        const uRows = await db
          .select({ id: jobsTable.id })
          .from(jobsTable)
          .where(and(eq(jobsTable.propertyId, propertyId), eq(jobsTable.unitNo, String(rec.unit_no ?? rec.unit_number))))
          .orderBy(desc(jobsTable.createdAt))
          .limit(1);
        jobId = uRows[0]?.id ?? null;
      }

      const payload = {
        invoiceNo,
        propertyId,
        jobId,
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

      // When a Base44 invoice is paid and linked to a job, advance the job
      // card to "billing" so the office board reflects the real pay state.
      // Never downgrade — guard with boardRank.
      const isPaid = payload.status === "paid" || !!payload.paidAt;
      if (jobId && isPaid) {
        const cur = await db
          .select({ boardStatus: jobsTable.boardStatus })
          .from(jobsTable)
          .where(eq(jobsTable.id, jobId))
          .limit(1);
        if (cur[0] && boardRank(cur[0].boardStatus) < boardRank("billing")) {
          await db
            .update(jobsTable)
            .set({ boardStatus: "billing", status: "complete" })
            .where(eq(jobsTable.id, jobId));
        }
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
    if (!bid) { noteSkip("payment_requests", null, "missing_id"); continue; }
    try {
      // Base44 payment_requests: property_name is a string, amount in cents
      const propertyId =
        (await resolvePropertyByName(rec.property_name ?? rec.property)) ??
        (await resolvePropertyId(rec.property_id ?? rec.propertyId));
      if (!propertyId) { noteSkip("payment_requests", bid, "unresolved_property"); continue; }
      const requestNo = String((rec.crew_invoice_number || rec.request_no) ?? rec.requestNo ?? bid.slice(-8));
      const amountDollars = rec.amount_cents != null
        ? Number(rec.amount_cents) / 100
        : Number(rec.total ?? rec.amount ?? 0);
      const prStatus = rec.state ?? rec.status ?? "draft";
      const payload = {
        requestNo,
        token: rec.token ?? randomUUID(),
        propertyId,
        total: amountDollars,
        memo: rec.scope_summary ?? rec.memo ?? rec.notes ?? null,
        status: prStatus,
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

      // Advance the linked job card to "billing" when a payment request is
      // sent or paid. Look up the job via unit_id → unit_jobs map first,
      // then fall back to property + unit_no string match. Never downgrade.
      const prActive = ["sent", "pending", "paid", "viewed"].includes(prStatus);
      if (prActive && propertyId) {
        let linkedJobId: string | null = null;
        if (rec.unit_id) {
          linkedJobId = await lookupMap("unit_jobs", String(rec.unit_id));
        }
        const unitLabel = rec.unit_no ?? rec.unit_number ?? rec.unitNo ?? null;
        if (!linkedJobId && unitLabel) {
          const jobRows = await db
            .select({ id: jobsTable.id })
            .from(jobsTable)
            .where(and(eq(jobsTable.propertyId, propertyId), eq(jobsTable.unitNo, String(unitLabel))))
            .orderBy(desc(jobsTable.createdAt))
            .limit(1);
          linkedJobId = jobRows[0]?.id ?? null;
        }
        if (linkedJobId) {
          const cur = await db
            .select({ boardStatus: jobsTable.boardStatus })
            .from(jobsTable)
            .where(eq(jobsTable.id, linkedJobId))
            .limit(1);
          if (cur[0] && boardRank(cur[0].boardStatus) < boardRank("billing")) {
            await db
              .update(jobsTable)
              .set({ boardStatus: "billing", status: "complete" })
              .where(eq(jobsTable.id, linkedJobId));
          }
        }
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
    if (!bid) { noteSkip("calendar_slots", null, "missing_id"); continue; }
    try {
      const eventDate = toDateStr(rec.date ?? rec.event_date ?? rec.eventDate ?? rec.start_date);
      if (!eventDate) { noteSkip("calendar_slots", bid, "missing_date"); continue; }
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
    if (!bid) { noteSkip("price_items", null, "missing_id"); continue; }
    try {
      const service = String(rec.service ?? rec.name ?? rec.item ?? "");
      if (!service) { noteSkip("price_items", bid, "missing_service"); continue; }
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
    if (!bid) { noteSkip("owners", null, "missing_id"); continue; }
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
  /** Rows the sync could not place. Folded in at roll-up, not by the syncers. */
  skipped?: number;
  stale?: number;
}

export interface SyncResult {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "partial" | "failed" | "skipped";
  errorCode: SyncErrorCode;
  freshness: Freshness;
  attempts: number;
  resources: Record<string, SyncStats>;
  totalCreated: number;
  totalUpdated: number;
  totalStale: number;
  totalErrors: number;
  /** Upstream rows the sync could not place. Not errors, but not synced either. */
  totalSkipped: number;
}

export interface SyncHealth {
  lastAttemptedAt: string | null;
  lastSuccessfulAt: string | null;
  lastDurationMs: number | null;
  lastStatus: SyncResult["status"] | null;
  lastErrorCode: SyncErrorCode;
  freshness: Freshness;
  recordsProcessed: number;
  failures: number;
  stale: number;
  /** Rows the Work App is still serving that HALO could not place. */
  unplaced: number;
  /** Capped at MAX_SKIP_DETAIL; `unplaced` remains the exact count. */
  unplacedDetail: SyncSkip[];
  unplacedDetailTruncated: boolean;
  result: SyncResult | null;
}

let lastSyncResult: SyncResult | null = null;
let lastSuccessfulAt: Date | null = null;

export function getLastSyncResult(): SyncResult | null {
  return lastSyncResult;
}

/** Restore last run into memory so health survives process restart. */
export async function hydrateSyncHealthFromDb(): Promise<void> {
  if (lastSyncResult) return;
  try {
    const rows = await db
      .select()
      .from(base44SyncRunsTable)
      .orderBy(desc(base44SyncRunsTable.attemptedAt))
      .limit(8);
    const latest = rows[0];
    if (!latest) return;
    lastSyncResult = {
      startedAt: latest.attemptedAt.toISOString(),
      finishedAt: (latest.finishedAt ?? latest.attemptedAt).toISOString(),
      durationMs: latest.durationMs ?? 0,
      status: (["success", "partial", "failed", "skipped"].includes(latest.status)
        ? latest.status
        : "failed") as SyncResult["status"],
      errorCode: (latest.errorCode as SyncErrorCode) ?? null,
      freshness: (latest.freshness as Freshness) || "unavailable",
      attempts: latest.attempts,
      resources: (latest.resources as Record<string, SyncStats>) ?? {},
      totalCreated: latest.totalCreated,
      totalUpdated: latest.totalUpdated,
      totalStale: latest.totalStale,
      totalErrors: latest.totalErrors,
      totalSkipped: latest.totalSkipped ?? 0,
    };
    const lastOk = rows.find((r) => r.status === "success" || r.status === "partial");
    if (lastOk?.finishedAt) lastSuccessfulAt = lastOk.finishedAt;
  } catch (err) {
    logger.warn({ err }, "base44 sync: could not hydrate health from db");
  }
}

export function getBase44SyncHealth(now = new Date()): SyncHealth {
  const lastError = lastSyncResult?.errorCode ?? null;
  return {
    lastAttemptedAt: lastSyncResult?.startedAt ?? null,
    lastSuccessfulAt: lastSuccessfulAt?.toISOString() ?? null,
    lastDurationMs: lastSyncResult?.durationMs ?? null,
    lastStatus: lastSyncResult?.status ?? null,
    lastErrorCode: lastError,
    freshness: computeFreshness(lastSuccessfulAt, lastError, now),
    recordsProcessed:
      (lastSyncResult?.totalCreated ?? 0) + (lastSyncResult?.totalUpdated ?? 0),
    failures: lastSyncResult?.totalErrors ?? 0,
    stale: lastSyncResult?.totalStale ?? 0,
    unplaced: lastSyncResult?.totalSkipped ?? 0,
    unplacedDetail: getLastSyncSkips(),
    unplacedDetailTruncated: (lastSyncResult?.totalSkipped ?? 0) > getLastSyncSkips().length,
    result: lastSyncResult,
  };
}

function asList(value: unknown[] | undefined, presence: CollectionPresence): any[] | null {
  if (!shouldApplyCollection(presence) || !value) return null;
  return value;
}

async function persistRun(result: SyncResult): Promise<void> {
  try {
    await db.insert(base44SyncRunsTable).values({
      attemptedAt: new Date(result.startedAt),
      finishedAt: new Date(result.finishedAt),
      durationMs: result.durationMs,
      status: result.status,
      errorCode: result.errorCode,
      freshness: result.freshness,
      totalCreated: result.totalCreated,
      totalUpdated: result.totalUpdated,
      totalStale: result.totalStale,
      totalErrors: result.totalErrors,
      totalSkipped: result.totalSkipped,
      attempts: result.attempts,
      resources: result.resources,
    });
  } catch (err) {
    logger.warn({ err }, "base44 sync: failed to persist run");
  }
}

function finishResult(
  startedAt: Date,
  partial: Omit<SyncResult, "startedAt" | "finishedAt" | "durationMs" | "freshness">,
): SyncResult {
  const finishedAt = new Date();
  const freshness = computeFreshness(
    partial.status === "failed" ? lastSuccessfulAt : finishedAt,
    partial.errorCode,
    finishedAt,
  );
  const result: SyncResult = {
    ...partial,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    freshness,
  };
  lastSyncResult = result;
  if (result.status === "success" || result.status === "partial") {
    lastSuccessfulAt = finishedAt;
  }
  return result;
}

export async function runBase44Sync(opts?: {
  fetchFn?: typeof fetch;
  token?: string;
  url?: string;
}): Promise<SyncResult> {
  if (syncRunning) {
    logger.info("base44 sync: already running — skip");
    const now = new Date().toISOString();
    return (
      lastSyncResult ?? {
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        status: "skipped",
        errorCode: null,
        freshness: "unavailable",
        attempts: 0,
        resources: {},
        totalCreated: 0,
        totalUpdated: 0,
        totalStale: 0,
        totalErrors: 0,
        totalSkipped: 0,
      }
    );
  }
  syncRunning = true;
  const startedAt = new Date();
  resetSkips();
  logger.info("base44 sync: starting");

  try {
    await ensureBase44Schema();
  } catch (err) {
    logger.warn({ err }, "base44 sync: schema ensure failed (continuing)");
  }

  try {
    const fetched = await fetchBase44Snapshot({
      fetchFn: opts?.fetchFn,
      token: opts?.token,
      url: opts?.url,
    });
    const parsed = parseBase44Body(fetched.body);
    if (!parsed.ok) {
      const result = finishResult(startedAt, {
        status: "failed",
        errorCode: "malformed",
        attempts: fetched.attempts,
        resources: {},
        totalCreated: 0,
        totalUpdated: 0,
        totalStale: 0,
        totalErrors: 1,
        totalSkipped: 0,
      });
      await persistRun(result);
      logger.warn("base44 sync: malformed payload — existing data left untouched");
      return result;
    }

    const prev = await loadIngestState();
    const ingest = applyIngest(prev, parsed, new Date());
    await persistEvidence(ingest.records, new Date());
    await persistMapStatuses(ingest.state);
    await markEvidenceStale(ingest.state);

    const resources: Record<string, SyncStats> = {};
    const properties = asList(parsed.collections.properties, parsed.presence.properties);
    const crews = asList(parsed.collections.crews, parsed.presence.crews);
    const units = asList(parsed.collections.units, parsed.presence.units);
    const priceItems = asList(parsed.collections.price_items, parsed.presence.price_items);
    const calendarSlots = asList(parsed.collections.calendar_slots, parsed.presence.calendar_slots);
    const owners = asList(parsed.collections.owners, parsed.presence.owners);
    const crewJobs = asList(parsed.collections.crew_jobs, parsed.presence.crew_jobs);
    const invoices = asList(parsed.collections.invoices, parsed.presence.invoices);
    const paymentRequests = asList(
      parsed.collections.payment_requests,
      parsed.presence.payment_requests,
    );

    if (properties) {
      resources.properties = await syncProperties(properties);
    }
    if (crews) {
      resources.crews = await syncCrews(crews);
    }

    const parallel: Promise<void>[] = [];
    if (units) {
      parallel.push(
        syncUnits(units).then((s) => {
          resources.units = s;
        }),
      );
    }
    if (priceItems) {
      resources.price_items = await syncPriceItems(priceItems);
    }
    if (calendarSlots) {
      parallel.push(
        syncCalendarSlots(calendarSlots).then((s) => {
          resources.calendar_slots = s;
        }),
      );
    }
    if (owners) {
      parallel.push(
        syncOwners(owners, properties ?? []).then((s) => {
          resources.owners = s;
        }),
      );
    }
    await Promise.all(parallel);

    if (units) {
      resources.unit_jobs = await syncUnitsAsJobs(units);
    }
    if (crewJobs) {
      resources.crew_jobs = await syncCrewJobs(crewJobs);
    }

    const parallel2: Promise<void>[] = [];
    if (invoices) {
      parallel2.push(
        syncInvoices(invoices).then((s) => {
          resources.invoices = s;
        }),
      );
    }
    if (paymentRequests) {
      parallel2.push(
        syncPaymentRequests(paymentRequests).then((s) => {
          resources.payment_requests = s;
        }),
      );
    }
    await Promise.all(parallel2);

    // Fold unplaced rows into the per-resource stats so they show up next to
    // the counts they were missing from. Driven by the exact counters, not the
    // capped detail list.
    const totalSkipped = foldSkipsIntoResources(resources);
    if (totalSkipped > 0) {
      const skips = getSkipSummary();
      logger.warn(
        {
          total: skips.total,
          byReason: skips.byReason,
          sample: getLastSyncSkips().slice(0, 20),
          detailTruncated: skips.detailTruncated,
        },
        "base44 sync: upstream rows could not be placed into HALO",
      );
    }

    const compatErrors = Object.values(resources).reduce((s, r) => s + r.errors, 0);
    const result = finishResult(startedAt, {
      status: ingest.totalErrors + compatErrors > 0 ? "partial" : "success",
      errorCode: null,
      attempts: fetched.attempts,
      resources,
      totalCreated: ingest.totalCreated,
      totalUpdated: ingest.totalUpdated,
      totalStale: ingest.totalStale,
      totalErrors: ingest.totalErrors + compatErrors,
      totalSkipped: getSkipSummary().total,
    });
    await persistRun(result);
    logger.info(
      {
        durationMs: result.durationMs,
        totalCreated: result.totalCreated,
        totalSkipped: result.totalSkipped,
        freshness: result.freshness,
      },
      "base44 sync: complete",
    );
    return result;
  } catch (err) {
    const code: SyncErrorCode =
      err instanceof Base44ClientError ? err.code : "network";
    logger.error({ err, code }, "base44 sync: fetch or top-level error — data left untouched");
    const result = finishResult(startedAt, {
      status: "failed",
      errorCode: code,
      attempts: 1,
      resources: {},
      totalCreated: 0,
      totalUpdated: 0,
      totalStale: 0,
      totalErrors: 1,
      totalSkipped: getSkipSummary().total,
    });
    await persistRun(result);
    return result;
  } finally {
    syncRunning = false;
  }
}
