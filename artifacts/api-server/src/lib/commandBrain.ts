/**
 * HALO Command Brain — multi-turn, data-grounded operational assistant.
 *
 * Builds a live business snapshot, a role-aware system prompt, and runs a
 * multi-turn Anthropic conversation using the caller's persisted history.
 * Returns a structured BrainResponse that the front-end renders appropriately.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db,
  jobsTable,
  invoicesTable,
  propertiesTable,
  crewsTable,
  crewCheckinsTable,
  crewPaymentsTable,
  contactsTable,
  vendorsTable,
  inventoryItemsTable,
  catalogItemsTable,
  calendarEventsTable,
  workRequestsTable,
  schedulesTable,
  clientTurnsTable,
  clientTurnMetricsMvTable,
  clientUnitsTable,
} from "@workspace/db";
import { eq, and, inArray, gte, isNull, isNotNull, sql } from "drizzle-orm";
import { logger } from "./logger";
import { COMPLEX_MODEL } from "./ai";
import { computeQueues } from "./queues";
import { falkonConnectionsTable } from "@workspace/db/schema";
import type { HaloIdentity } from "./enforcerCore";
import {
  filterBySnapshotScope,
  filterPropertiesByScope,
  snapshotPropertyScope,
  type SnapshotPropertyScope,
} from "./commandSnapshotCore";
import {
  answerFromCortex,
  buildOpsCortex,
  renderCortexBlock,
  type OpsFacts,
  type OpsNeed,
  type OpsCortex,
} from "./opsCortex";
import {
  ANSWER_MAX_BULLETS,
  ANSWER_MAX_BULLET_CHARS,
  ANSWER_MAX_GROUP_ITEMS,
  ANSWER_MAX_HEADLINE_CHARS,
  normalizeAnswer,
  structuredToPlainText,
  type StructuredAnswer,
} from "./answerFormat";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BusinessSnapshot {
  date: string;
  hour: number;
  todayItems: Array<{
    id: string;
    title: string;
    tier: string;
    queue: string;
    amount: number | null;
  }>;
  properties: Array<{
    id: string;
    name: string;
    city: string;
    address?: string;
    units: number;
    status: string;
  }>;
  roster?: {
    crews: Array<{ id: string; name: string; trade: string; phone: boolean }>;
    contacts: Array<{ name: string; role: string; phone: boolean; propertyId: string | null }>;
    vendors: Array<{ id: string; name: string; trade: string }>;
    inventory: Array<{ name: string; qty: number; vendor: string | null }>;
    catalog: string[];
  };
  calendar?: Array<{ title: string; date: string }>;
  // (a) "Who's on site today?" — crews checked in today, with where + when.
  onSiteToday?: Array<{
    crewName: string;
    propertyName: string;
    unitNo: string | null;
    checkedInAt: string;
  }>;
  // (b) "What units are complete?" — jobs meeting the board's completion
  // semantics (status complete/paid OR boardStatus completed/billing).
  completedUnits?: Array<{
    jobNo: string;
    unitNo: string | null;
    propertyName: string;
    completedAt: string | null;
  }>;
  // (c) "What's the work schedule?" — today + this week's scheduled jobs, from
  // the merged crew_schedules + calendar_events feed.
  schedule?: Array<{
    date: string;
    unitNo: string | null;
    propertyName: string;
    crewName: string | null;
    startTime: string | null;
    title: string | null;
  }>;
  pendingRequests?: number;
  jobs: {
    total: number;
    open: number;
    overdue: number;
    uncrewed: number;
    overBudget: number;
    recentOpen: Array<{
      id: string;
      jobNo?: string;
      unitNo: string | null;
      propertyId: string;
      propertyName?: string;
      status: string;
      boardStatus: string;
      scheduledOn?: string | null;
    }>;
    overdueDetail?: Array<{
      jobId?: string;
      jobNo?: string;
      unitNo: string | null;
      propertyName: string;
      daysLate: number;
    }>;
    uncrewedDetail?: Array<{
      jobId?: string;
      jobNo?: string;
      unitNo: string | null;
      propertyName: string;
      scheduledOn?: string | null;
    }>;
    dueTomorrow?: Array<{
      jobId?: string;
      jobNo?: string;
      unitNo: string | null;
      propertyName: string;
      crewName?: string | null;
    }>;
  };
  invoices: {
    totalReceivables: number;
    overdueCount: number;
    sentCount: number;
    pendingCrewPay: number;
    overdueDetail?: Array<{
      invoiceId?: string;
      invoiceNo?: string;
      amount: number;
      propertyName?: string;
      daysLate: number;
    }>;
  };
  boardTurns?: Array<{
    propertyName: string;
    unitNumber: string;
    days: number;
    status: string;
    stalled: boolean;
    predictedReadyOn: string | null;
    /** HALO job for this unit, when one is open — lets HALO propose re-ordering it. */
    jobId?: string | null;
    jobNo?: string | null;
  }>;
  /**
   * The operation's own rolling average turn time, from finished turns only.
   * Drives every "running long" flag instead of a hardcoded day count.
   */
  turnBaseline?: { avgDays: number | null; sample: number };
  crews: {
    total: number;
    checkedInToday: number;
  };
  margin: {
    avgMarginPct: number | null;
    flaggedCount: number;
  };
  falkonMode: string;
  snapshotScope: SnapshotPropertyScope;
}

export type BrainResponseType = "answer" | "lens" | "voice_action" | "error";

/**
 * A prediction HALO volunteered, already persisted as a pending autopilot
 * action. Approving it POSTs `approveUrl` — the existing approval gate is what
 * authorizes execution, so nothing here runs on render.
 */
export interface AnswerProposal {
  /** Autopilot action id. */
  id: string;
  kind: string;
  /** The question put to the operator: "… move it to the top of the list?" */
  decision: string;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  approveUrl: string;
  dismissUrl: string;
}

/** Risk classification for ASSISTED mode auto-execution */
export type ActionRisk = "auto" | "review" | "block";

export interface ActionPlan {
  /** Plain-English description of exactly what will happen */
  description: string;
  /** auto = safe to execute immediately in ASSISTED; review = requires explicit human approval; block = not permitted from this surface */
  risk: ActionRisk;
  /** HALO capability key, e.g. "invoice.send", "job.create", "crew.schedule", "payment.release" */
  capability?: string;
  /** Key parameters the executor will use */
  params?: Record<string, unknown>;
}

export interface BrainResponse {
  /** How the front-end should render this message */
  type: BrainResponseType;
  /**
   * Plain-text flattening of `answer` — persisted as the message body and fed
   * back as conversation history. Never contains markdown syntax.
   */
  text: string;
  /**
   * The structured answer the screen renders: one headline plus short
   * fragment bullets, with long enumerations grouped and capped. Always set
   * for type "answer"; caps are enforced server-side, not by the prompt.
   */
  answer?: StructuredAnswer;
  /** Conversational rendering for voice / earpiece — sentences, never bullets. */
  speech?: string;
  /** Predictive suggestions the operator can approve or dismiss inline. */
  proposals?: AnswerProposal[];
  /** Set when type === 'lens' — which lens to open */
  lensKind?: "portfolio" | "timeline" | "money" | "evidence" | "network" | "map" | "property_status" | "turn_timeline" | "budget_breakdown" | "crew_map" | "invoice_detail" | "vendor_profile" | "photo_evidence" | "inspection_checklist";
  /** Set when type === 'lens' and lens is entity-scoped — the entity UUID for the API call */
  entityId?: string;
  /** Set when a proposed action is in SHADOW mode */
  shadowLabel?: string;
  /** Data citations shown below the response bubble */
  sources?: Array<{ label: string; value: string }>;
  /** 2-3 suggested follow-up prompts shown as tappable chips */
  suggestedFollowUps?: string[];
  /** Set when type === 'voice_action' — structured action plan for ASSISTED auto-execution or approval */
  actionPlan?: ActionPlan;
  /** Compound missions (AND / then / also). First step is also mirrored in actionPlan. */
  actionPlans?: ActionPlan[];
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

function civilDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function addCivilDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Unit labels come from two systems — compare them the same way everywhere. */
function normalizeUnitLabel(unit: string | null | undefined): string {
  return String(unit ?? "")
    .toLowerCase()
    .replace(/^(unit|apt|apartment|#)\s*/i, "")
    .replace(/[^a-z0-9]/g, "");
}

async function loadBoardTurns(
  propertyIds: string[],
  propName: Map<string, string>,
  jobByUnit: Map<string, { id: string; jobNo: string }>,
): Promise<NonNullable<BusinessSnapshot["boardTurns"]>> {
  if (propertyIds.length === 0) return [];
  try {
    const rows = await db
      .select({
        propertyId: clientTurnsTable.propertyId,
        status: clientTurnsTable.status,
        predictedReadyAt: clientTurnsTable.predictedReadyAt,
        unitNumber: clientUnitsTable.unitNumber,
        daysVacant: clientTurnMetricsMvTable.daysVacant,
        isStalled: clientTurnMetricsMvTable.isStalled,
      })
      .from(clientTurnsTable)
      .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
      .leftJoin(clientTurnMetricsMvTable, eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id))
      .where(and(inArray(clientTurnsTable.propertyId, propertyIds), isNull(clientTurnsTable.readyAt)))
      .limit(80);
    return rows.map((r) => {
      const job = jobByUnit.get(`${r.propertyId}|${normalizeUnitLabel(r.unitNumber)}`);
      return {
        propertyName: propName.get(r.propertyId) ?? "",
        unitNumber: r.unitNumber ?? "",
        days: r.daysVacant ?? 0,
        status: r.status,
        stalled: Boolean(r.isStalled),
        predictedReadyOn: r.predictedReadyAt ? r.predictedReadyAt.toISOString().slice(0, 10) : null,
        jobId: job?.id ?? null,
        jobNo: job?.jobNo ?? null,
      };
    });
  } catch (err) {
    logger.warn({ err }, "commandBrain: board turns layer unavailable");
    return [];
  }
}

/** How many days a turn has actually taken lately, in this operation. */
const TURN_BASELINE_WINDOW_DAYS = 90;

/**
 * Rolling average of FINISHED turn lengths — the yardstick every "running
 * long" flag is measured against. Prefers the client board's own days-vacant
 * figure (the number the operator already sees) and falls back to how long
 * HALO jobs took from creation to completion when the board has no history.
 * Never derives a second days formula for a source that already has one.
 */
export async function loadTurnBaseline(
  propertyIds: string[],
  completedJobs: Array<{ createdAt: Date; completedAt: Date | null }>,
): Promise<{ avgDays: number | null; sample: number }> {
  const windowStart = new Date(Date.now() - TURN_BASELINE_WINDOW_DAYS * 86_400_000);
  if (propertyIds.length > 0) {
    try {
      // Aggregate in SQL over the WHOLE 90-day cohort.  A bounded row fetch
      // cannot do this job: without an ORDER BY, `limit(n)` hands back an
      // arbitrary physical subset, so past n turns the average would drift
      // with table layout rather than with the operation — and these numbers
      // are quoted back to the operator and used to decide which units get
      // flagged.  One avg()/count() pass is also cheaper than shipping rows.
      // The CASE guard is load-bearing: GREATEST ignores NULL arguments in
      // Postgres, so `greatest(0, <null interval>)` yields 0 rather than NULL.
      // Without it, a finished turn that has neither a metrics row nor a
      // recorded vacate date counts as a ZERO-day turn and quietly drags the
      // whole baseline down, which would flag units that are not actually slow.
      // An unknown duration must stay NULL so avg()/count() skip it entirely.
      const days = sql<number>`coalesce(
        ${clientTurnMetricsMvTable.daysVacant},
        case when ${clientTurnsTable.actualVacateAt} is not null
          then greatest(0, round(extract(epoch from (${clientTurnsTable.readyAt} - ${clientTurnsTable.actualVacateAt})) / 86400))
        end
      )`;
      const [agg] = await db
        .select({
          // avg() is numeric; cast so the driver hands back a JS number.
          avgDays: sql<number | null>`avg(${days})::float8`,
          // count(expr) skips NULLs, so turns with neither source drop out.
          sample: sql<number>`count(${days})::int`,
        })
        .from(clientTurnsTable)
        .leftJoin(clientTurnMetricsMvTable, eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id))
        .where(
          and(
            inArray(clientTurnsTable.propertyId, propertyIds),
            isNotNull(clientTurnsTable.readyAt),
            gte(clientTurnsTable.readyAt, windowStart),
          ),
        );
      const sample = Number(agg?.sample ?? 0);
      const avgDays = agg?.avgDays == null ? null : Number(agg.avgDays);
      if (sample >= 3 && avgDays != null && Number.isFinite(avgDays)) {
        return { avgDays, sample };
      }
    } catch (err) {
      logger.warn({ err }, "commandBrain: turn baseline layer unavailable");
    }
  }

  // Fallback: how long HALO's own jobs took, creation → completion.
  const jobDays = completedJobs
    .filter((j) => j.completedAt && j.completedAt >= windowStart)
    .map((j) =>
      Math.max(0, civilDaysBetween(j.createdAt.toISOString().slice(0, 10), j.completedAt!.toISOString().slice(0, 10))),
    );
  if (jobDays.length >= 3) {
    return { avgDays: jobDays.reduce((s, d) => s + d, 0) / jobDays.length, sample: jobDays.length };
  }
  return { avgDays: null, sample: jobDays.length };
}

function snapshotToFacts(snapshot: BusinessSnapshot): OpsFacts {
  const needs: OpsNeed[] = [];
  for (const t of snapshot.boardTurns ?? []) {
    if (t.status === "pending_approval") {
      needs.push({ kind: "awaiting_approval", propertyName: t.propertyName, unitNumber: t.unitNumber, days: t.days });
    } else if (t.status === "rework") {
      needs.push({ kind: "failed_qc", propertyName: t.propertyName, unitNumber: t.unitNumber, days: t.days });
    } else if (t.stalled) {
      needs.push({ kind: "stalled", propertyName: t.propertyName, unitNumber: t.unitNumber, days: t.days });
    }
  }
  for (const j of snapshot.jobs.overdueDetail ?? []) {
    needs.push({
      kind: "overdue_job",
      propertyName: j.propertyName,
      unitNumber: j.unitNo,
      days: j.daysLate,
      label: j.jobNo,
      entityId: j.jobId ?? null,
    });
  }
  for (const j of snapshot.jobs.uncrewedDetail ?? []) {
    needs.push({
      kind: "uncrewed",
      propertyName: j.propertyName,
      unitNumber: j.unitNo,
      label: j.jobNo,
      entityId: j.jobId ?? null,
    });
  }
  for (const inv of snapshot.invoices.overdueDetail ?? []) {
    needs.push({
      kind: "overdue_invoice",
      propertyName: inv.propertyName ?? "Invoice",
      days: inv.daysLate,
      label: inv.invoiceNo,
      entityId: inv.invoiceId ?? null,
    });
  }
  return {
    date: snapshot.date,
    voice: "office",
    unitsInTurn: snapshot.boardTurns?.length,
    turnBaselineDays: snapshot.turnBaseline?.avgDays ?? null,
    turnBaselineSample: snapshot.turnBaseline?.sample ?? 0,
    needs,
    crewToday: (snapshot.onSiteToday ?? []).map((c) => ({
      crewName: c.crewName,
      propertyName: c.propertyName,
      unitNumber: c.unitNo,
    })),
    turns: (snapshot.boardTurns ?? []).map((t) => ({
      propertyName: t.propertyName,
      unitNumber: t.unitNumber,
      days: t.days,
      status: t.status,
      predictedReadyOn: t.predictedReadyOn,
      jobId: t.jobId ?? null,
      jobNo: t.jobNo ?? null,
    })),
    jobsOpen: snapshot.jobs.open,
    jobsOverdue: snapshot.jobs.overdue,
    jobsUncrewed: snapshot.jobs.uncrewed,
    invoicesOverdue: snapshot.invoices.overdueCount,
    scheduledTomorrow: (snapshot.jobs.dueTomorrow ?? []).map((j) => ({
      propertyName: j.propertyName,
      unitNumber: j.unitNo,
      crewName: j.crewName ?? null,
      jobId: j.jobId ?? null,
      jobNo: j.jobNo ?? null,
    })),
  };
}

export function cortexFromSnapshot(snapshot: BusinessSnapshot): OpsCortex {
  return buildOpsCortex(snapshotToFacts(snapshot));
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export async function buildSnapshot(identity?: HaloIdentity): Promise<BusinessSnapshot> {
  const today = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const horizon = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 14);
  const horizonStr = `${horizon.getFullYear()}-${pad(horizon.getMonth() + 1)}-${pad(horizon.getDate())}`;
  // Local midnight for today — used as a string for the date columns
  const todayMidnight = new Date(`${todayStr}T00:00:00`);
  const scope = snapshotPropertyScope(identity);

  const [propsRaw, jobsRaw, invoicesRaw, crewsRaw, todayCheckinsRaw, crewPays, { feed: feedRaw }, contactsRaw, vendorsRaw, inventoryRaw, catalogRaw, calendarRaw, requestsRaw, schedulesRaw] =
    await Promise.all([
      db.select().from(propertiesTable),
      db.select().from(jobsTable),
      db.select().from(invoicesTable),
      db.select().from(crewsTable),
      // Count today's check-in events (kind='checkin') as a proxy for active crews
      db
        .select({ crewId: crewCheckinsTable.crewId, jobId: crewCheckinsTable.jobId, createdAt: crewCheckinsTable.createdAt })
        .from(crewCheckinsTable)
        .where(
          and(
            eq(crewCheckinsTable.kind, "checkin"),
            gte(crewCheckinsTable.createdAt, todayMidnight),
          ),
        ),
      db.select({ amount: crewPaymentsTable.amount }).from(crewPaymentsTable).where(
        inArray(crewPaymentsTable.status, ["pending", "held"]),
      ),
      computeQueues(),
      db.select({ name: contactsTable.name, role: contactsTable.role, phone: contactsTable.phone, propertyId: contactsTable.propertyId }).from(contactsTable),
      db.select({ id: vendorsTable.id, name: vendorsTable.name, trade: vendorsTable.trade }).from(vendorsTable),
      db.select({ name: inventoryItemsTable.name, qty: inventoryItemsTable.qty, preferredVendor: inventoryItemsTable.preferredVendor }).from(inventoryItemsTable),
      db.select({ service: catalogItemsTable.service }).from(catalogItemsTable),
      db.select({ title: calendarEventsTable.title, eventDate: calendarEventsTable.eventDate, jobId: calendarEventsTable.jobId, crewId: calendarEventsTable.crewId, startTime: calendarEventsTable.startTime }).from(calendarEventsTable),
      db.select({ id: workRequestsTable.id, status: workRequestsTable.status }).from(workRequestsTable),
      db.select({ jobId: schedulesTable.jobId, scheduledOn: schedulesTable.scheduledOn, windowStart: schedulesTable.windowStart, crewLeaderId: schedulesTable.crewLeaderId }).from(schedulesTable),
    ]);

  const props = filterPropertiesByScope(propsRaw, scope);
  const jobs = filterBySnapshotScope(jobsRaw, scope);
  const invoices = filterBySnapshotScope(invoicesRaw, scope);
  const feed = filterBySnapshotScope(feedRaw, scope);
  const scopedJobIds = new Set(jobs.map((j) => j.id));
  const todayCheckins =
    scope.mode === "tenant"
      ? todayCheckinsRaw
      : todayCheckinsRaw.filter((c) => c.jobId && scopedJobIds.has(c.jobId));
  const crews = scope.mode === "tenant" ? crewsRaw : [];
  const pendingCrewPay = scope.mode === "tenant" ? crewPays.reduce((s, p) => s + (p.amount ?? 0), 0) : 0;

  const openStatuses = ["open", "pending", "scheduled", "in_progress", "active"];
  const openJobs = jobs.filter((j) => openStatuses.includes(j.status));
  // scheduledOn is a date string ("YYYY-MM-DD") — compare lexicographically to today
  const overdueJobs = openJobs.filter(
    (j) => j.scheduledOn !== null && j.scheduledOn !== undefined && j.scheduledOn < todayStr,
  );
  const uncrewedJobs = openJobs.filter((j) => !j.crewLeaderId);
  const overBudgetJobs = jobs.filter(
    (j) => typeof j.marginPct === "number" && j.marginPct < 0.25,
  );

  const receivables = invoices.filter(
    (i) => i.status === "sent" || i.status === "overdue",
  );
  const totalReceivables = receivables.reduce((s, i) => s + (i.amount ?? 0), 0);
  const overdueInvoices = invoices.filter((i) => i.status === "overdue");

  const margins = jobs
    .filter((j) => typeof j.marginPct === "number")
    .map((j) => j.marginPct as number);
  const avgMarginPct =
    margins.length > 0 ? margins.reduce((s, m) => s + m, 0) / margins.length : null;

  // Unique crew IDs that checked in today
  const uniqueCheckedIn = new Set(todayCheckins.map((c) => c.crewId)).size;
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const scopedContacts = filterBySnapshotScope(contactsRaw, scope);
  const upcomingCal = calendarRaw
    .filter((e) => e.eventDate >= todayStr && e.eventDate <= horizonStr)
    .slice(0, 12);

  // ── Lookups shared by the operational answers below ──────────────────────
  const crewNameById = new Map(crewsRaw.map((c) => [c.id, c.name]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  // (a) Who's on site today — one row per (crew, job) check-in, earliest wins.
  const onSiteSeen = new Set<string>();
  const onSiteToday: NonNullable<BusinessSnapshot["onSiteToday"]> = [];
  for (const c of [...todayCheckins].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const key = `${c.crewId}|${c.jobId ?? ""}`;
    if (onSiteSeen.has(key)) continue;
    onSiteSeen.add(key);
    const job = c.jobId ? jobById.get(c.jobId) : undefined;
    onSiteToday.push({
      crewName: crewNameById.get(c.crewId) ?? "Unknown crew",
      propertyName: job ? (propName.get(job.propertyId) ?? "") : "",
      unitNo: job?.unitNo ?? null,
      checkedInAt: c.createdAt.toISOString(),
    });
  }

  // (b) Completed units — reuse the board's completion semantics exactly:
  // status complete/paid OR boardStatus completed/billing. Do not invent.
  const completedUnits = jobs
    .filter(
      (j) =>
        j.status === "complete" ||
        j.status === "paid" ||
        j.boardStatus === "completed" ||
        j.boardStatus === "billing",
    )
    .slice(0, 40)
    .map((j) => ({
      jobNo: j.jobNo,
      unitNo: j.unitNo ?? null,
      propertyName: propName.get(j.propertyId) ?? "",
      completedAt: j.completedAt ? j.completedAt.toISOString() : null,
    }));

  // (c) Work schedule — merge crew_schedules + crew-assigned calendar_events for
  // today through the end of this week, deduped by jobId (schedule wins). This
  // mirrors the per-crew merged day-stops feed, aggregated org-wide.
  const dow = today.getDay(); // 0=Sun … 6=Sat
  const weekEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate() + (6 - dow));
  const weekEndStr = `${weekEnd.getFullYear()}-${pad(weekEnd.getMonth() + 1)}-${pad(weekEnd.getDate())}`;
  const scheduleByJobDate = new Map<string, NonNullable<BusinessSnapshot["schedule"]>[number]>();
  for (const s of schedulesRaw) {
    if (s.scheduledOn < todayStr || s.scheduledOn > weekEndStr) continue;
    const job = jobById.get(s.jobId);
    if (!job) continue; // scope: only jobs in the current snapshot scope
    scheduleByJobDate.set(`${s.jobId}|${s.scheduledOn}`, {
      date: s.scheduledOn,
      unitNo: job.unitNo ?? null,
      propertyName: propName.get(job.propertyId) ?? "",
      crewName: s.crewLeaderId ? (crewNameById.get(s.crewLeaderId) ?? null) : (job.crewLeaderId ? (crewNameById.get(job.crewLeaderId) ?? null) : null),
      startTime: s.windowStart ?? null,
      title: null,
    });
  }
  for (const e of calendarRaw) {
    if (!e.jobId) continue;
    if (e.eventDate < todayStr || e.eventDate > weekEndStr) continue;
    const key = `${e.jobId}|${e.eventDate}`;
    if (scheduleByJobDate.has(key)) continue; // schedule row already covers it
    const job = jobById.get(e.jobId);
    if (!job) continue;
    scheduleByJobDate.set(key, {
      date: e.eventDate,
      unitNo: job.unitNo ?? null,
      propertyName: propName.get(job.propertyId) ?? "",
      crewName: e.crewId ? (crewNameById.get(e.crewId) ?? null) : (job.crewLeaderId ? (crewNameById.get(job.crewLeaderId) ?? null) : null),
      startTime: e.startTime ?? null,
      title: e.title ?? null,
    });
  }
  const schedule = Array.from(scheduleByJobDate.values())
    .sort((a, b) => (a.date === b.date ? (a.startTime ?? "").localeCompare(b.startTime ?? "") : a.date.localeCompare(b.date)))
    .slice(0, 40);

  // Falkon mode
  let falkonMode = "SHADOW";
  try {
    const [conn] = await db
      .select({ mode: falkonConnectionsTable.mode })
      .from(falkonConnectionsTable)
      .limit(1);
    if (conn?.mode) falkonMode = conn.mode;
  } catch {
    // ignore — non-fatal
  }

  const tomorrowStr = addCivilDays(todayStr, 1);
  // Open jobs indexed by property + normalized unit, so a client-board turn can
  // be tied back to the job the board actually orders.
  const jobByUnit = new Map<string, { id: string; jobNo: string }>();
  for (const j of openJobs) {
    const key = `${j.propertyId}|${normalizeUnitLabel(j.unitNo)}`;
    if (!jobByUnit.has(key)) jobByUnit.set(key, { id: j.id, jobNo: j.jobNo });
  }
  const [boardTurns, turnBaseline] = await Promise.all([
    loadBoardTurns(props.map((p) => p.id), propName, jobByUnit),
    loadTurnBaseline(
      props.map((p) => p.id),
      jobs
        .filter((j) => j.completedAt)
        .map((j) => ({ createdAt: j.createdAt, completedAt: j.completedAt })),
    ),
  ]);
  const overdueDetail = overdueJobs.slice(0, 12).map((j) => ({
    jobId: j.id,
    jobNo: j.jobNo,
    unitNo: j.unitNo ?? null,
    propertyName: propName.get(j.propertyId) ?? "",
    daysLate: j.scheduledOn ? civilDaysBetween(j.scheduledOn, todayStr) : 0,
  }));
  const uncrewedDetail = uncrewedJobs.slice(0, 12).map((j) => ({
    jobId: j.id,
    jobNo: j.jobNo,
    unitNo: j.unitNo ?? null,
    propertyName: propName.get(j.propertyId) ?? "",
    scheduledOn: j.scheduledOn ?? null,
  }));
  const dueTomorrow = openJobs
    .filter((j) => j.scheduledOn === tomorrowStr)
    .slice(0, 12)
    .map((j) => ({
      jobId: j.id,
      jobNo: j.jobNo,
      unitNo: j.unitNo ?? null,
      propertyName: propName.get(j.propertyId) ?? "",
      crewName: j.crewLeaderId ? (crewNameById.get(j.crewLeaderId) ?? null) : null,
    }));
  const overdueInvoiceDetail = overdueInvoices.slice(0, 8).map((i) => {
    const due = i.dueAt ? i.dueAt.toISOString().slice(0, 10) : todayStr;
    return {
      invoiceId: i.id,
      invoiceNo: i.invoiceNo,
      amount: i.amount ?? 0,
      propertyName: i.propertyId ? propName.get(i.propertyId) : undefined,
      daysLate: civilDaysBetween(due, todayStr),
    };
  });

  return {
    date: todayStr,
    hour: today.getHours(),
    todayItems: feed.slice(0, 15).map((f) => ({
      id: f.id,
      title: f.title,
      tier: f.tier,
      queue: f.queue,
      amount: f.amount ?? null,
    })),
    properties: props.map((p) => ({
      id: p.id,
      name: p.name,
      city: p.city ?? "",
      address: p.address ?? "",
      units: p.units ?? 0,
      status: p.status ?? "active",
    })),
    roster: {
      crews: (scope.mode === "tenant" ? crews : []).filter((c) => c.active !== false).slice(0, 40).map((c) => ({
        id: c.id,
        name: c.name,
        trade: c.trade ?? "",
        phone: Boolean(c.phone),
      })),
      contacts: scopedContacts.slice(0, 40).map((c) => ({
        name: c.name,
        role: c.role ?? "",
        phone: Boolean(c.phone),
        propertyId: c.propertyId ?? null,
      })),
      vendors: (scope.mode === "tenant" ? vendorsRaw : []).slice(0, 30).map((v) => ({
        id: v.id,
        name: v.name,
        trade: v.trade ?? "",
      })),
      inventory: (scope.mode === "tenant" ? inventoryRaw : []).slice(0, 30).map((i) => ({
        name: i.name,
        qty: i.qty ?? 0,
        vendor: i.preferredVendor ?? null,
      })),
      catalog: catalogRaw.map((c) => c.service).filter(Boolean).slice(0, 40),
    },
    calendar: upcomingCal.map((e) => ({ title: e.title, date: e.eventDate })),
    onSiteToday,
    completedUnits,
    schedule,
    pendingRequests: requestsRaw.filter((r) => r.status === "pending").length,
    jobs: {
      total: jobs.length,
      open: openJobs.length,
      overdue: overdueJobs.length,
      uncrewed: uncrewedJobs.length,
      overBudget: overBudgetJobs.length,
      recentOpen: openJobs.slice(0, 20).map((j) => ({
        id: j.id,
        jobNo: j.jobNo,
        unitNo: j.unitNo ?? null,
        propertyId: j.propertyId,
        propertyName: propName.get(j.propertyId) ?? "",
        status: j.status,
        boardStatus: j.boardStatus,
        scheduledOn: j.scheduledOn ?? null,
      })),
      overdueDetail,
      uncrewedDetail,
      dueTomorrow,
    },
    invoices: {
      totalReceivables,
      overdueCount: overdueInvoices.length,
      sentCount: receivables.length,
      pendingCrewPay,
      overdueDetail: overdueInvoiceDetail,
    },
    boardTurns,
    turnBaseline,
    crews: {
      total: scope.mode === "tenant" ? crews.length : uniqueCheckedIn,
      checkedInToday: uniqueCheckedIn,
    },
    margin: {
      avgMarginPct,
      flaggedCount: overBudgetJobs.length,
    },
    falkonMode,
    snapshotScope: scope,
  };
}

// ─── Role-scoped system prompt ────────────────────────────────────────────────

const ROLE_DESCRIPTIONS: Record<string, string> = {
  executive: "You see the full business: all properties, financials, margins, exceptions, and approvals.",
  pm: "You focus on properties, open jobs, crew performance, client requests, and invoicing.",
  field: "You focus on crew dispatch, schedules, GPS check-ins, job status, and daily operations.",
  accounting: "You focus on invoices, payments, receivables, crew pay, and financial metrics.",
  admin: "You have full access including Falkon control, settings, and data management.",
};

export function buildSystemPrompt(
  role: string,
  snapshot: BusinessSnapshot,
): string {
  const roleDesc =
    ROLE_DESCRIPTIONS[role] ??
    "You assist with property-services business operations.";

  const shadowNote =
    snapshot.falkonMode === "SHADOW" || snapshot.falkonMode === "OFF"
      ? "\n\n⚠️ FALKON MODE: SHADOW — Proposed actions are NOT executed. Set shadowLabel for any voice_action. Always include actionPlan even in SHADOW so the user can see what would happen."
      : snapshot.falkonMode === "ASSISTED"
      ? "\n\n✅ FALKON MODE: ASSISTED — Auto-pilot is active. Low-risk (auto) actions execute immediately without asking. Consequential (review) actions surface an approval card. Never set shadowLabel. Classify every voice_action with the correct risk level in actionPlan."
      : "";

  const economicsCtx = [
    `Open receivables: $${snapshot.invoices.totalReceivables.toLocaleString()}`,
    `Overdue invoices: ${snapshot.invoices.overdueCount}`,
    snapshot.margin.avgMarginPct !== null
      ? `Average margin: ${(snapshot.margin.avgMarginPct * 100).toFixed(1)}%`
      : null,
    snapshot.margin.flaggedCount > 0
      ? `Over-budget jobs: ${snapshot.margin.flaggedCount}`
      : null,
    `Pending crew pay: $${snapshot.invoices.pendingCrewPay.toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const attentionItems = snapshot.todayItems
    .filter((i) => i.tier === "now" || i.tier === "today")
    .slice(0, 6)
    .map((i) => `• ${i.title}${i.amount ? ` ($${i.amount.toLocaleString()})` : ""}`)
    .join("\n");

  const scopeNote =
    snapshot.snapshotScope.mode === "property"
      ? snapshot.snapshotScope.propertyIds.length === 0
        ? "\n\nSECURITY: This identity has no property scope. You have no property, job, invoice, or feed data. Do not invent any."
        : `\n\nSECURITY: You may discuss ONLY property id(s) ${snapshot.snapshotScope.propertyIds.join(", ")}. The snapshot already excludes every other site. If asked about another property, say you cannot see it.`
      : "";

  const roster = snapshot.roster ?? { crews: [], contacts: [], vendors: [], inventory: [], catalog: [] };
  const calendar = snapshot.calendar ?? [];
  const pendingRequests = snapshot.pendingRequests ?? 0;

  const crewLines = roster.crews
    .map((c) => `${c.name}${c.trade ? ` — ${c.trade}` : ""}${c.phone ? " (SMS ready)" : ""}`)
    .join("\n");
  const contactLines = roster.contacts
    .slice(0, 20)
    .map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}${c.phone ? " — phone on file" : ""}`)
    .join("\n");
  const vendorLines = roster.vendors.map((v) => `${v.name}${v.trade ? ` — ${v.trade}` : ""}`).join("\n");
  const jobLines = snapshot.jobs.recentOpen
    .map((j) => `${j.jobNo ?? "Job"} · Unit ${j.unitNo ?? "—"} · ${j.propertyName ?? ""} · ${j.status}${j.scheduledOn ? ` · ${j.scheduledOn}` : ""}`)
    .join("\n");

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    } catch {
      return iso;
    }
  };
  const onSiteLines = (snapshot.onSiteToday ?? [])
    .map((c) => `${c.crewName}${c.propertyName ? ` — ${c.propertyName}` : ""}${c.unitNo ? ` · Unit ${c.unitNo}` : ""} · checked in ${fmtTime(c.checkedInAt)}`)
    .join("\n");
  const completedLines = (snapshot.completedUnits ?? [])
    .map((u) => `${u.jobNo} · Unit ${u.unitNo ?? "—"} · ${u.propertyName}${u.completedAt ? ` · completed ${u.completedAt.slice(0, 10)}` : ""}`)
    .join("\n");
  const scheduleLines = (snapshot.schedule ?? [])
    .map((s) => `${s.date}${s.startTime ? ` ${s.startTime}` : ""} · Unit ${s.unitNo ?? "—"} · ${s.propertyName}${s.crewName ? ` · ${s.crewName}` : " · (uncrewed)"}${s.title ? ` · ${s.title}` : ""}`)
    .join("\n");

  const cortex = buildOpsCortex(snapshotToFacts(snapshot));

  return `You are HALO — Jarvis for Archangel Operations. You are the mission-control AI for a property-maintenance and make-ready contractor. Claude runs this brain. Every number below is live HALO data. You never invent people, units, vendors, or phone numbers that are not in the snapshot or the cortex.

Role: ${role} — ${roleDesc}
${shadowNote}${scopeNote}

## Reasoning protocol
Think like Claude, not a search box.
1. Answer the operator's actual question first. No novels. No recap of the whole board. Only what they asked.
2. The CORTEX BRIEF is pre-ranked from live data. Do not contradict it. You may narrate it, tighten it, or go deeper into the snapshot evidence.
3. Predict from facts only: a unit waiting on the operator will still be waiting tomorrow; an overdue job stays overdue; an uncrewed stop tomorrow morning is a miss unless you assign someone.
4. Prefer one decisive recommendation over a laundry list. Cite 2–4 snapshot facts in sources.
5. If the snapshot lacks the entity, say so. Never invent a unit, crew, vendor, phone, or dollar figure. A short format is not a licence to invent an entity to fill a bullet — fewer bullets is always correct.

## Answer format (hard rules — the server enforces these caps and will truncate you)
- \`headline\`: ONE line, under ${ANSWER_MAX_HEADLINE_CHARS} characters. The count or the decision, not a preamble. "6 units are complete." not "Here is a summary of the units that are currently complete."
- \`bullets\`: at most ${ANSWER_MAX_BULLETS} SHORT FRAGMENTS, under ${ANSWER_MAX_BULLET_CHARS} characters each. A fragment is one clause — "Unit 111 — 5 days, no crew". Never two sentences in a bullet. Never a paragraph.
- \`bullets[].emphasis\`: the entity name inside that fragment (unit, property, crew, invoice number) so the screen can highlight it. It must appear verbatim in the fragment text.
- NEVER write markdown. No \`**bold**\`, no \`#\` headings, no \`- \` list markers, no backticks. Emphasis is structural. Literal asterisks on screen are a bug.
- LONG LISTS (more than ${ANSWER_MAX_GROUP_ITEMS} items — "what units are complete?", "show every overdue invoice"): do NOT enumerate them as bullets. Put the total in the headline and use \`groups\`, one group per property, \`items\` = the unit/entity labels. The server folds the tail into a "+N more" expander. Do not repeat the group contents in bullets.
- \`speech\`: the SAME answer as one or two conversational sentences for voice. No bullet characters, no lists — this is what gets read aloud, so it must sound like a person talking.
- Volunteer the thing the operator did not ask about. When the cortex Predictions block carries a DECISION, put that decision to them as your LAST bullet, phrased as a question, using its exact comparison numbers. Never invent a decision the cortex did not compute.

${renderCortexBlock(cortex)}

## Live Business Snapshot (${snapshot.date})
Properties: ${snapshot.properties.length} | Open jobs: ${snapshot.jobs.open} | Crews: ${snapshot.crews.total} (${snapshot.crews.checkedInToday} checked in today)
Economics: ${economicsCtx}
Uncrewed jobs: ${snapshot.jobs.uncrewed} | Overdue jobs: ${snapshot.jobs.overdue} | Pending work requests: ${pendingRequests}

## Properties
${snapshot.properties.map((p) => `${p.name} — ${p.city}${p.address ? `, ${p.address}` : ""} — ${p.units} units`).join("\n")}

## Open jobs (match units here)
${jobLines || "None open."}

## Crew roster (use these exact names for SMS / schedule / crew links)
${crewLines || "No crews in scope."}

## Property contacts / PMs
${contactLines || "No contacts in scope."}

## Vendors
${vendorLines || "No vendors."}

## Inventory (on hand)
${roster.inventory.map((i) => `${i.name} × ${i.qty}${i.vendor ? ` via ${i.vendor}` : ""}`).join("\n") || "Empty."}

## Catalog services
${roster.catalog.join(", ") || "None loaded."}

## Calendar (next 14 days)
${calendar.map((e) => `${e.date} — ${e.title}`).join("\n") || "Nothing scheduled."}

## On site today (crews checked in today — answer "who's on site today?" ONLY from this list)
${onSiteLines || "No crews have checked in today."}

## Completed units (jobs the board considers complete — answer "what units are complete?" ONLY from this list; do not infer completion from anything else)
${completedLines || "No units are marked complete."}

## Work schedule (today through end of this week — merged crew schedules + calendar; answer "what's the work schedule?" from this)
${scheduleLines || "Nothing scheduled this week."}

## Client-board turns (open — days vacant from the metrics view, not recomputed)
${(snapshot.boardTurns ?? [])
    .slice(0, 24)
    .map((t) => `${t.propertyName} · ${t.unitNumber} · ${t.days}d · ${t.status}${t.stalled ? " · stalled" : ""}${t.predictedReadyOn ? ` · predicted ready ${t.predictedReadyOn}` : ""}`)
    .join("\n") || "No open client-board turns in scope."}

## Overdue jobs
${(snapshot.jobs.overdueDetail ?? []).map((j) => `${j.jobNo ?? "Job"} · Unit ${j.unitNo ?? "—"} · ${j.propertyName} · ${j.daysLate}d late`).join("\n") || "None."}

## Uncrewed jobs
${(snapshot.jobs.uncrewedDetail ?? []).map((j) => `${j.jobNo ?? "Job"} · Unit ${j.unitNo ?? "—"} · ${j.propertyName}${j.scheduledOn ? ` · ${j.scheduledOn}` : ""}`).join("\n") || "None."}

## Due tomorrow
${(snapshot.jobs.dueTomorrow ?? []).map((j) => `${j.jobNo ?? "Job"} · Unit ${j.unitNo ?? "—"} · ${j.propertyName}${j.crewName ? ` · ${j.crewName}` : " · (uncrewed)"}`).join("\n") || "Nothing scheduled tomorrow."}

## Needs Attention
${attentionItems || "Nothing urgent right now."}

## Data Sources
HALO is the operational brain. Its database is populated from two authoritative external platforms — cite them when relevant:

1. **MakeReady Flow (Base44)** — HALO pulls a projection about every 30 seconds. This is a read of the system of record, not a HALO mutation, and it is not Falkon-gated.
   Authoritative source for:
   Property, Unit, Crew, CalendarSlot, FieldSubmission, CrewJob, Invoice, PaymentRequest,
   Approval, PriceItem, CrewRate, Owner, Reminder.
   When citing data for these entity types, note "via MakeReady Flow" in sources.
   If the user asks whether data is current, say the projection refreshes about every 30 seconds and may be stale if the last pull failed. Do not claim a 15-minute cadence.

2. **Falkon Business Twin** — real-time peer network. Authoritative source for:
   peer business verification, capability matching, verified contractor rates, compliance status,
   cross-business dispatch offers, and gateway health.
   Note "via Falkon Network" when citing this data in sources.

3. **HALO native** — data created directly in HALO (not synced from above):
   expenses entered by office, crew GPS trails, walk inspection photos, board card actions,
   client messages, payment records, daily briefings.

## Instructions
- Answer from the cortex + live snapshot above. Be concise and specific with numbers.
- For "what's on fire / brief me / what's happening" → lead with the cortex brief, then the single next move.
- For "who's on site" → use On site today only. Do not invent GPS pings.
- For "what do you need from me" → client-owned waits (pending approval / variance) first, then overdue invoices.
- For "what will be late / tomorrow" → use Predictions + Due tomorrow. Name the unit and the cause.
- For data queries (what/who/why/show/which), give a direct operational answer with real numbers.
- If asked about a specific entity not fully detailed in the snapshot, say what you know and suggest opening the full view.
- For "who is behind" → look at overdue jobs and uncrewed jobs.
- For "why over budget" → reference margin data and expense context.
- For "approve everything safe" → describe what autopilot would evaluate.
- For action commands (create/schedule/send/approve) → describe the proposed action clearly and note if SHADOW mode is active.
- Daily home is HALO chat. Property Pulse at /pulse is the only dashboard. Traditional CRM is the records fallback.
- For "open pulse / property pulse / show pulse" → say you are opening Property Pulse. The client routes this locally; do not return a map lens.
- For "open map / show map / live map / where are crews" → return type "lens" with lensKind "map".
- For "job board / kanban / show jobs / open board" → return type "lens" with lensKind "timeline".
- For "money / show money / financials / invoices / revenue / receivables" → return type "lens" with lensKind "money".
- For BEFORE/AFTER PHOTOS of a unit or job — "before and after for unit 204" / "show me photos for unit 3B at Oak Grove" / "walk photos for [unit]" / "evidence for unit 12" → return type "lens" with lensKind "photo_evidence". Do NOT try to embed image URLs in an answer; the photo lens renders the before/after gallery inline. If you know the job UUID from the snapshot, set entityId to it; otherwise leave entityId null and the lens resolves the unit from the request text.
- For "generate a live link / create a PM link / send a link to [property] / text a link to the property manager / I can send to the PM today" → return type "voice_action", capability "pm_link.generate", risk "auto", params.propertyName = the property name mentioned (exactly as stated), params.expiresInHours = 24. Text should be warm and action-oriented: "Creating a secure 24-hour live link for [property] — I'll format it for texting."
- For "generate a check-in link / crew check-in link / give [name] a check-in link / checkin link for [name]" → return type "voice_action", capability "crew_checkin_link.generate", risk "auto", params.crewName = the crew member's name as stated. Text: "Generating a GPS check-in link for [name] they can bookmark on their phone."
- For "weather risk / scan weather / rain delay / which sites have weather risk" → return type "voice_action", capability "weather.risk_scan", risk "auto". Text: "Scanning HALO properties for weather risk — this does not change the Base44 schedule."
- For "end of day briefing / EOD recap / close the day / tonight's briefing" → return type "voice_action", capability "ops.eod_briefing", risk "auto". Text: "Writing today's HALO field recap from check-ins, jobs, and Base44 freshness."
- For "look up catalog / price book / what do we charge for [service]" → return type "voice_action", capability "catalog.lookup", risk "auto", params.query = the service text. Text: "Looking that up in the HALO catalog — not creating a bid."
- For "weather schedule / rain delay recommend / which jobs should we move" → return type "voice_action", capability "weather.schedule_recommend", risk "auto". Text: "I'll recommend safer days. Base44 still owns the schedule — nothing will be moved."
- For "estimate from this / draft lines from the walk / bid from photos text" → return type "voice_action", capability "estimate.from_evidence", risk "auto", params.text = the pasted evidence if any. Text: "Drafting line items from evidence. This is not an invoice."
- For "text the crew / SMS blast / send a text to [name]" → return type "voice_action", capability "comms.sms", risk "review", params.crewName = exact roster name, params.body = the message. Text: "Outbound SMS needs Falkon approval in ASSISTED. I will not send until you approve."
- For "call them for EOD / voice end of day / dial the crew" → return type "voice_action", capability "field.voice_eod", risk "review". Text: "Outbound EOD calls need Falkon approval. I will not auto-dial a batch."
- For "make a note / log a note / remind me" → capability "note.log", risk "auto", params.body = the note, params.unitNo if mentioned.
- For "set a reminder / remind me to / calendar this" → capability "reminder.set", risk "auto", params.title, params.date (YYYY-MM-DD; resolve tomorrow/today from snapshot.date), params.notes.
- For "order [material] / source supplies / buy drywall" → capability "supply.order", risk "review", params.material, params.unitNo, params.propertyName, params.neededBy. HALO will match catalog + inventory + nearby vendors and draft a PM order request.
- For "set invoice to / fix the price / change the line amount / invoice should be $X / price paint at $X on JOB-..." → capability "invoice.line.adjust", risk "auto", params.jobNo, params.amount (number dollars), params.service if named, params.reason. Text: "Updating the invoice line to the amount you specified."
- For "pay the crew $X / set payout to / crew should get $X on JOB-..." → capability "crew.payout.adjust", risk "auto", params.jobNo, params.amount, params.crewName if named, params.reason. Text: "Updating the crew payout on that job."
- For "schedule [name] / install tomorrow / dispatch" → capability "crew.schedule", risk "review", params.crewName, params.unitNo, params.scheduledOn, params.propertyName.
- For "send to the property manager / notify the PM / send the order to the PM" → capability "pm.notify", risk "review", params.propertyName, params.unitNo, params.message.
- For CLIENT PO INTAKE — the office relaying that the PROPERTY sent over a purchase order, e.g. "here's PO 12345 for unit 204 at Maple Ridge, send to vendor" / "property sent PO 88 for unit 3B at Oak Grove" / "attach PO 9001 to unit 12 at Maplewood and send it out" → capability "client_po.receive", risk "auto", params.poNumber = the PO number exactly as stated, params.unitNo = the unit label, params.propertyName = the property name, params.poSource = "office chat", params.body = the full request text. HALO resolves property → unit → the unit's current live job, attaches the PO inside a guarded transaction, and (for "send to vendor") texts + push-notifies the assigned crew. If it can't land on exactly one job it will ask you to clarify and change nothing. Text: "Attaching PO [number] to Unit [unit] at [property] and sending it to the crew."
- COMPOUND COMMANDS: when the user issues multiple tasks in one sentence (AND / then / also — e.g. "make a note to order drywall for unit 624 and text Kyann to schedule install for tomorrow"), you MUST:
  1. type "voice_action"
  2. text = a short mission brief listing every step you will run
  3. actionPlans = an ordered array of steps, each with its own capability/params/risk
  4. also set actionPlan to the FIRST step (back-compat)
  Typical drywall-style mission: note.log (auto) → reminder.set (auto) → supply.order (review) → crew.schedule (review) → comms.sms (review) → crew_checkin_link.generate (auto) if they asked for a crew link.
  Resolve names against the roster. Resolve "tomorrow" from snapshot.date. Resolve unit numbers against Open jobs. Never skip a stated action.
- Always give 2–3 specific follow-up suggestions relevant to the current context.
- Respond in JSON format exactly as specified. No markdown fences, no prose outside the JSON.
- Every reply MUST carry headline, bullets and speech. \`text\` is legacy — leave it out.`;
}

// ─── Suggested prompts ────────────────────────────────────────────────────────

export function buildSuggestedPrompts(
  snapshot: BusinessSnapshot,
  role: string,
): string[] {
  const cortex = buildOpsCortex(snapshotToFacts(snapshot));
  const prompts: string[] = [...cortex.followUps];

  // Time-of-day
  if (snapshot.hour < 12) {
    prompts.unshift("What needs my attention this morning?");
  } else if (snapshot.hour < 17) {
    prompts.unshift("Where do we stand right now?");
  } else {
    prompts.unshift("How did today close out?");
  }

  // State-aware
  if (snapshot.invoices.overdueCount > 0) {
    prompts.push(`Show every invoice waiting on me`);
  }
  if (snapshot.jobs.overdue > 0) {
    prompts.push("Who is behind on their jobs?");
  } else if (snapshot.jobs.uncrewed > 0) {
    prompts.push(`Fill the ${snapshot.jobs.uncrewed} uncrewed job${snapshot.jobs.uncrewed === 1 ? "" : "s"}`);
  }
  if (snapshot.margin.flaggedCount > 0) {
    prompts.push("Show over-budget jobs");
  }

  // Role-aware fill-ins
  if (prompts.length < 4) {
    const rolePrompts: Record<string, string[]> = {
      executive: ["What's my margin health?", "Brief me on all properties"],
      field: ["Show live crew map", "Send a crew check-in link"],
      accounting: ["Show open receivables", "What crew pay is pending?"],
      pm: ["Show active jobs by property", "What's due this week?"],
      admin: ["Show Falkon connection status", "Run autopilot evaluation"],
    };
    const extras = rolePrompts[role] ?? rolePrompts.executive;
    for (const p of extras) {
      if (prompts.length >= 4) break;
      if (!prompts.includes(p)) prompts.push(p);
    }
  }

  return prompts.slice(0, 4);
}

// ─── Brain response schema for AI ────────────────────────────────────────────

const BRAIN_RESPONSE_SCHEMA = `{
  "type": "answer" | "lens" | "voice_action" | "error",
  "headline": "string — ONE line, ≤${ANSWER_MAX_HEADLINE_CHARS} chars. The count or the decision. Required.",
  "bullets": [{ "text": "short fragment, ≤${ANSWER_MAX_BULLET_CHARS} chars, one clause, no trailing period", "emphasis": "the entity name inside text, verbatim, or omitted" }],
  "groups": [{ "label": "property or category name", "items": ["short label", "short label"] }] | null,
  "speech": "string — the same answer as 1–2 spoken sentences. Required. No bullets, no lists.",
  "lensKind": "portfolio" | "timeline" | "money" | "evidence" | "network" | "map" | "property_status" | "turn_timeline" | "budget_breakdown" | "crew_map" | "invoice_detail" | "vendor_profile" | "photo_evidence" | "inspection_checklist" | null,
  "entityId": "string UUID or null — required when lensKind is entity-scoped",
  "shadowLabel": "string or null — set only for proposed actions in SHADOW mode",
  "sources": [{ "label": "string", "value": "string" }] | null,
  "suggestedFollowUps": ["string", "string"] — exactly 2-3 relevant next questions,
  "actionPlan": {
    "description": "string — one sentence describing exactly what will happen",
    "risk": "auto" | "review" | "block",
    "capability": "string — HALO operation key e.g. invoice.send, invoice.line.adjust, crew.payout.adjust, job.create, crew.schedule, comms.sms, supply.order, reminder.set, note.log, pm.notify, crew_checkin_link.generate",
    "params": {}
  } | null,
  "actionPlans": [actionPlan, ...] | null
}

Rules:
- type "answer" → a headline + bullets response to a data query or question
- headline/bullets/speech are REQUIRED on every response type. Do not emit a "text" field.
- bullets are FRAGMENTS. Two sentences in one bullet, or a bullet over ${ANSWER_MAX_BULLET_CHARS} chars, will be truncated by the server.
- more than ${ANSWER_MAX_GROUP_ITEMS} things to list → use "groups", never a long bullet list. The server caps each group at ${ANSWER_MAX_GROUP_ITEMS} and shows the rest behind "+N more".
- never emit markdown syntax anywhere: no **, no #, no "- " prefixes, no backticks
- type "lens" → user wants to see a visual data view; set lensKind to the most relevant lens
- type "voice_action" → user wants to CREATE, SCHEDULE, SEND, APPROVE, NOTE, ORDER, or TEXT; always include actionPlan. For compound commands fill actionPlans with every step.
- type "error" → only for missing data or genuine inability to answer
- shadowLabel: if falkon mode is SHADOW and type is "voice_action", set to "SHADOW — proposed, not executed"
- sources: cite 2–4 specific data points from the snapshot
- suggestedFollowUps: always include 2–3 context-aware follow-up prompts
- actionPlan.risk classification:
    "auto"   → safe, non-financial, reversible: note.log, observation.log, reminder.set, draft creation, status queries, crew_checkin_link.generate, pm_link.generate
    "review" → consequential: invoice.send, job.create, job.status.update, crew.schedule, comms.sms, supply.order, pm.notify, expense.approve, change_order.create
    "block"  → irreversible or high-stakes: payment.release, record.delete, compliance.suspend, unit.ready`;

// ─── Core multi-turn brain function ───────────────────────────────────────────

export async function runCommandBrain(
  userMessage: string,
  role: string,
  history: ConversationMessage[],
  snapshot: BusinessSnapshot,
  entityContext?: { entityType: string; entityId: string } | null,
  opts?: { systemPromptOverride?: string; readOnly?: boolean },
): Promise<BrainResponse> {
  const entityNote = entityContext
    ? `\n\n## Entity Context\nThis conversation is scoped to a specific ${entityContext.entityType} (ID: ${entityContext.entityId}). When the user asks about status, budget, timeline, photos, or other details, answer in the context of this specific ${entityContext.entityType} rather than the global portfolio. When emitting a lens type, prefer the entity-specific kinds (property_status, turn_timeline, budget_breakdown, invoice_detail, photo_evidence, inspection_checklist) and return entityId="${entityContext.entityId}" in your response.`
    : "";
  const systemPrompt = (opts?.systemPromptOverride ?? buildSystemPrompt(role, snapshot)) + entityNote;
  const readOnlyNote = opts?.readOnly
    ? "\n\nREAD-ONLY SESSION: never emit voice_action or actionPlan. You cannot mutate operational data."
    : "";

  // Build the messages array with history + current message
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-18), // keep last 18 messages (9 turns) for context
    { role: "user", content: userMessage },
  ];

  // Ensure messages start with 'user' (Anthropic requirement)
  while (messages.length > 0 && messages[0].role !== "user") {
    messages.shift();
  }

  const fullSystem = `${systemPrompt}${readOnlyNote}\n\n## Response Format\nReturn ONLY valid JSON matching this schema:\n${BRAIN_RESPONSE_SCHEMA}`;

  try {
    const response = await anthropic.messages.create({
      model: COMPLEX_MODEL,
      max_tokens: 8192,
      system: fullSystem,
      messages,
    });

    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();

    // Extract JSON (handle optional markdown fences)
    let jsonStr = raw;
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) jsonStr = fence[1].trim();
    const firstBrace = jsonStr.search(/[{]/);
    if (firstBrace > 0) jsonStr = jsonStr.slice(firstBrace);

    const parsed = JSON.parse(jsonStr) as BrainResponse & Partial<StructuredAnswer>;

    if (opts?.readOnly && parsed.type === "voice_action") {
      parsed.type = "answer";
      parsed.actionPlan = undefined;
      parsed.actionPlans = undefined;
      parsed.shadowLabel = undefined;
    }

    const plans = Array.isArray(parsed.actionPlans) && parsed.actionPlans.length > 0
      ? parsed.actionPlans
      : parsed.actionPlan
        ? [parsed.actionPlan]
        : undefined;

    // Structural enforcement: whatever the model returned — structured fields,
    // a legacy prose blob, or markdown — comes out of here capped, bulleted
    // and markdown-free. The prompt asks; this guarantees.
    const answer = normalizeAnswer(
      {
        headline: parsed.headline,
        bullets: parsed.bullets,
        groups: parsed.groups,
        speech: parsed.speech,
      },
      parsed.text ?? "I couldn't formulate a response. Please try rephrasing.",
    );

    return {
      type: parsed.type ?? "answer",
      text: structuredToPlainText(answer),
      answer,
      speech: answer.speech,
      lensKind: parsed.lensKind ?? undefined,
      entityId: parsed.entityId ?? undefined,
      shadowLabel: parsed.shadowLabel ?? undefined,
      sources: parsed.sources ?? undefined,
      suggestedFollowUps: parsed.suggestedFollowUps ?? undefined,
      actionPlan: plans?.[0] ?? parsed.actionPlan ?? undefined,
      actionPlans: plans,
    };
  } catch (err) {
    logger.warn({ err }, "commandBrain: AI call failed");
    const facts = snapshotToFacts(snapshot);
    const cortex = buildOpsCortex(facts);
    const local = answerFromCortex(userMessage, facts, cortex);
    return {
      type: "answer",
      text: local.answer,
      answer: local.structured,
      speech: local.structured.speech,
      sources: [{ label: "cortex", value: "live snapshot (model unreachable)" }],
      suggestedFollowUps: local.followUps,
    };
  }
}
