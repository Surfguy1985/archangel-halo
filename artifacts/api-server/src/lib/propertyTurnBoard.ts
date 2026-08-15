/**
 * Property Turn Ring read/write (Segment 4).
 *
 * Board list hydrates open turns + events for that property only (tens of
 * units, not 17k). Detail loads one turn's events for the stage band.
 */

import { and, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientTurnsTable,
  clientTurnStageEventsTable,
  clientTurnMetricsMvTable,
  clientUnitsTable,
  clientOrgsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientAuditLogTable,
  TURN_STAGES,
  STAGE_OWNERSHIP_SEED,
  stageVisitsFromEvents,
  formatStageClock,
  buildTurnRingArcs,
  p75Ms,
  calendarDaysBetween,
  IllegalTurnTransitionError,
  type TurnStage,
  type StageVisit,
  type WorkSource,
} from "@workspace/db";
import { transitionTurn } from "./turnEngine";

export type TurnBoardGroupBy = "stage" | "work_source" | "vendor";

export class PropertyBoardNotFoundError extends Error {
  constructor(message = "Property not found") {
    super(message);
    this.name = "PropertyBoardNotFoundError";
  }
}

export class TurnBoardNotFoundError extends Error {
  constructor(message = "Turn not found") {
    super(message);
    this.name = "TurnBoardNotFoundError";
  }
}

export class TurnActionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnActionConflictError";
  }
}

const STAGE_LABEL: Record<TurnStage, string> = {
  notice: "Notice",
  vacated: "Vacated",
  walk: "Walk",
  scoped: "Scoped",
  pending_approval: "Waiting on you",
  approved: "Approved",
  scheduled: "Scheduled",
  in_progress: "In progress",
  qc: "QC",
  rework: "Rework",
  ready: "Ready",
};

const WORK_LABEL: Record<WorkSource, string> = {
  in_house: "In-house",
  third_party: "Vendor",
};

type PropertyRow = {
  id: string;
  name: string;
  timezone: string;
  targetTurnDays: number;
  orgId: string;
};

async function loadProperty(propertyId: string): Promise<PropertyRow> {
  const [row] = await db
    .select({
      id: propertiesTable.id,
      name: propertiesTable.name,
      timezone: propertiesTable.timezone,
      targetTurnDays: propertiesTable.targetTurnDays,
      orgId: propertiesTable.clientOrgId,
    })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId))
    .limit(1);
  if (!row?.orgId) throw new PropertyBoardNotFoundError();
  return { ...row, orgId: row.orgId };
}

function clientOwnedLabel(visit: StageVisit): string | null {
  if (visit.owner !== "client") return null;
  const clock = formatStageClock(visit.durationMs);
  if (visit.stage === "pending_approval") {
    return `Waiting on your approval — ${clock}`;
  }
  return `Waiting on you — ${clock}`;
}

function ringFromVisits(
  visits: StageVisit[],
  daysVacant: number,
  predictedReadyAt: Date | null,
  confidence: string | null,
  now: Date,
  stageP75Ms: Partial<Record<TurnStage, number | null>>,
) {
  const remaining =
    predictedReadyAt && predictedReadyAt.getTime() > now.getTime()
      ? Math.round(predictedReadyAt.getTime() - now.getTime())
      : 0;
  return {
    daysVacant,
    predictedReadyAt: predictedReadyAt ? predictedReadyAt.toISOString() : null,
    confidence,
    remainingPredictedMs: remaining,
    arcs: buildTurnRingArcs({
      visits,
      predictedRemainingMs: remaining,
      stageP75Ms,
    }),
  };
}

async function eventsForTurns(turnIds: string[]) {
  if (turnIds.length === 0) return [];
  return db
    .select({
      id: clientTurnStageEventsTable.id,
      turnId: clientTurnStageEventsTable.turnId,
      stage: clientTurnStageEventsTable.stage,
      event: clientTurnStageEventsTable.event,
      occurredAt: clientTurnStageEventsTable.occurredAt,
      actorId: clientTurnStageEventsTable.actorId,
    })
    .from(clientTurnStageEventsTable)
    .where(inArray(clientTurnStageEventsTable.turnId, turnIds));
}

async function stageP75ForProperty(
  propertyId: string,
  now: Date,
): Promise<Partial<Record<TurnStage, number | null>>> {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const events = await db
    .select({
      id: clientTurnStageEventsTable.id,
      turnId: clientTurnStageEventsTable.turnId,
      stage: clientTurnStageEventsTable.stage,
      event: clientTurnStageEventsTable.event,
      occurredAt: clientTurnStageEventsTable.occurredAt,
    })
    .from(clientTurnStageEventsTable)
    .innerJoin(
      clientTurnsTable,
      eq(clientTurnsTable.id, clientTurnStageEventsTable.turnId),
    )
    .where(
      and(
        eq(clientTurnsTable.propertyId, propertyId),
        gte(clientTurnStageEventsTable.occurredAt, since),
      ),
    );
  const byTurn = new Map<string, typeof events>();
  for (const ev of events) {
    const list = byTurn.get(ev.turnId) ?? [];
    list.push(ev);
    byTurn.set(ev.turnId, list);
  }
  const samples = new Map<TurnStage, number[]>();
  for (const evs of byTurn.values()) {
    const visits = stageVisitsFromEvents(evs, now);
    for (const v of visits) {
      if (v.exitedAt == null) continue;
      const list = samples.get(v.stage) ?? [];
      list.push(Number(v.durationMs));
      samples.set(v.stage, list);
    }
  }
  const out: Partial<Record<TurnStage, number | null>> = {};
  for (const [stage, values] of samples) {
    out[stage] = p75Ms(values);
  }
  return out;
}

export async function computePropertyTurnBoard(args: {
  propertyId: string;
  orgId: string;
  groupBy?: TurnBoardGroupBy;
  now?: Date;
}): Promise<{
  propertyId: string;
  propertyName: string;
  timezone: string;
  targetTurnDays: number;
  groupBy: TurnBoardGroupBy;
  dragEnabled: false;
  lanes: Array<{ key: string; label: string; owner?: "client" | "vendor" | "shared" }>;
  cards: Array<{
    turnId: string;
    unitNumber: string;
    bedrooms: number;
    daysVacant: number;
    isStalled: boolean;
    workSource: WorkSource;
    vendorName: string | null;
    laneKey: string;
    status: TurnStage;
    ring: ReturnType<typeof ringFromVisits>;
  }>;
}> {
  const property = await loadProperty(args.propertyId);
  if (property.orgId !== args.orgId) throw new PropertyBoardNotFoundError();
  const now = args.now ?? new Date();
  const groupBy: TurnBoardGroupBy = args.groupBy ?? "stage";

  const turns = await db
    .select({
      id: clientTurnsTable.id,
      status: clientTurnsTable.status,
      workSource: clientTurnsTable.workSource,
      assignedVendorOrgId: clientTurnsTable.assignedVendorOrgId,
      predictedReadyAt: clientTurnsTable.predictedReadyAt,
      predictionConfidence: clientTurnsTable.predictionConfidence,
      actualVacateAt: clientTurnsTable.actualVacateAt,
      readyAt: clientTurnsTable.readyAt,
      unitNumber: clientUnitsTable.unitNumber,
      bedrooms: clientUnitsTable.bedrooms,
      daysVacant: clientTurnMetricsMvTable.daysVacant,
      isStalled: clientTurnMetricsMvTable.isStalled,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .leftJoin(
      clientTurnMetricsMvTable,
      eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id),
    )
    .where(
      and(
        eq(clientTurnsTable.orgId, args.orgId),
        eq(clientTurnsTable.propertyId, args.propertyId),
        isNull(clientTurnsTable.readyAt),
      ),
    );

  const vendorIds = [
    ...new Set(turns.map((t) => t.assignedVendorOrgId).filter((id): id is string => Boolean(id))),
  ];
  const vendors = vendorIds.length
    ? await db
        .select({ id: clientOrgsTable.id, name: clientOrgsTable.name })
        .from(clientOrgsTable)
        .where(inArray(clientOrgsTable.id, vendorIds))
    : [];
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));

  const events = await eventsForTurns(turns.map((t) => t.id));
  const eventsByTurn = new Map<string, typeof events>();
  for (const ev of events) {
    const list = eventsByTurn.get(ev.turnId) ?? [];
    list.push(ev);
    eventsByTurn.set(ev.turnId, list);
  }
  const p75 = await stageP75ForProperty(args.propertyId, now);

  const cards = turns.map((t) => {
    const visits = stageVisitsFromEvents(eventsByTurn.get(t.id) ?? [], now);
    const daysVacant =
      typeof t.daysVacant === "number"
        ? t.daysVacant
        : t.actualVacateAt
          ? Math.max(0, calendarDaysBetween(t.actualVacateAt, now, property.timezone))
          : 0;
    let laneKey: string = t.status;
    if (groupBy === "work_source") laneKey = t.workSource;
    if (groupBy === "vendor") laneKey = t.assignedVendorOrgId ?? "unassigned";
    return {
      turnId: t.id,
      unitNumber: t.unitNumber,
      bedrooms: t.bedrooms,
      daysVacant,
      isStalled: Boolean(t.isStalled),
      workSource: t.workSource,
      vendorName: t.assignedVendorOrgId ? vendorName.get(t.assignedVendorOrgId) ?? null : null,
      laneKey,
      status: t.status,
      ring: ringFromVisits(
        visits,
        daysVacant,
        t.predictedReadyAt,
        t.predictionConfidence,
        now,
        p75,
      ),
    };
  });

  let lanes: Array<{ key: string; label: string; owner?: "client" | "vendor" | "shared" }>;
  if (groupBy === "work_source") {
    lanes = [
      { key: "in_house", label: WORK_LABEL.in_house },
      { key: "third_party", label: WORK_LABEL.third_party },
    ];
  } else if (groupBy === "vendor") {
    const seen = new Map<string, string>();
    seen.set("unassigned", "Unassigned");
    for (const t of turns) {
      if (t.assignedVendorOrgId) {
        seen.set(t.assignedVendorOrgId, vendorName.get(t.assignedVendorOrgId) ?? "Vendor");
      }
    }
    lanes = [...seen.entries()].map(([key, label]) => ({ key, label }));
  } else {
    lanes = TURN_STAGES.filter((s) => s !== "ready").map((key) => ({
      key,
      label: STAGE_LABEL[key],
      owner: STAGE_OWNERSHIP_SEED[key],
    }));
  }

  return {
    propertyId: property.id,
    propertyName: property.name,
    timezone: property.timezone,
    targetTurnDays: property.targetTurnDays,
    groupBy,
    dragEnabled: false,
    lanes,
    cards,
  };
}

export async function computeTurnDetail(args: {
  turnId: string;
  orgId: string;
  now?: Date;
}): Promise<{
  turnId: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  bedrooms: number;
  status: TurnStage;
  daysVacant: number;
  isStalled: boolean;
  workSource: WorkSource;
  vendorName: string | null;
  ring: ReturnType<typeof ringFromVisits>;
  band: Array<{
    stage: TurnStage;
    owner: "client" | "vendor" | "shared";
    visitIndex: number;
    enteredAt: string;
    exitedAt: string | null;
    durationMs: number;
    durationLabel: string;
    actorId: string | null;
    clientOwnedLabel: string | null;
  }>;
  bandDurationMs: number;
  activity: Array<{ id: string; kind: "stage" | "approval" | "message"; at: string; summary: string }>;
  actions: Array<{ id: "approve_scope" | "approve_variance" | "request_work"; label: string }>;
  evidencePlaceholder: string;
  scopePlaceholder: string;
}> {
  const now = args.now ?? new Date();
  const [turn] = await db
    .select({
      id: clientTurnsTable.id,
      orgId: clientTurnsTable.orgId,
      propertyId: clientTurnsTable.propertyId,
      status: clientTurnsTable.status,
      workSource: clientTurnsTable.workSource,
      assignedVendorOrgId: clientTurnsTable.assignedVendorOrgId,
      predictedReadyAt: clientTurnsTable.predictedReadyAt,
      predictionConfidence: clientTurnsTable.predictionConfidence,
      actualVacateAt: clientTurnsTable.actualVacateAt,
      readyAt: clientTurnsTable.readyAt,
      unitNumber: clientUnitsTable.unitNumber,
      bedrooms: clientUnitsTable.bedrooms,
      daysVacant: clientTurnMetricsMvTable.daysVacant,
      isStalled: clientTurnMetricsMvTable.isStalled,
      propertyName: propertiesTable.name,
      timezone: propertiesTable.timezone,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientTurnsTable.propertyId))
    .leftJoin(
      clientTurnMetricsMvTable,
      eq(clientTurnMetricsMvTable.turnId, clientTurnsTable.id),
    )
    .where(eq(clientTurnsTable.id, args.turnId))
    .limit(1);
  if (!turn || turn.orgId !== args.orgId) throw new TurnBoardNotFoundError();

  const [vendor] = turn.assignedVendorOrgId
    ? await db
        .select({ name: clientOrgsTable.name })
        .from(clientOrgsTable)
        .where(eq(clientOrgsTable.id, turn.assignedVendorOrgId))
        .limit(1)
    : [];

  const events = await eventsForTurns([turn.id]);
  const visits = stageVisitsFromEvents(events, turn.readyAt ?? now);
  const p75 = await stageP75ForProperty(turn.propertyId, now);
  const daysVacant =
    typeof turn.daysVacant === "number"
      ? turn.daysVacant
      : turn.actualVacateAt
        ? Math.max(0, calendarDaysBetween(turn.actualVacateAt, turn.readyAt ?? now, turn.timezone))
        : 0;

  const band = visits.map((v) => ({
    stage: v.stage,
    owner: v.owner,
    visitIndex: v.visitIndex,
    enteredAt: v.enteredAt.toISOString(),
    exitedAt: v.exitedAt ? v.exitedAt.toISOString() : null,
    durationMs: Number(v.durationMs),
    durationLabel: formatStageClock(v.durationMs),
    actorId: v.actorId,
    clientOwnedLabel: clientOwnedLabel(v),
  }));
  const bandDurationMs = band.reduce((s, r) => s + r.durationMs, 0);

  const activity = events
    .map((ev) => ({
      id: ev.id,
      kind: "stage" as const,
      at: ev.occurredAt.toISOString(),
      summary:
        ev.event === "entered"
          ? `Entered ${STAGE_LABEL[ev.stage]}`
          : `Left ${STAGE_LABEL[ev.stage]}`,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));

  const pendingVariance = await db
    .select({ id: clientScopeLinesTable.id })
    .from(clientScopeLinesTable)
    .innerJoin(clientScopesTable, eq(clientScopesTable.id, clientScopeLinesTable.scopeId))
    .where(
      and(
        eq(clientScopesTable.turnId, turn.id),
        eq(clientScopeLinesTable.compliance, "variance_pending"),
      ),
    )
    .limit(1);

  const actions: Array<{
    id: "approve_scope" | "approve_variance" | "request_work";
    label: string;
  }> = [];
  if (turn.status === "pending_approval") {
    actions.push({ id: "approve_scope", label: "Approve scope" });
  }
  if (pendingVariance.length) {
    actions.push({ id: "approve_variance", label: "Approve variance" });
  }
  if (turn.status === "notice") {
    actions.push({ id: "request_work", label: "Request work" });
  }

  return {
    turnId: turn.id,
    propertyId: turn.propertyId,
    propertyName: turn.propertyName,
    unitNumber: turn.unitNumber,
    bedrooms: turn.bedrooms,
    status: turn.status,
    daysVacant,
    isStalled: Boolean(turn.isStalled),
    workSource: turn.workSource,
    vendorName: vendor?.name ?? null,
    ring: ringFromVisits(
      visits,
      daysVacant,
      turn.predictedReadyAt,
      turn.predictionConfidence,
      now,
      p75,
    ),
    band,
    bandDurationMs,
    activity,
    actions,
    evidencePlaceholder: "Evidence lands in Segment 5.",
    scopePlaceholder: "Scope and pricing land in Segment 6.",
  };
}

export async function approveTurnScope(args: {
  turnId: string;
  orgId: string;
  actorId: string;
  idempotencyKey: string;
  ip?: string;
  userAgent?: string;
}) {
  const [turn] = await db
    .select({ status: clientTurnsTable.status, orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, args.turnId))
    .limit(1);
  if (!turn || turn.orgId !== args.orgId) throw new TurnBoardNotFoundError();
  if (turn.status !== "pending_approval") {
    throw new TurnActionConflictError("This turn is not waiting on scope approval");
  }
  try {
    return await transitionTurn({
      orgId: args.orgId,
      turnId: args.turnId,
      to: "approved",
      source: "app",
      actorId: args.actorId,
      idempotencyKey: args.idempotencyKey,
      ip: args.ip,
      userAgent: args.userAgent,
    });
  } catch (err) {
    if (err instanceof IllegalTurnTransitionError) {
      throw new TurnActionConflictError(err.message);
    }
    throw err;
  }
}

export async function approveTurnVariance(args: {
  turnId: string;
  orgId: string;
  actorId: string;
  idempotencyKey: string;
  ip?: string;
  userAgent?: string;
}) {
  const [turn] = await db
    .select({ status: clientTurnsTable.status, orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, args.turnId))
    .limit(1);
  if (!turn || turn.orgId !== args.orgId) throw new TurnBoardNotFoundError();

  const lines = await db
    .select({ id: clientScopeLinesTable.id })
    .from(clientScopeLinesTable)
    .innerJoin(clientScopesTable, eq(clientScopesTable.id, clientScopeLinesTable.scopeId))
    .where(
      and(
        eq(clientScopesTable.turnId, args.turnId),
        eq(clientScopeLinesTable.compliance, "variance_pending"),
      ),
    );
  if (lines.length === 0) {
    throw new TurnActionConflictError("No pending variance");
  }
  const now = new Date();
  await db
    .update(clientScopeLinesTable)
    .set({
      compliance: "variance_approved",
      approvedBy: args.actorId,
      approvedAt: now,
    })
    .where(
      inArray(
        clientScopeLinesTable.id,
        lines.map((l) => l.id),
      ),
    );
  await db.insert(clientAuditLogTable).values({
    orgId: args.orgId,
    actorId: args.actorId,
    entityType: "turn",
    entityId: args.turnId,
    action: "approve_variance",
    before: { lineIds: lines.map((l) => l.id) },
    after: { compliance: "variance_approved", idempotencyKey: args.idempotencyKey },
    occurredAt: now,
    ip: args.ip ?? null,
    userAgent: args.userAgent ?? null,
  });
  return {
    turnId: args.turnId,
    from: turn.status,
    to: turn.status,
    occurredAt: now.toISOString(),
  };
}

export async function requestTurnWork(args: {
  turnId: string;
  orgId: string;
  actorId: string;
  idempotencyKey: string;
  ip?: string;
  userAgent?: string;
}) {
  const [turn] = await db
    .select({ status: clientTurnsTable.status, orgId: clientTurnsTable.orgId })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.id, args.turnId))
    .limit(1);
  if (!turn || turn.orgId !== args.orgId) throw new TurnBoardNotFoundError();
  if (turn.status !== "notice") {
    throw new TurnActionConflictError("Work can only be requested from notice");
  }
  try {
    return await transitionTurn({
      orgId: args.orgId,
      turnId: args.turnId,
      to: "vacated",
      source: "app",
      actorId: args.actorId,
      idempotencyKey: args.idempotencyKey,
      ip: args.ip,
      userAgent: args.userAgent,
    });
  } catch (err) {
    if (err instanceof IllegalTurnTransitionError) {
      throw new TurnActionConflictError(err.message);
    }
    throw err;
  }
}
