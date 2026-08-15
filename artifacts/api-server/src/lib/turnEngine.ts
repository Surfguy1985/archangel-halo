/**
 * Client Board v1 — Segment 2 turn engine.
 *
 * Library only: no HTTP, no Pulse UI. Callers (tests now; OpenAPI in Segment 4)
 * pass orgId from the session — never from a request body the client chose.
 *
 * TurnMetrics.compute loads events and calls computeTurnMetrics. Do not invent
 * a second days/hours/cents formula here.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientTurnsTable,
  clientTurnStageEventsTable,
  clientTurnMetricsMvTable,
  clientUnitsTable,
  clientAuditLogTable,
  clientIdempotencyKeysTable,
  clientPredictionLogTable,
  clientTurnOutboxTable,
  clientPortfolioPropertiesTable,
  clientPortfoliosTable,
  clientOrgMembersTable,
  clientPortfolioNotificationsTable,
  clientVendorScorecardsTable,
  TURN_STAGES,
  WORK_SOURCES,
  computeTurnMetrics,
  assertLegalTransition,
  legalNextStages,
  predictReadyAt,
  p75Ms,
  p90,
  medianMs,
  isStalledStage,
  addCivilDaysInZone,
  IllegalTurnTransitionError,
  TerminalTurnError,
  type TurnStage,
  type WorkSource,
  type TurnMetricsResult,
  type PredictionConfidence,
  type StageSample,
  type ClientTurnOutboxPayload,
} from "@workspace/db";
import { logger } from "./logger";
import { publishTurnBoardChange, type PortfolioSseFrame } from "./clientPortfolioEvents";

export { IllegalTurnTransitionError, TerminalTurnError };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const SOURCE = z.enum(["app", "import", "system"]);
const STAGE = z.enum(TURN_STAGES);

export class TurnNotFoundError extends Error {
  readonly code = "turn_not_found" as const;
  constructor() {
    super("Turn not found");
    this.name = "TurnNotFoundError";
  }
}

export class UnitNotFoundError extends Error {
  readonly code = "unit_not_found" as const;
  constructor() {
    super("Unit not found in this org");
    this.name = "UnitNotFoundError";
  }
}

export class OpenTurnExistsError extends Error {
  readonly code = "open_turn_exists" as const;
  constructor() {
    super("This unit already has an open turn");
    this.name = "OpenTurnExistsError";
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = "idempotency_conflict" as const;
  constructor() {
    super("Idempotency-Key was reused with a different request");
    this.name = "IdempotencyConflictError";
  }
}

export class PortfolioNotFoundError extends Error {
  readonly code = "portfolio_not_found" as const;
  constructor() {
    super("Portfolio not found");
    this.name = "PortfolioNotFoundError";
  }
}

const createTurnSchema = z.object({
  orgId: z.string().uuid(),
  propertyId: z.string().uuid(),
  unitId: z.string().uuid(),
  workSource: z.enum(WORK_SOURCES).default("third_party"),
  assignedVendorOrgId: z.string().uuid().nullable().optional(),
  noticeGivenAt: z.coerce.date().nullable().optional(),
  scheduledVacateAt: z.coerce.date().nullable().optional(),
  actorId: z.string().nullable().optional(),
  actorOrgId: z.string().uuid().nullable().optional(),
  source: SOURCE.default("app"),
  occurredAt: z.coerce.date().optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

const transitionSchema = z.object({
  orgId: z.string().uuid(),
  turnId: z.string().uuid(),
  to: STAGE,
  actorId: z.string().nullable().optional(),
  actorOrgId: z.string().uuid().nullable().optional(),
  source: SOURCE.default("app"),
  occurredAt: z.coerce.date().optional(),
  idempotencyKey: z.string().min(1).max(256).optional(),
  ip: z.string().optional(),
  userAgent: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
});

const portfolioRangeSchema = z.object({
  orgId: z.string().uuid(),
  portfolioId: z.string().uuid(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

export type CreateTurnInput = z.input<typeof createTurnSchema>;
export type TransitionTurnInput = z.input<typeof transitionSchema>;
export type PortfolioMetricsInput = z.input<typeof portfolioRangeSchema>;

export type TransitionResult = {
  turnId: string;
  from: TurnStage;
  to: TurnStage;
  occurredAt: string;
  eventIds: string[];
};

export type CreateTurnResult = {
  turnId: string;
  from: null;
  to: "notice";
  occurredAt: string;
  eventIds: string[];
};

export type TurnMetricsComputeResult = TurnMetricsResult & {
  turnId: string;
  currentStage: TurnStage;
  currentStageMs: number;
  isStalled: boolean;
  stageP75Ms: number | null;
};

export type PropertyPortfolioRank = {
  propertyId: string;
  name: string;
  openTurns: number;
  liveVacancyCostCents: bigint;
  medianTurnDays: number | null;
  rank: number;
};

export type PortfolioMetricsResult = {
  portfolioId: string;
  liveVacancyCostCents: bigint;
  openTurns: number;
  unitsByStage: Record<TurnStage, number>;
  medianTurnDays: number | null;
  p90TurnDays: number | null;
  momDeltaDays: number | null;
  properties: PropertyPortfolioRank[];
};

function sha256(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "23505" || e.cause?.code === "23505";
}

function resolveOccurredAt(
  source: "app" | "import" | "system",
  provided: Date | undefined,
  receivedAt: Date,
): { occurredAt: Date; clockSkewSeconds: number | null } {
  if (source === "app") {
    return { occurredAt: receivedAt, clockSkewSeconds: null };
  }
  const occurredAt = provided ?? receivedAt;
  const clockSkewSeconds = provided
    ? Math.round((provided.getTime() - receivedAt.getTime()) / 1000)
    : null;
  return { occurredAt, clockSkewSeconds };
}

async function readIdempotency<T>(
  orgId: string,
  key: string | undefined,
  requestHash: string,
): Promise<T | null> {
  if (!key) return null;
  const [row] = await db
    .select()
    .from(clientIdempotencyKeysTable)
    .where(
      and(
        eq(clientIdempotencyKeysTable.orgId, orgId),
        eq(clientIdempotencyKeysTable.key, key),
      ),
    )
    .limit(1);
  if (!row) return null;
  if (row.requestHash !== requestHash) throw new IdempotencyConflictError();
  return row.responseBody as T;
}

async function writeIdempotency(
  tx: Tx,
  orgId: string,
  key: string | undefined,
  requestHash: string,
  body: unknown,
): Promise<void> {
  if (!key) return;
  await tx.insert(clientIdempotencyKeysTable).values({
    orgId,
    key,
    requestHash,
    responseStatus: 200,
    responseBody: body,
  });
}

function emptyStageCounts(): Record<TurnStage, number> {
  return Object.fromEntries(TURN_STAGES.map((s) => [s, 0])) as Record<TurnStage, number>;
}

function completedDurationsByStage(
  events: { id: string; stage: TurnStage; event: "entered" | "exited"; occurredAt: Date }[],
): Map<TurnStage, number[]> {
  const sorted = [...events].sort((a, b) => {
    const dt = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });
  const entered = new Map<TurnStage, Date[]>();
  const out = new Map<TurnStage, number[]>();
  for (const ev of sorted) {
    if (ev.event === "entered") {
      const bag = entered.get(ev.stage) ?? [];
      bag.push(ev.occurredAt);
      entered.set(ev.stage, bag);
    } else {
      const bag = entered.get(ev.stage) ?? [];
      const start = bag.shift();
      entered.set(ev.stage, bag);
      if (!start) continue;
      const ms = Math.max(0, ev.occurredAt.getTime() - start.getTime());
      const list = out.get(ev.stage) ?? [];
      list.push(ms);
      out.set(ev.stage, list);
    }
  }
  return out;
}

function currentOpenMs(
  events: { id: string; stage: TurnStage; event: "entered" | "exited"; occurredAt: Date }[],
  stage: TurnStage,
  now: Date,
): number {
  const sorted = [...events].sort((a, b) => {
    const dt = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (dt !== 0) return dt;
    return a.id.localeCompare(b.id);
  });
  let open: Date | null = null;
  for (const ev of sorted) {
    if (ev.stage !== stage) continue;
    if (ev.event === "entered") open = ev.occurredAt;
    else open = null;
  }
  if (!open) return 0;
  return Math.max(0, now.getTime() - open.getTime());
}

async function loadTurnScoped(orgId: string, turnId: string, tx: Tx | typeof db = db) {
  const [row] = await tx
    .select({
      turn: clientTurnsTable,
      timezone: propertiesTable.timezone,
      targetTurnDays: propertiesTable.targetTurnDays,
      unitBedrooms: clientUnitsTable.bedrooms,
      marketRentCents: clientUnitsTable.marketRentCents,
      propertyName: propertiesTable.name,
    })
    .from(clientTurnsTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientTurnsTable.propertyId))
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .where(and(eq(clientTurnsTable.id, turnId), eq(clientTurnsTable.orgId, orgId)))
    .limit(1);
  if (!row) throw new TurnNotFoundError();
  return row;
}

async function loadEvents(turnId: string, tx: Tx | typeof db = db) {
  return tx
    .select()
    .from(clientTurnStageEventsTable)
    .where(eq(clientTurnStageEventsTable.turnId, turnId));
}

async function portfolioIdsForProperty(propertyId: string): Promise<string[]> {
  const rows = await db
    .select({ portfolioId: clientPortfolioPropertiesTable.portfolioId })
    .from(clientPortfolioPropertiesTable)
    .where(eq(clientPortfolioPropertiesTable.propertyId, propertyId));
  return rows.map((r) => r.portfolioId);
}

async function notifyOrg(
  orgId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const members = await db
    .select({ userId: clientOrgMembersTable.userId })
    .from(clientOrgMembersTable)
    .where(eq(clientOrgMembersTable.orgId, orgId));
  if (members.length === 0) return;
  await db.insert(clientPortfolioNotificationsTable).values(
    members.map((m) => ({
      userId: m.userId,
      kind,
      payload,
    })),
  );
}

async function processStageOutbox(input: {
  orgId: string;
  turnId: string;
  propertyId: string;
  from: TurnStage | null;
  to: TurnStage;
  occurredAt: Date;
}): Promise<void> {
  const metrics = await computeTurnMetricsForId(input.orgId, input.turnId);
  const prediction = await persistReadyPrediction(input.orgId, input.turnId);
  const portfolios = await portfolioIdsForProperty(input.propertyId);
  const frames: PortfolioSseFrame[] = [
    {
      type: "turn.stage_changed",
      turnId: input.turnId,
      propertyId: input.propertyId,
      from: input.from,
      to: input.to,
      occurredAt: input.occurredAt.toISOString(),
    },
    {
      type: "turn.metrics_updated",
      turnId: input.turnId,
      propertyId: input.propertyId,
      isStalled: metrics.isStalled,
    },
  ];
  if (prediction) {
    frames.push({
      type: "turn.predicted",
      turnId: input.turnId,
      propertyId: input.propertyId,
      predictedReadyAt: prediction.predictedReadyAt.toISOString(),
      confidence: prediction.confidence,
    });
  }
  for (const frame of frames) {
    publishTurnBoardChange(input.propertyId, portfolios, frame);
  }
  if (input.to === "pending_approval") {
    await notifyOrg(input.orgId, "approval_needed", {
      turnId: input.turnId,
      propertyId: input.propertyId,
    });
  }
  if (metrics.isStalled) {
    await notifyOrg(input.orgId, "turn_stalled", {
      turnId: input.turnId,
      propertyId: input.propertyId,
      stage: metrics.currentStage,
    });
  }
}

async function enqueueStageOutbox(
  tx: Tx,
  input: {
    orgId: string;
    turnId: string;
    propertyId: string;
    from: TurnStage | null;
    to: TurnStage;
    occurredAt: Date;
    eventIds: string[];
  },
): Promise<void> {
  const payload: ClientTurnOutboxPayload = {
    from: input.from,
    to: input.to,
    occurredAt: input.occurredAt.toISOString(),
    eventIds: input.eventIds,
  };
  await tx.insert(clientTurnOutboxTable).values({
    turnId: input.turnId,
    orgId: input.orgId,
    propertyId: input.propertyId,
    kind: "stage_changed",
    payload,
  });
}

type ClaimedOutbox = {
  id: string;
  turn_id: string;
  org_id: string;
  property_id: string;
  payload: ClientTurnOutboxPayload | string;
};

/**
 * Durable outbox worker. Stage events enqueue a row in the same transaction.
 * If the process dies after commit, this sweep (scheduler tick or next mutation)
 * still delivers metrics, prediction, SSE, and notifications.
 */
export async function deliverClientTurnOutbox(): Promise<number> {
  let delivered = 0;
  for (;;) {
    const claimed = await db.execute(sql`
      UPDATE client_turn_outbox AS o
      SET attempts = o.attempts + 1
      WHERE o.id IN (
        SELECT id FROM client_turn_outbox
        WHERE processed_at IS NULL AND attempts < 32
        ORDER BY created_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED
      )
      RETURNING o.id, o.turn_id, o.org_id, o.property_id, o.payload
    `);
    const raw = claimed as unknown as { rows?: ClaimedOutbox[] };
    const rows = raw.rows ?? [];
    if (rows.length === 0) break;
    for (const row of rows) {
      try {
        const payload =
          typeof row.payload === "string"
            ? (JSON.parse(row.payload) as ClientTurnOutboxPayload)
            : row.payload;
        await processStageOutbox({
          orgId: row.org_id,
          turnId: row.turn_id,
          propertyId: row.property_id,
          from: payload.from,
          to: payload.to,
          occurredAt: new Date(payload.occurredAt),
        });
        await db
          .update(clientTurnOutboxTable)
          .set({ processedAt: new Date(), lastError: null })
          .where(eq(clientTurnOutboxTable.id, row.id));
        delivered += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(clientTurnOutboxTable)
          .set({ lastError: message.slice(0, 500) })
          .where(eq(clientTurnOutboxTable.id, row.id));
        logger.warn(
          { err, outboxId: row.id, turnId: row.turn_id },
          "client-board: outbox row failed; will retry",
        );
      }
    }
  }
  return delivered;
}

export async function createTurn(raw: CreateTurnInput): Promise<CreateTurnResult> {
  const input = createTurnSchema.parse(raw);
  const receivedAt = new Date();
  const { occurredAt, clockSkewSeconds } = resolveOccurredAt(
    input.source,
    input.occurredAt,
    receivedAt,
  );
  const requestHash = sha256({
    op: "createTurn",
    propertyId: input.propertyId,
    unitId: input.unitId,
    workSource: input.workSource,
    source: input.source,
    occurredAt: input.source === "app" ? null : occurredAt.toISOString(),
  });
  const replay = await readIdempotency<CreateTurnResult>(
    input.orgId,
    input.idempotencyKey,
    requestHash,
  );
  if (replay) {
    await deliverClientTurnOutbox();
    return replay;
  }

  let result: CreateTurnResult;
  try {
    result = await db.transaction(async (tx) => {
      const [unit] = await tx
        .select({
          id: clientUnitsTable.id,
          propertyId: clientUnitsTable.propertyId,
          clientOrgId: propertiesTable.clientOrgId,
          timezone: propertiesTable.timezone,
          targetTurnDays: propertiesTable.targetTurnDays,
        })
        .from(clientUnitsTable)
        .innerJoin(propertiesTable, eq(propertiesTable.id, clientUnitsTable.propertyId))
        .where(
          and(
            eq(clientUnitsTable.id, input.unitId),
            eq(clientUnitsTable.propertyId, input.propertyId),
            eq(propertiesTable.clientOrgId, input.orgId),
          ),
        )
        .limit(1);
      if (!unit) throw new UnitNotFoundError();

      const [open] = await tx
        .select({ id: clientTurnsTable.id })
        .from(clientTurnsTable)
        .where(
          and(eq(clientTurnsTable.unitId, input.unitId), isNull(clientTurnsTable.readyAt)),
        )
        .limit(1);
      if (open) throw new OpenTurnExistsError();

      const basis = input.scheduledVacateAt ?? occurredAt;
      const targetReadyAt = addCivilDaysInZone(basis, unit.targetTurnDays, unit.timezone);
      const noticeGivenAt = input.noticeGivenAt ?? occurredAt;

      const [turn] = await tx
        .insert(clientTurnsTable)
        .values({
          unitId: input.unitId,
          propertyId: input.propertyId,
          orgId: input.orgId,
          status: "notice",
          noticeGivenAt,
          scheduledVacateAt: input.scheduledVacateAt ?? null,
          targetReadyAt,
          workSource: input.workSource as WorkSource,
          assignedVendorOrgId: input.assignedVendorOrgId ?? null,
        })
        .returning();

      const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
      if (clockSkewSeconds != null) meta.clock_skew_seconds = clockSkewSeconds;

      const [entered] = await tx
        .insert(clientTurnStageEventsTable)
        .values({
          turnId: turn!.id,
          stage: "notice",
          event: "entered",
          occurredAt,
          actorId: input.actorId ?? null,
          actorOrgId: input.actorOrgId ?? null,
          source: input.source,
          meta: Object.keys(meta).length > 0 ? meta : null,
          receivedAt,
        })
        .returning({ id: clientTurnStageEventsTable.id });

      await tx.insert(clientAuditLogTable).values({
        orgId: input.orgId,
        actorId: input.actorId ?? null,
        entityType: "turn",
        entityId: turn!.id,
        action: "created",
        before: null,
        after: { status: "notice", eventId: entered!.id },
        occurredAt: receivedAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });

      const body: CreateTurnResult = {
        turnId: turn!.id,
        from: null,
        to: "notice",
        occurredAt: occurredAt.toISOString(),
        eventIds: [entered!.id],
      };
      await enqueueStageOutbox(tx, {
        orgId: input.orgId,
        turnId: turn!.id,
        propertyId: input.propertyId,
        from: null,
        to: "notice",
        occurredAt,
        eventIds: body.eventIds,
      });
      await writeIdempotency(tx, input.orgId, input.idempotencyKey, requestHash, body);
      return body;
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const again = await readIdempotency<CreateTurnResult>(
        input.orgId,
        input.idempotencyKey,
        requestHash,
      );
      if (again) {
        await deliverClientTurnOutbox();
        return again;
      }
    }
    throw err;
  }

  await deliverClientTurnOutbox();
  return result;
}

export async function transitionTurn(raw: TransitionTurnInput): Promise<TransitionResult> {
  const input = transitionSchema.parse(raw);
  const receivedAt = new Date();
  const { occurredAt, clockSkewSeconds } = resolveOccurredAt(
    input.source,
    input.occurredAt,
    receivedAt,
  );
  const requestHash = sha256({
    op: "transitionTurn",
    turnId: input.turnId,
    to: input.to,
    source: input.source,
    occurredAt: input.source === "app" ? null : occurredAt.toISOString(),
  });
  const replay = await readIdempotency<TransitionResult>(
    input.orgId,
    input.idempotencyKey,
    requestHash,
  );
  if (replay) {
    await deliverClientTurnOutbox();
    return replay;
  }

  let propertyId = "";
  let from: TurnStage = "notice";
  let result: TransitionResult;
  try {
    result = await db.transaction(async (tx) => {
      const ctx = await loadTurnScoped(input.orgId, input.turnId, tx);
      from = ctx.turn.status;
      propertyId = ctx.turn.propertyId;
      assertLegalTransition(from, input.to);

      const meta: Record<string, unknown> = { ...(input.meta ?? {}) };
      if (clockSkewSeconds != null) meta.clock_skew_seconds = clockSkewSeconds;
      const metaVal = Object.keys(meta).length > 0 ? meta : null;

      const [exited] = await tx
        .insert(clientTurnStageEventsTable)
        .values({
          turnId: input.turnId,
          stage: from,
          event: "exited",
          occurredAt,
          actorId: input.actorId ?? null,
          actorOrgId: input.actorOrgId ?? null,
          source: input.source,
          meta: metaVal,
          receivedAt,
        })
        .returning({ id: clientTurnStageEventsTable.id });

      const [entered] = await tx
        .insert(clientTurnStageEventsTable)
        .values({
          turnId: input.turnId,
          stage: input.to,
          event: "entered",
          occurredAt,
          actorId: input.actorId ?? null,
          actorOrgId: input.actorOrgId ?? null,
          source: input.source,
          meta: metaVal,
          receivedAt,
        })
        .returning({ id: clientTurnStageEventsTable.id });

      const patch: Partial<typeof clientTurnsTable.$inferInsert> = {
        status: input.to,
        updatedAt: receivedAt,
      };
      if (input.to === "vacated" && !ctx.turn.actualVacateAt) {
        patch.actualVacateAt = occurredAt;
        patch.targetReadyAt = addCivilDaysInZone(
          occurredAt,
          ctx.targetTurnDays,
          ctx.timezone,
        );
      }
      if (input.to === "ready") {
        patch.readyAt = occurredAt;
      }

      await tx
        .update(clientTurnsTable)
        .set(patch)
        .where(eq(clientTurnsTable.id, input.turnId));

      if (input.to === "ready") {
        await tx
          .update(clientPredictionLogTable)
          .set({ actualReadyAt: occurredAt })
          .where(
            and(
              eq(clientPredictionLogTable.turnId, input.turnId),
              isNull(clientPredictionLogTable.actualReadyAt),
            ),
          );
      }

      await tx.insert(clientAuditLogTable).values({
        orgId: input.orgId,
        actorId: input.actorId ?? null,
        entityType: "turn",
        entityId: input.turnId,
        action: "stage_transition",
        before: { status: from },
        after: { status: input.to, eventIds: [exited!.id, entered!.id] },
        occurredAt: receivedAt,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      });

      const body: TransitionResult = {
        turnId: input.turnId,
        from,
        to: input.to,
        occurredAt: occurredAt.toISOString(),
        eventIds: [exited!.id, entered!.id],
      };
      await enqueueStageOutbox(tx, {
        orgId: input.orgId,
        turnId: input.turnId,
        propertyId,
        from,
        to: input.to,
        occurredAt,
        eventIds: body.eventIds,
      });
      await writeIdempotency(tx, input.orgId, input.idempotencyKey, requestHash, body);
      return body;
    });
  } catch (err) {
    if (input.idempotencyKey && isUniqueViolation(err)) {
      const again = await readIdempotency<TransitionResult>(
        input.orgId,
        input.idempotencyKey,
        requestHash,
      );
      if (again) {
        await deliverClientTurnOutbox();
        return again;
      }
    }
    throw err;
  }

  await deliverClientTurnOutbox();
  return result;
}

/** TurnMetrics.compute(turnId) — formula stays in computeTurnMetrics. */
export async function computeTurnMetricsForId(
  orgId: string,
  turnId: string,
  now = new Date(),
): Promise<TurnMetricsComputeResult> {
  const ctx = await loadTurnScoped(orgId, turnId);
  const events = await loadEvents(turnId);
  const formula = computeTurnMetrics({
    timezone: ctx.timezone,
    targetTurnDays: ctx.targetTurnDays,
    marketRentCents: ctx.marketRentCents,
    actualVacateAt: ctx.turn.actualVacateAt,
    readyAt: ctx.turn.readyAt,
    now,
    events: events.map((e) => ({
      id: e.id,
      stage: e.stage,
      event: e.event,
      occurredAt: e.occurredAt,
    })),
  });

  const currentStage = ctx.turn.status;
  const currentStageMs = currentOpenMs(
    events.map((e) => ({
      id: e.id,
      stage: e.stage,
      event: e.event,
      occurredAt: e.occurredAt,
    })),
    currentStage,
    ctx.turn.readyAt ?? now,
  );

  const since = new Date(now.getTime() - 90 * 86_400_000);
  const peerEvents = await db
    .select({
      id: clientTurnStageEventsTable.id,
      stage: clientTurnStageEventsTable.stage,
      event: clientTurnStageEventsTable.event,
      occurredAt: clientTurnStageEventsTable.occurredAt,
      turnId: clientTurnStageEventsTable.turnId,
    })
    .from(clientTurnStageEventsTable)
    .innerJoin(
      clientTurnsTable,
      eq(clientTurnsTable.id, clientTurnStageEventsTable.turnId),
    )
    .where(
      and(
        eq(clientTurnsTable.propertyId, ctx.turn.propertyId),
        eq(clientTurnStageEventsTable.stage, currentStage),
        gte(clientTurnStageEventsTable.occurredAt, since),
      ),
    );

  const byTurn = new Map<string, typeof peerEvents>();
  for (const ev of peerEvents) {
    const list = byTurn.get(ev.turnId) ?? [];
    list.push(ev);
    byTurn.set(ev.turnId, list);
  }
  const samples: number[] = [];
  for (const [peerTurnId, evs] of byTurn) {
    if (peerTurnId === turnId) continue;
    const completed = completedDurationsByStage(evs).get(currentStage) ?? [];
    samples.push(...completed);
  }
  const stageP75 = p75Ms(samples);
  const stalledTs = isStalledStage(currentStageMs, stageP75);

  await db.execute(
    sql`SELECT refresh_client_turn_metrics(${turnId}::uuid, ${now}::timestamptz)`,
  );
  const [mv] = await db
    .select({ isStalled: clientTurnMetricsMvTable.isStalled })
    .from(clientTurnMetricsMvTable)
    .where(eq(clientTurnMetricsMvTable.turnId, turnId))
    .limit(1);

  return {
    ...formula,
    turnId,
    currentStage,
    currentStageMs,
    isStalled: mv?.isStalled ?? stalledTs,
    stageP75Ms: stageP75,
  };
}

async function stageSamplesForPropertyBedroom(input: {
  propertyId: string;
  bedrooms: number;
  since: Date;
  excludeTurnId: string;
}): Promise<StageSample[]> {
  const peerTurns = await db
    .select({ id: clientTurnsTable.id })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .where(
      and(
        eq(clientTurnsTable.propertyId, input.propertyId),
        eq(clientUnitsTable.bedrooms, input.bedrooms),
      ),
    );
  const ids = peerTurns.map((t) => t.id).filter((id) => id !== input.excludeTurnId);
  if (ids.length === 0) return [];

  const events = await db
    .select({
      id: clientTurnStageEventsTable.id,
      turnId: clientTurnStageEventsTable.turnId,
      stage: clientTurnStageEventsTable.stage,
      event: clientTurnStageEventsTable.event,
      occurredAt: clientTurnStageEventsTable.occurredAt,
    })
    .from(clientTurnStageEventsTable)
    .where(
      and(
        inArray(clientTurnStageEventsTable.turnId, ids),
        gte(clientTurnStageEventsTable.occurredAt, input.since),
      ),
    );

  const byTurn = new Map<string, typeof events>();
  for (const ev of events) {
    const list = byTurn.get(ev.turnId) ?? [];
    list.push(ev);
    byTurn.set(ev.turnId, list);
  }
  const acc = new Map<TurnStage, number[]>();
  for (const evs of byTurn.values()) {
    const completed = completedDurationsByStage(evs);
    for (const [stage, durations] of completed) {
      const list = acc.get(stage) ?? [];
      list.push(...durations);
      acc.set(stage, list);
    }
  }
  return [...acc.entries()].map(([stage, durationsMs]) => ({ stage, durationsMs }));
}

export async function persistReadyPrediction(
  orgId: string,
  turnId: string,
  now = new Date(),
) {
  const ctx = await loadTurnScoped(orgId, turnId);
  if (ctx.turn.status === "ready") {
    const predictedReadyAt = ctx.turn.readyAt ?? now;
    await db.insert(clientPredictionLogTable).values({
      turnId,
      predictedReadyAt,
      confidence: "high",
      predictedAt: now,
      actualReadyAt: predictedReadyAt,
      method: "terminal ready",
      sampleSize: 0,
    });
    await db
      .update(clientTurnsTable)
      .set({
        predictedReadyAt,
        predictionConfidence: "high",
        updatedAt: now,
      })
      .where(eq(clientTurnsTable.id, turnId));
    return {
      predictedReadyAt,
      confidence: "high" as PredictionConfidence,
      sampleSize: 0,
    };
  }

  const events = await loadEvents(turnId);
  const elapsed = currentOpenMs(
    events.map((e) => ({
      id: e.id,
      stage: e.stage,
      event: e.event,
      occurredAt: e.occurredAt,
    })),
    ctx.turn.status,
    now,
  );
  const samples = await stageSamplesForPropertyBedroom({
    propertyId: ctx.turn.propertyId,
    bedrooms: ctx.unitBedrooms,
    since: new Date(now.getTime() - 90 * 86_400_000),
    excludeTurnId: turnId,
  });

  let capacityUnitsPerWeek: number | null = null;
  let committedQueue: number | null = null;
  if (ctx.turn.assignedVendorOrgId) {
    const [card] = await db
      .select({
        capacityUnitsPerWeek: clientVendorScorecardsTable.capacityUnitsPerWeek,
      })
      .from(clientVendorScorecardsTable)
      .where(
        and(
          eq(clientVendorScorecardsTable.vendorOrgId, ctx.turn.assignedVendorOrgId),
          eq(clientVendorScorecardsTable.propertyId, ctx.turn.propertyId),
        ),
      )
      .orderBy(desc(clientVendorScorecardsTable.windowEnd))
      .limit(1);
    capacityUnitsPerWeek = card?.capacityUnitsPerWeek ?? null;

    const [queue] = await db
      .select({ n: count() })
      .from(clientTurnsTable)
      .where(
        and(
          eq(clientTurnsTable.assignedVendorOrgId, ctx.turn.assignedVendorOrgId),
          isNull(clientTurnsTable.readyAt),
          inArray(clientTurnsTable.status, [
            "scheduled",
            "in_progress",
            "qc",
            "rework",
          ]),
          ne(clientTurnsTable.id, turnId),
        ),
      );
    committedQueue = Number(queue?.n ?? 0);
  }

  const prediction = predictReadyAt({
    current: ctx.turn.status,
    now,
    elapsedInCurrentMs: elapsed,
    samples,
    capacityUnitsPerWeek,
    committedQueue,
  });

  await db.insert(clientPredictionLogTable).values({
    turnId,
    predictedReadyAt: prediction.predictedReadyAt,
    confidence: prediction.confidence,
    predictedAt: now,
    actualReadyAt: null,
    method: prediction.method,
    sampleSize: prediction.sampleSize,
  });
  await db
    .update(clientTurnsTable)
    .set({
      predictedReadyAt: prediction.predictedReadyAt,
      predictionConfidence: prediction.confidence,
      updatedAt: now,
    })
    .where(eq(clientTurnsTable.id, turnId));

  return prediction;
}

export async function computePortfolioMetrics(
  raw: PortfolioMetricsInput,
): Promise<PortfolioMetricsResult> {
  const input = portfolioRangeSchema.parse(raw);
  const [portfolio] = await db
    .select()
    .from(clientPortfoliosTable)
    .where(
      and(
        eq(clientPortfoliosTable.id, input.portfolioId),
        eq(clientPortfoliosTable.orgId, input.orgId),
      ),
    )
    .limit(1);
  if (!portfolio) throw new PortfolioNotFoundError();

  const linked = await db
    .select({
      propertyId: clientPortfolioPropertiesTable.propertyId,
      name: propertiesTable.name,
    })
    .from(clientPortfolioPropertiesTable)
    .innerJoin(
      propertiesTable,
      eq(propertiesTable.id, clientPortfolioPropertiesTable.propertyId),
    )
    .where(eq(clientPortfolioPropertiesTable.portfolioId, input.portfolioId));

  const propertyIds = linked.map((p) => p.propertyId);
  const unitsByStage = emptyStageCounts();
  if (propertyIds.length === 0) {
    return {
      portfolioId: input.portfolioId,
      liveVacancyCostCents: 0n,
      openTurns: 0,
      unitsByStage,
      medianTurnDays: null,
      p90TurnDays: null,
      momDeltaDays: null,
      properties: [],
    };
  }

  const turns = await db
    .select({
      id: clientTurnsTable.id,
      propertyId: clientTurnsTable.propertyId,
      status: clientTurnsTable.status,
      readyAt: clientTurnsTable.readyAt,
    })
    .from(clientTurnsTable)
    .where(inArray(clientTurnsTable.propertyId, propertyIds));

  const openTurns = turns.filter((t) => t.readyAt == null);
  for (const t of openTurns) unitsByStage[t.status] += 1;

  const metrics = turns.length
    ? await db
        .select()
        .from(clientTurnMetricsMvTable)
        .where(
          inArray(
            clientTurnMetricsMvTable.turnId,
            turns.map((t) => t.id),
          ),
        )
    : [];
  const metricsByTurn = new Map(metrics.map((m) => [m.turnId, m]));

  let liveVacancyCostCents = 0n;
  for (const t of openTurns) {
    liveVacancyCostCents += metricsByTurn.get(t.id)?.vacancyCostCents ?? 0n;
  }

  const completedHere = turns.filter(
    (t) => t.readyAt && t.readyAt >= input.from && t.readyAt <= input.to,
  );
  const daysHere = completedHere
    .map((t) => metricsByTurn.get(t.id)?.daysVacant)
    .filter((d): d is number => typeof d === "number");

  const spanMs = input.to.getTime() - input.from.getTime();
  const prevTo = input.from;
  const prevFrom = new Date(input.from.getTime() - Math.max(0, spanMs));
  const completedPrev = turns.filter(
    (t) => t.readyAt && t.readyAt >= prevFrom && t.readyAt < prevTo,
  );
  const daysPrev = completedPrev
    .map((t) => metricsByTurn.get(t.id)?.daysVacant)
    .filter((d): d is number => typeof d === "number");

  const medianTurnDays = medianMs(daysHere);
  const prevMedian = medianMs(daysPrev);
  const momDeltaDays =
    medianTurnDays != null && prevMedian != null ? medianTurnDays - prevMedian : null;

  const byProperty = new Map<
    string,
    { openTurns: number; liveVacancyCostCents: bigint; days: number[] }
  >();
  for (const p of linked) {
    byProperty.set(p.propertyId, { openTurns: 0, liveVacancyCostCents: 0n, days: [] });
  }
  for (const t of openTurns) {
    const bucket = byProperty.get(t.propertyId);
    if (!bucket) continue;
    bucket.openTurns += 1;
    bucket.liveVacancyCostCents += metricsByTurn.get(t.id)?.vacancyCostCents ?? 0n;
  }
  for (const t of completedHere) {
    const bucket = byProperty.get(t.propertyId);
    const days = metricsByTurn.get(t.id)?.daysVacant;
    if (bucket && typeof days === "number") bucket.days.push(days);
  }

  const properties: PropertyPortfolioRank[] = linked
    .map((p) => {
      const bucket = byProperty.get(p.propertyId)!;
      return {
        propertyId: p.propertyId,
        name: p.name,
        openTurns: bucket.openTurns,
        liveVacancyCostCents: bucket.liveVacancyCostCents,
        medianTurnDays: medianMs(bucket.days),
        rank: 0,
      };
    })
    .sort((a, b) => {
      const cost = b.liveVacancyCostCents === a.liveVacancyCostCents
        ? 0
        : b.liveVacancyCostCents > a.liveVacancyCostCents
          ? 1
          : -1;
      if (cost !== 0) return cost;
      return (b.medianTurnDays ?? -1) - (a.medianTurnDays ?? -1);
    });
  properties.forEach((p, i) => {
    p.rank = i + 1;
  });

  return {
    portfolioId: input.portfolioId,
    liveVacancyCostCents,
    openTurns: openTurns.length,
    unitsByStage,
    medianTurnDays,
    p90TurnDays: p90(daysHere),
    momDeltaDays,
    properties,
  };
}

export async function recomputeOpenTurnPredictions(opts?: {
  now?: Date;
  timezone?: string;
}): Promise<number> {
  const now = opts?.now ?? new Date();
  const timezone = opts?.timezone ?? null;
  await db.execute(
    sql`SELECT refresh_open_client_turn_metrics(${now}::timestamptz, ${timezone})`,
  );

  const open = await db
    .select({
      id: clientTurnsTable.id,
      orgId: clientTurnsTable.orgId,
      propertyId: clientTurnsTable.propertyId,
      status: clientTurnsTable.status,
      assignedVendorOrgId: clientTurnsTable.assignedVendorOrgId,
      readyAt: clientTurnsTable.readyAt,
      bedrooms: clientUnitsTable.bedrooms,
      timezone: propertiesTable.timezone,
    })
    .from(clientTurnsTable)
    .innerJoin(propertiesTable, eq(propertiesTable.id, clientTurnsTable.propertyId))
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .where(
      and(
        isNull(clientTurnsTable.readyAt),
        timezone ? eq(propertiesTable.timezone, timezone) : sql`true`,
      ),
    );
  if (open.length === 0) return 0;

  const propertyIds = [...new Set(open.map((t) => t.propertyId))];
  const since = new Date(now.getTime() - 90 * 86_400_000);

  const peerTurns = await db
    .select({
      id: clientTurnsTable.id,
      propertyId: clientTurnsTable.propertyId,
      bedrooms: clientUnitsTable.bedrooms,
    })
    .from(clientTurnsTable)
    .innerJoin(clientUnitsTable, eq(clientUnitsTable.id, clientTurnsTable.unitId))
    .where(inArray(clientTurnsTable.propertyId, propertyIds));

  const peerIds = peerTurns.map((t) => t.id);
  const events =
    peerIds.length === 0
      ? []
      : await db
          .select({
            id: clientTurnStageEventsTable.id,
            turnId: clientTurnStageEventsTable.turnId,
            stage: clientTurnStageEventsTable.stage,
            event: clientTurnStageEventsTable.event,
            occurredAt: clientTurnStageEventsTable.occurredAt,
          })
          .from(clientTurnStageEventsTable)
          .where(
            and(
              inArray(clientTurnStageEventsTable.turnId, peerIds),
              gte(clientTurnStageEventsTable.occurredAt, since),
            ),
          );

  const eventsByTurn = new Map<string, typeof events>();
  for (const ev of events) {
    const list = eventsByTurn.get(ev.turnId) ?? [];
    list.push(ev);
    eventsByTurn.set(ev.turnId, list);
  }

  const sampleKey = (propertyId: string, bedrooms: number) => `${propertyId}:${bedrooms}`;
  const completedByTurn = new Map<string, Map<TurnStage, number[]>>();
  const turnIdsByKey = new Map<string, string[]>();
  for (const peer of peerTurns) {
    const key = sampleKey(peer.propertyId, peer.bedrooms);
    const list = turnIdsByKey.get(key) ?? [];
    list.push(peer.id);
    turnIdsByKey.set(key, list);
    completedByTurn.set(
      peer.id,
      completedDurationsByStage(eventsByTurn.get(peer.id) ?? []),
    );
  }

  function samplesExcluding(turnId: string, propertyId: string, bedrooms: number): StageSample[] {
    const acc = new Map<TurnStage, number[]>();
    for (const otherId of turnIdsByKey.get(sampleKey(propertyId, bedrooms)) ?? []) {
      if (otherId === turnId) continue;
      const completed = completedByTurn.get(otherId);
      if (!completed) continue;
      for (const [stage, durations] of completed) {
        const list = acc.get(stage) ?? [];
        list.push(...durations);
        acc.set(stage, list);
      }
    }
    return [...acc.entries()].map(([stage, durationsMs]) => ({ stage, durationsMs }));
  }

  const vendorIds = [
    ...new Set(open.map((t) => t.assignedVendorOrgId).filter((x): x is string => !!x)),
  ];
  const scorecards =
    vendorIds.length === 0
      ? []
      : await db
          .select({
            vendorOrgId: clientVendorScorecardsTable.vendorOrgId,
            propertyId: clientVendorScorecardsTable.propertyId,
            capacityUnitsPerWeek: clientVendorScorecardsTable.capacityUnitsPerWeek,
            windowEnd: clientVendorScorecardsTable.windowEnd,
          })
          .from(clientVendorScorecardsTable)
          .where(inArray(clientVendorScorecardsTable.vendorOrgId, vendorIds));
  const capByVendorProperty = new Map<string, { capacity: number; windowEnd: Date }>();
  for (const row of scorecards) {
    const key = `${row.vendorOrgId}:${row.propertyId}`;
    const prev = capByVendorProperty.get(key);
    if (!prev || row.windowEnd > prev.windowEnd) {
      capByVendorProperty.set(key, {
        capacity: row.capacityUnitsPerWeek,
        windowEnd: row.windowEnd,
      });
    }
  }

  const queueRows =
    vendorIds.length === 0
      ? []
      : await db
          .select({
            vendorOrgId: clientTurnsTable.assignedVendorOrgId,
            n: count(),
          })
          .from(clientTurnsTable)
          .where(
            and(
              inArray(clientTurnsTable.assignedVendorOrgId, vendorIds),
              isNull(clientTurnsTable.readyAt),
              inArray(clientTurnsTable.status, [
                "scheduled",
                "in_progress",
                "qc",
                "rework",
              ]),
            ),
          )
          .groupBy(clientTurnsTable.assignedVendorOrgId);
  const queueByVendor = new Map<string, number>();
  for (const row of queueRows) {
    if (row.vendorOrgId) queueByVendor.set(row.vendorOrgId, Number(row.n));
  }

  const logRows: {
    turnId: string;
    predictedReadyAt: Date;
    confidence: string;
    predictedAt: Date;
    actualReadyAt: Date | null;
    method: string;
    sampleSize: number;
  }[] = [];
  const turnPatches: { id: string; predictedReadyAt: Date; confidence: string }[] = [];

  for (const turn of open) {
    try {
      const evs = eventsByTurn.get(turn.id) ?? [];
      const elapsed = currentOpenMs(
        evs.map((e) => ({
          id: e.id,
          stage: e.stage,
          event: e.event,
          occurredAt: e.occurredAt,
        })),
        turn.status,
        now,
      );
      const samples = samplesExcluding(turn.id, turn.propertyId, turn.bedrooms);
      if (turn.status === "ready") continue;

      const cap = turn.assignedVendorOrgId
        ? capByVendorProperty.get(`${turn.assignedVendorOrgId}:${turn.propertyId}`)
            ?.capacity ?? null
        : null;
      let queue: number | null = null;
      if (turn.assignedVendorOrgId) {
        const raw = queueByVendor.get(turn.assignedVendorOrgId) ?? 0;
        const inQueue = ["scheduled", "in_progress", "qc", "rework"].includes(
          turn.status,
        );
        queue = Math.max(0, raw - (inQueue ? 1 : 0));
      }

      const prediction = predictReadyAt({
        current: turn.status,
        now,
        elapsedInCurrentMs: elapsed,
        samples,
        capacityUnitsPerWeek: cap,
        committedQueue: queue,
      });
      logRows.push({
        turnId: turn.id,
        predictedReadyAt: prediction.predictedReadyAt,
        confidence: prediction.confidence,
        predictedAt: now,
        actualReadyAt: null,
        method: prediction.method,
        sampleSize: prediction.sampleSize,
      });
      turnPatches.push({
        id: turn.id,
        predictedReadyAt: prediction.predictedReadyAt,
        confidence: prediction.confidence,
      });
    } catch (err) {
      logger.warn({ err, turnId: turn.id }, "client-board: nightly recompute skipped a turn");
    }
  }

  for (let i = 0; i < logRows.length; i += 200) {
    await db.insert(clientPredictionLogTable).values(logRows.slice(i, i + 200));
  }
  for (let i = 0; i < turnPatches.length; i += 200) {
    const chunk = turnPatches.slice(i, i + 200);
    await db.execute(sql`
      UPDATE client_turns AS t
      SET
        predicted_ready_at = u.predicted_ready_at,
        prediction_confidence = u.confidence,
        updated_at = ${now}
      FROM jsonb_to_recordset(${JSON.stringify(
        chunk.map((p) => ({
          id: p.id,
          predicted_ready_at: p.predictedReadyAt.toISOString(),
          confidence: p.confidence,
        })),
      )}::jsonb) AS u(id uuid, predicted_ready_at timestamptz, confidence text)
      WHERE t.id = u.id
    `);
  }
  return turnPatches.length;
}

export { legalNextStages };

export const TurnStateMachine = {
  create: createTurn,
  transition: transitionTurn,
};

export const TurnMetrics = {
  compute: computeTurnMetricsForId,
};

export const ReadyDatePredictor = {
  persist: persistReadyPrediction,
  recomputeOpen: recomputeOpenTurnPredictions,
};

export const PortfolioMetrics = {
  compute: computePortfolioMetrics,
};

