import { Router } from "express";
import { and, desc, eq, inArray, isNotNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  activitiesTable,
  crewPhotosTable,
  crewsTable,
  db,
  jobLineItemsTable,
  jobsTable,
  propertiesTable,
  propertyUnitsTable,
} from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Pulse unit lookup and unit report.
 *
 * The Pulse desk sits in front of people who are not us — a property manager
 * standing at the tablet, a regional walking the site. They get to search a
 * unit number and read everything about that unit's work, and nothing else:
 * these two endpoints are hand-built read models that carry no invoice
 * totals, no crew pay, no margin, no client billing and no ids that open a
 * back-office screen. Adding a money field here leaks it to the lobby, so
 * don't — the office already has the full picture on the job board.
 */
export const pulseUnitsRouter = Router();

/**
 * Postgres-side twin of normUnit: strip everything but letters and digits so
 * the match is done in SQL, before the row budget, rather than after it.
 */
const normSql = (col: SQL | AnyColumn) =>
  sql`regexp_replace(lower(coalesce(${col}, '')), '[^a-z0-9]', '', 'g')`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCAN_ROWS = 4000;
const TURN_TARGET_DAYS = 7;

/**
 * Units get typed a dozen ways ("12", "Unit 12", "#12", "apt 12-B"), so match
 * on a stripped form rather than the raw label.
 */
const normUnit = (v: string | null | undefined): string =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(unit|apt|apartment|suite|ste)\b\.?\s*/, "")
    .replace(/[\s#_.-]/g, "");

const isOpenJob = (j: { status: string | null; boardStatus: string | null; completedAt: Date | null; clearedAt: Date | null }) =>
  !j.clearedAt && j.boardStatus !== "removed" && !j.completedAt && j.status !== "complete" && j.status !== "cancelled";

const dayMs = 24 * 60 * 60 * 1000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const startOfJob = (j: { scheduledOn: string | null; createdAt: Date | null }): Date | null => {
  if (j.scheduledOn) {
    const [y, m, d] = j.scheduledOn.split("-").map(Number);
    if (y && m && d) return new Date(y, m - 1, d);
  }
  return j.createdAt ?? null;
};

type JobRow = typeof jobsTable.$inferSelect;

const jobStage = (j: JobRow): { stage: string; label: string } => {
  if (j.clearedAt || j.boardStatus === "removed") return { stage: "cleared", label: "Closed out" };
  if (j.completedAt || j.status === "complete") return { stage: "complete", label: "Work complete" };
  if (j.boardStatus === "filled" || j.crewLeaderId) return { stage: "in_progress", label: "Crew on it" };
  return { stage: "scheduled", label: j.scheduledOn ? "Scheduled" : "Not scheduled yet" };
};

const poStatus = (j: JobRow): string => (j.poNumber ? "on_file" : j.poReceivedAt ? "received" : "awaiting");

// ── GET /pulse/units ────────────────────────────────────────────────────────
// Feeds the Overview search bar. Both filter axes (property and the typed
// digits) go into SQL so a busy property can never crowd another one out of
// the results.
pulseUnitsRouter.get("/pulse/units", async (req, res) => {
  try {
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : null;
    if (propertyId && !UUID_RE.test(propertyId)) {
      res.status(400).json({ error: "propertyId must be a property id" });
      return;
    }
    const q = String(req.query.q ?? "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 40);
    const needleSql = normUnit(q);
    const like = needleSql ? `%${needleSql}%` : null;

    const [jobs, plotted, props] = await Promise.all([
      db
        .select()
        .from(jobsTable)
        .where(
          and(
            isNotNull(jobsTable.unitNo),
            propertyId ? eq(jobsTable.propertyId, propertyId) : undefined,
            like ? sql`${normSql(jobsTable.unitNo)} like ${like}` : undefined,
          ),
        )
        .orderBy(desc(jobsTable.createdAt))
        .limit(SCAN_ROWS),
      db
        .select()
        .from(propertyUnitsTable)
        .where(
          and(
            propertyId ? eq(propertyUnitsTable.propertyId, propertyId) : undefined,
            like ? sql`${normSql(propertyUnitsTable.label)} like ${like}` : undefined,
          ),
        )
        .limit(SCAN_ROWS),
      db.select({ id: propertiesTable.id, name: propertiesTable.name }).from(propertiesTable),
    ]);

    const propName = new Map(props.map((p) => [p.id, p.name]));
    type Acc = {
      key: string;
      unitNo: string;
      propertyId: string | null;
      propertyName: string | null;
      jobCount: number;
      openJobs: number;
      lastActivityAt: Date | null;
      complete: number;
    };
    const acc = new Map<string, Acc>();
    const slot = (unitNo: string, pid: string | null): Acc => {
      const key = `${pid ?? "unplaced"}::${normUnit(unitNo)}`;
      let row = acc.get(key);
      if (!row) {
        row = {
          key,
          unitNo,
          propertyId: pid,
          propertyName: pid ? propName.get(pid) ?? null : null,
          jobCount: 0,
          openJobs: 0,
          lastActivityAt: null,
          complete: 0,
        };
        acc.set(key, row);
      }
      return row;
    };

    for (const u of plotted) slot(u.label, u.propertyId);
    for (const j of jobs) {
      if (!j.unitNo) continue;
      const row = slot(j.unitNo, j.propertyId);
      row.jobCount += 1;
      if (isOpenJob(j)) row.openJobs += 1;
      if (j.completedAt) row.complete += 1;
      const at = j.completedAt ?? j.createdAt ?? null;
      if (at && (!row.lastActivityAt || at > row.lastActivityAt)) row.lastActivityAt = at;
    }

    const needle = normUnit(q);
    const out = [...acc.values()]
      .map((r) => ({
        key: r.key,
        unitNo: r.unitNo,
        propertyId: r.propertyId,
        propertyName: r.propertyName,
        jobCount: r.jobCount,
        openJobs: r.openJobs,
        lastActivityAt: iso(r.lastActivityAt),
        stage: r.openJobs > 0 ? "in_turn" : r.complete > 0 ? "complete" : "not_started",
      }))
      // An exact hit, then units that start with what was typed, then the rest
      // — typing "12" should not bury unit 12 under 120 and 212.
      .sort((a, b) => {
        const rank = (u: string) => {
          const n = normUnit(u);
          if (!needle) return 2;
          if (n === needle) return 0;
          return n.startsWith(needle) ? 1 : 2;
        };
        const ra = rank(a.unitNo);
        const rb = rank(b.unitNo);
        if (ra !== rb) return ra - rb;
        return (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "");
      })
      .slice(0, limit);

    return res.json(out);
  } catch (err) {
    logger.error({ err }, "GET /pulse/units failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

// ── GET /pulse/unit-report ──────────────────────────────────────────────────
pulseUnitsRouter.get("/pulse/unit-report", async (req, res) => {
  try {
    const unitRaw = String(req.query.unit ?? "").trim();
    if (!unitRaw) return res.status(400).json({ error: "unit is required" });
    const propertyId = req.query.propertyId ? String(req.query.propertyId) : null;
    if (propertyId && !UUID_RE.test(propertyId)) {
      res.status(400).json({ error: "propertyId must be a property id" });
      return;
    }
    const needle = normUnit(unitRaw);
    if (!needle) return res.status(400).json({ error: "unit is required" });

    const jobs = await db
      .select()
      .from(jobsTable)
      .where(
        and(
          isNotNull(jobsTable.unitNo),
          propertyId ? eq(jobsTable.propertyId, propertyId) : undefined,
          sql`${normSql(jobsTable.unitNo)} = ${needle}`,
        ),
      )
      .orderBy(desc(jobsTable.createdAt))
      .limit(SCAN_ROWS);

    // A unit that exists on the site map but has never been worked is a real
    // answer ("nothing has happened here yet"), not a 404.
    let plotted: { label: string; propertyId: string } | null = null;
    if (jobs.length === 0) {
      const [row] = await db
        .select({ label: propertyUnitsTable.label, propertyId: propertyUnitsTable.propertyId })
        .from(propertyUnitsTable)
        .where(
          and(
            propertyId ? eq(propertyUnitsTable.propertyId, propertyId) : undefined,
            sql`${normSql(propertyUnitsTable.label)} = ${needle}`,
          ),
        )
        .limit(1);
      plotted = row ?? null;
      if (!plotted) return res.status(404).json({ error: "Unit not found" });
    }

    const resolvedPropertyId = propertyId ?? jobs[0]?.propertyId ?? plotted?.propertyId ?? null;
    const scoped = resolvedPropertyId ? jobs.filter((j) => j.propertyId === resolvedPropertyId) : jobs;
    const jobIds = scoped.map((j) => j.id);

    const [props, crews, lines, shots, acts] = await Promise.all([
      resolvedPropertyId
        ? db
            .select({ id: propertiesTable.id, name: propertiesTable.name })
            .from(propertiesTable)
            .where(eq(propertiesTable.id, resolvedPropertyId))
        : Promise.resolve([] as { id: string; name: string }[]),
      db.select({ id: crewsTable.id, name: crewsTable.name }).from(crewsTable),
      jobIds.length
        ? db.select().from(jobLineItemsTable).where(inArray(jobLineItemsTable.jobId, jobIds))
        : Promise.resolve([] as (typeof jobLineItemsTable.$inferSelect)[]),
      jobIds.length
        ? db.select().from(crewPhotosTable).where(inArray(crewPhotosTable.jobId, jobIds))
        : Promise.resolve([] as (typeof crewPhotosTable.$inferSelect)[]),
      jobIds.length
        ? db
            .select()
            .from(activitiesTable)
            .where(
              and(
                eq(activitiesTable.entityType, "job"),
                inArray(activitiesTable.kind, ["photo_before", "photo_after"]),
                inArray(activitiesTable.entityId, jobIds),
              ),
            )
        : Promise.resolve([] as (typeof activitiesTable.$inferSelect)[]),
    ]);

    const crewName = new Map(crews.map((c) => [c.id, c.name]));
    const jobNoById = new Map(scoped.map((j) => [j.id, j.jobNo]));

    type Shot = { url: string; phase: string; takenAt: string | null; jobNo: string | null; jobId: string };
    const photos: Shot[] = [];
    const seen = new Set<string>();
    const addShot = (jobId: string, storagePath: string, phase: string | null, at: Date | null) => {
      if (!storagePath || (phase !== "before" && phase !== "after")) return;
      // The same file lands in crew_photos and as a mirrored activity, so
      // dedupe on the storage path or every shot shows twice.
      if (seen.has(storagePath)) return;
      seen.add(storagePath);
      photos.push({
        url: `/api/storage${storagePath}`,
        phase,
        takenAt: iso(at),
        jobNo: jobNoById.get(jobId) ?? null,
        jobId,
      });
    };
    for (const p of shots) {
      if (!p.jobId) continue;
      addShot(p.jobId, p.storagePath, p.phase, p.capturedAt ?? p.createdAt ?? null);
    }
    for (const a of acts) {
      if (!a.storagePath) continue;
      addShot(a.entityId, a.storagePath, a.kind === "photo_before" ? "before" : "after", a.createdAt ?? null);
    }
    photos.sort((a, b) => (b.takenAt ?? "").localeCompare(a.takenAt ?? ""));

    const linesByJob = new Map<string, (typeof jobLineItemsTable.$inferSelect)[]>();
    for (const l of lines) {
      const list = linesByJob.get(l.jobId) ?? [];
      list.push(l);
      linesByJob.set(l.jobId, list);
    }

    const now = new Date();
    const jobDtos = scoped.map((j) => {
      const { stage, label } = jobStage(j);
      const scope = (linesByJob.get(j.id) ?? []).map((l) => ({ service: l.service, done: l.completedAt != null }));
      const started = startOfJob(j);
      const ended = j.completedAt ?? null;
      const daysOnSite =
        started && (ended || isOpenJob(j))
          ? Math.max(0, Math.round((((ended ?? now).getTime() - started.getTime()) / dayMs) * 10) / 10)
          : null;
      return {
        jobNo: j.jobNo,
        title: j.description ?? null,
        category: j.category ?? null,
        stage,
        stageLabel: label,
        scheduledOn: j.scheduledOn ?? null,
        completedAt: iso(j.completedAt),
        crewName: j.crewLeaderId ? crewName.get(j.crewLeaderId) ?? null : null,
        poNumber: j.poNumber ?? null,
        poStatus: poStatus(j),
        poReceivedAt: iso(j.poReceivedAt),
        warrantyUntil: j.warrantyUntil ?? null,
        daysOnSite,
        scopeDone: scope.filter((s) => s.done).length,
        scopeTotal: scope.length,
        scope,
        photos: photos.filter((p) => p.jobId === j.id).map(({ jobId: _jobId, ...rest }) => rest),
      };
    });

    // Turn time spans the whole unit, not one job: the clock starts with the
    // first job of this turn and stops when the last one is finished. While
    // anything is still open it keeps running against now.
    const live = scoped.filter((j) => !j.clearedAt && j.boardStatus !== "removed");
    const open = live.filter(isOpenJob);
    const openCount = open.length;
    // A unit can be turned more than once. While something is open, that IS
    // the current turn — measuring from an older finished job would report a
    // turn that has been running for months.
    const clockJobs = openCount > 0 ? open : live;
    const starts = clockJobs.map(startOfJob).filter((d): d is Date => d != null);
    const turnStartedAt = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const completions = live.map((j) => j.completedAt).filter((d): d is Date => d != null);
    const turnCompletedAt =
      openCount === 0 && completions.length ? new Date(Math.max(...completions.map((d) => d.getTime()))) : null;
    const turnDays = turnStartedAt
      ? Math.max(0, Math.round((((turnCompletedAt ?? now).getTime() - turnStartedAt.getTime()) / dayMs) * 10) / 10)
      : null;
    const stage = openCount > 0 ? "in_turn" : completions.length ? "complete" : "not_started";
    const stageLabel =
      stage === "in_turn"
        ? `In turn — ${openCount} job${openCount === 1 ? "" : "s"} running`
        : stage === "complete"
          ? "Turn complete"
          : "No work logged yet";

    return res.json({
      unitNo: scoped[0]?.unitNo ?? plotted?.label ?? unitRaw,
      propertyId: resolvedPropertyId,
      propertyName: props[0]?.name ?? null,
      stage,
      stageLabel,
      turnStartedAt: iso(turnStartedAt),
      turnCompletedAt: iso(turnCompletedAt),
      turnDays,
      turnTarget: TURN_TARGET_DAYS,
      jobCount: scoped.length,
      openPos: open.filter((j) => poStatus(j) === "awaiting").length,
      jobs: jobDtos,
      photos: photos.map(({ jobId: _jobId, ...rest }) => rest),
    });
  } catch (err) {
    logger.error({ err }, "GET /pulse/unit-report failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default pulseUnitsRouter;
