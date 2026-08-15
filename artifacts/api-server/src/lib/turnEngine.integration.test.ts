/**
 * Segment 2 engine against real Postgres. Cleans a double-marker fixture so
 * it cannot collide with the CAF Demo seed or the metrics golden.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientUnitsTable,
  clientTurnsTable,
  clientTurnStageEventsTable,
  clientTurnMetricsMvTable,
  clientPredictionLogTable,
  clientTurnOutboxTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientAuditLogTable,
  clientIdempotencyKeysTable,
  clientPortfolioNotificationsTable,
  zonedCivilToUtc,
  computeTurnMetrics,
  IllegalTurnTransitionError,
  TerminalTurnError,
  type TurnStage,
} from "@workspace/db";
import { ensureClientBoardSchema } from "./ensureClientBoardSchema";
import {
  createTurn,
  transitionTurn,
  computeTurnMetricsForId,
  computePortfolioMetrics,
  deliverClientTurnOutbox,
  recomputeOpenTurnPredictions,
  IdempotencyConflictError,
  OpenTurnExistsError,
} from "./turnEngine";
import { onPortfolioFrame } from "./clientPortfolioEvents";

const BRIEF = "CAF_CLIENT_BOARD_ENGINE_v1";
const CHICAGO = "America/Chicago";
const HAPPY: TurnStage[] = [
  "vacated",
  "walk",
  "scoped",
  "pending_approval",
  "approved",
  "scheduled",
  "in_progress",
  "qc",
  "ready",
];

describe("Turn engine (Postgres)", () => {
  let orgId = "";
  let propertyId = "";
  let unitId = "";
  let portfolioId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeEngine();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Engine Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: "caf-engine-seg2",
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Engine Org" },
      })
      .returning();
    orgId = org!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Engine — Paloma",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 8,
        status: "active",
      })
      .returning();
    propertyId = property!.id;

    const [unit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "101",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();
    unitId = unit!.id;

    const [portfolio] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "CAF Engine Portfolio" })
      .returning();
    portfolioId = portfolio!.id;
    await db.insert(clientPortfolioPropertiesTable).values({
      portfolioId,
      propertyId,
    });
  });

  afterAll(async () => {
    await wipeEngine();
  });

  it("refuses illegal transitions and does not append events", async () => {
    const created = await createTurn({
      orgId,
      propertyId,
      unitId,
      source: "import",
      occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 1, 10, 0, 0),
      actorId: "test:illegal",
    });
    const before = await countEvents(created.turnId);
    await expect(
      transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "walk",
        source: "import",
        occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 1, 11, 0, 0),
      }),
    ).rejects.toBeInstanceOf(IllegalTurnTransitionError);
    await expect(
      transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "rework",
        source: "import",
        occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 1, 11, 0, 0),
      }),
    ).rejects.toBeInstanceOf(IllegalTurnTransitionError);
    expect(await countEvents(created.turnId)).toBe(before);
  });

  it("blocks a second open turn on the same unit", async () => {
    await expect(
      createTurn({
        orgId,
        propertyId,
        unitId,
        source: "import",
        occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 2, 10, 0, 0),
      }),
    ).rejects.toBeInstanceOf(OpenTurnExistsError);
  });

  it("replays an Idempotency-Key and conflicts when the body changes", async () => {
    const unit = await insertUnit(propertyId, "102");
    const key = "seg2-create-102";
    const first = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "import",
      occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 3, 9, 0, 0),
      idempotencyKey: key,
    });
    const replay = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "import",
      occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 3, 9, 0, 0),
      idempotencyKey: key,
    });
    expect(replay.turnId).toBe(first.turnId);
    expect(await countEvents(first.turnId)).toBe(1);

    await expect(
      createTurn({
        orgId,
        propertyId,
        unitId: unit.id,
        source: "import",
        occurredAt: zonedCivilToUtc(CHICAGO, 2026, 6, 3, 10, 0, 0),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("six-day client approval via the state machine attributes hours to the client", async () => {
    const unit = await insertUnit(propertyId, "201");
    const vacate = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 10, 0, 0);
    const ready = zonedCivilToUtc(CHICAGO, 2026, 7, 12, 10, 0, 0);
    const approvalIn = zonedCivilToUtc(CHICAGO, 2026, 7, 2, 9, 0, 0);
    const approvalOut = zonedCivilToUtc(CHICAGO, 2026, 7, 8, 9, 0, 0);
    const times: Record<TurnStage, Date> = {
      notice: zonedCivilToUtc(CHICAGO, 2026, 6, 17, 10, 0, 0),
      vacated: vacate,
      walk: zonedCivilToUtc(CHICAGO, 2026, 7, 1, 14, 0, 0),
      scoped: zonedCivilToUtc(CHICAGO, 2026, 7, 1, 18, 0, 0),
      pending_approval: approvalIn,
      approved: approvalOut,
      scheduled: zonedCivilToUtc(CHICAGO, 2026, 7, 8, 11, 0, 0),
      in_progress: zonedCivilToUtc(CHICAGO, 2026, 7, 9, 11, 0, 0),
      qc: zonedCivilToUtc(CHICAGO, 2026, 7, 11, 11, 0, 0),
      rework: approvalIn,
      ready,
    };

    const frames: string[] = [];
    const stop = onPortfolioFrame(portfolioId, (f) => frames.push(f.type));

    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "import",
      occurredAt: times.notice,
      actorId: "test:six-day",
    });
    for (const to of HAPPY) {
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to,
        source: "import",
        occurredAt: times[to],
        actorId: "test:six-day",
      });
    }
    stop();

    await expect(
      transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "in_progress",
        source: "import",
        occurredAt: ready,
      }),
    ).rejects.toBeInstanceOf(TerminalTurnError);

    const metrics = await computeTurnMetricsForId(orgId, created.turnId, ready);
    const events = await db
      .select()
      .from(clientTurnStageEventsTable)
      .where(eq(clientTurnStageEventsTable.turnId, created.turnId));
    const expected = computeTurnMetrics({
      timezone: CHICAGO,
      targetTurnDays: 7,
      marketRentCents: 145000n,
      actualVacateAt: vacate,
      readyAt: ready,
      now: ready,
      events: events.map((e) => ({
        id: e.id,
        stage: e.stage,
        event: e.event,
        occurredAt: e.occurredAt,
      })),
    });

    expect(metrics.daysVacant).toBe(11);
    expect(metrics.overTargetDays).toBe(4);
    expect(metrics.vacancyCostCents).toBe(18709n);
    expect(metrics.clientOwnedHours).toBe("146.00");
    expect(metrics.clientOwnedMs).toBe(expected.clientOwnedMs);
    expect(metrics.vendorOwnedMs).toBe(expected.vendorOwnedMs);
    expect(frames).toContain("turn.stage_changed");
    expect(frames).toContain("turn.metrics_updated");
    expect(frames).toContain("turn.predicted");

    const [mv] = await db
      .select()
      .from(clientTurnMetricsMvTable)
      .where(eq(clientTurnMetricsMvTable.turnId, created.turnId));
    expect(mv?.daysVacant).toBe(11);
    expect(mv?.clientOwnedHours).toBe("146.00");

    const predictions = await db
      .select()
      .from(clientPredictionLogTable)
      .where(eq(clientPredictionLogTable.turnId, created.turnId));
    expect(predictions.length).toBeGreaterThan(0);
    expect(predictions.every((p) => p.actualReadyAt != null)).toBe(true);

    const audit = await db
      .select()
      .from(clientAuditLogTable)
      .where(eq(clientAuditLogTable.entityId, created.turnId));
    expect(audit.some((a) => a.action === "stage_transition")).toBe(true);
  });

  it("counts 3 calendar days / 71 elapsed hours across the 2026 spring-forward", async () => {
    const unit = await insertUnit(propertyId, "301");
    const vacate = zonedCivilToUtc(CHICAGO, 2026, 3, 7, 6, 0, 0);
    const ready = zonedCivilToUtc(CHICAGO, 2026, 3, 10, 6, 0, 0);
    const hour = 3_600_000;
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "import",
      occurredAt: new Date(vacate.getTime() - 24 * hour),
    });
    const stamps: Record<TurnStage, Date> = {
      notice: new Date(vacate.getTime() - 24 * hour),
      vacated: vacate,
      walk: new Date(vacate.getTime() + hour),
      scoped: new Date(vacate.getTime() + 2 * hour),
      pending_approval: new Date(vacate.getTime() + 3 * hour),
      approved: new Date(vacate.getTime() + 4 * hour),
      scheduled: new Date(vacate.getTime() + 5 * hour),
      in_progress: new Date(vacate.getTime() + 6 * hour),
      qc: new Date(vacate.getTime() + 7 * hour),
      rework: vacate,
      ready,
    };
    for (const to of HAPPY) {
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to,
        source: "import",
        occurredAt: stamps[to],
      });
    }
    const metrics = await computeTurnMetricsForId(orgId, created.turnId, ready);
    expect(metrics.daysVacant).toBe(3);
    expect((ready.getTime() - vacate.getTime()) / hour).toBe(71);
  });

  it("bills a month-boundary turn against February's day count", async () => {
    const unit = await insertUnit(propertyId, "302");
    await db
      .update(propertiesTable)
      .set({ targetTurnDays: 2 })
      .where(eq(propertiesTable.id, propertyId));
    try {
      const vacate = zonedCivilToUtc(CHICAGO, 2026, 1, 30, 12, 0, 0);
      const ready = zonedCivilToUtc(CHICAGO, 2026, 2, 3, 12, 0, 0);
      const created = await createTurn({
        orgId,
        propertyId,
        unitId: unit.id,
        source: "import",
        occurredAt: new Date(vacate.getTime() - 60_000),
      });
      let t = vacate.getTime();
      for (const to of HAPPY) {
        const at = to === "ready" ? ready : new Date(t);
        if (to !== "ready") t += 60_000;
        await transitionTurn({
          orgId,
          turnId: created.turnId,
          to,
          source: "import",
          occurredAt: at,
        });
      }
      const metrics = await computeTurnMetricsForId(orgId, created.turnId, ready);
      expect(metrics.daysVacant).toBe(4);
      expect(metrics.overTargetDays).toBe(2);
      expect(metrics.daysInMonth).toBe(28);
      expect(metrics.vacancyCostCents).toBe((2n * 145000n) / 28n);
    } finally {
      await db
        .update(propertiesTable)
        .set({ targetTurnDays: 7 })
        .where(eq(propertiesTable.id, propertyId));
    }
  });

  it("rework may only follow qc, and two loops sum into in_progress", async () => {
    const unit = await insertUnit(propertyId, "401");
    const t0 = zonedCivilToUtc(CHICAGO, 2026, 8, 1, 8, 0, 0);
    const hour = 3_600_000;
    const at = (h: number) => new Date(t0.getTime() + h * hour);
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "import",
      occurredAt: at(-1),
    });

    const toQc: { to: TurnStage; h: number }[] = [
      { to: "vacated", h: -0.9 },
      { to: "walk", h: -0.8 },
      { to: "scoped", h: -0.7 },
      { to: "pending_approval", h: -0.6 },
      { to: "approved", h: -0.5 },
      { to: "scheduled", h: -0.4 },
      { to: "in_progress", h: 0 },
      { to: "qc", h: 2 },
    ];
    for (const step of toQc) {
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to: step.to,
        source: "import",
        occurredAt: at(step.h),
      });
    }

    await expect(
      transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "in_progress",
        source: "import",
        occurredAt: at(2.1),
      }),
    ).rejects.toBeInstanceOf(IllegalTurnTransitionError);

    const loop: { to: TurnStage; h: number }[] = [
      { to: "rework", h: 3 },
      { to: "in_progress", h: 4 },
      { to: "qc", h: 7 },
      { to: "rework", h: 8 },
      { to: "in_progress", h: 9 },
    ];
    for (const step of loop) {
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to: step.to,
        source: "import",
        occurredAt: at(step.h),
      });
    }

    const metrics = await computeTurnMetricsForId(orgId, created.turnId, at(10));
    expect(metrics.stageDurationsMs.in_progress).toBe(6 * hour);
    expect(metrics.stageDurationsMs.rework).toBe(2 * hour);
  });

  it("marks isStalled when current stage exceeds property p75", async () => {
    const [stallProp] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Engine — Stall",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 8,
        status: "active",
      })
      .returning();
    const stallPropertyId = stallProp!.id;
    const now = zonedCivilToUtc(CHICAGO, 2026, 9, 1, 18, 0, 0);
    const hour = 3_600_000;
    for (let i = 0; i < 4; i++) {
      const unit = await insertUnit(stallPropertyId, `5${i}1`);
      const start = new Date(now.getTime() - (20 + i) * hour);
      const created = await createTurn({
        orgId,
        propertyId: stallPropertyId,
        unitId: unit.id,
        source: "import",
        occurredAt: new Date(start.getTime() - 2_000),
      });
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "vacated",
        source: "import",
        occurredAt: new Date(start.getTime() - 1_000),
      });
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "walk",
        source: "import",
        occurredAt: start,
      });
      await transitionTurn({
        orgId,
        turnId: created.turnId,
        to: "scoped",
        source: "import",
        occurredAt: new Date(start.getTime() + hour),
      });
    }

    const stuckUnit = await insertUnit(stallPropertyId, "599");
    const enteredWalk = new Date(now.getTime() - 3 * hour);
    const created = await createTurn({
      orgId,
      propertyId: stallPropertyId,
      unitId: stuckUnit.id,
      source: "import",
      occurredAt: new Date(enteredWalk.getTime() - 2_000),
    });
    await transitionTurn({
      orgId,
      turnId: created.turnId,
      to: "vacated",
      source: "import",
      occurredAt: new Date(enteredWalk.getTime() - 1_000),
    });
    await transitionTurn({
      orgId,
      turnId: created.turnId,
      to: "walk",
      source: "import",
      occurredAt: enteredWalk,
    });

    await db.execute(
      sql`SELECT refresh_client_turn_metrics(${created.turnId}::uuid, ${now}::timestamptz)`,
    );
    const [mvBefore] = await db
      .select()
      .from(clientTurnMetricsMvTable)
      .where(eq(clientTurnMetricsMvTable.turnId, created.turnId));
    expect(mvBefore?.isStalled).toBe(true);

    const metrics = await computeTurnMetricsForId(orgId, created.turnId, now);
    expect(metrics.currentStage).toBe("walk");
    expect(metrics.stageP75Ms).toBe(hour);
    expect(metrics.isStalled).toBe(true);
    expect(metrics.isStalled).toBe(mvBefore?.isStalled);
  });

  it("outbox rows survive a missed delivery and the worker catches up", async () => {
    const unit = await insertUnit(propertyId, "701");
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "import",
      occurredAt: zonedCivilToUtc(CHICAGO, 2026, 5, 1, 10, 0, 0),
    });
    await db
      .update(clientTurnOutboxTable)
      .set({ processedAt: null, attempts: 0, lastError: null })
      .where(eq(clientTurnOutboxTable.turnId, created.turnId));
    const pending = await db
      .select()
      .from(clientTurnOutboxTable)
      .where(eq(clientTurnOutboxTable.turnId, created.turnId));
    expect(pending.some((r) => r.processedAt == null)).toBe(true);
    const n = await deliverClientTurnOutbox();
    expect(n).toBeGreaterThan(0);
    const after = await db
      .select()
      .from(clientTurnOutboxTable)
      .where(eq(clientTurnOutboxTable.turnId, created.turnId));
    expect(after.every((r) => r.processedAt != null)).toBe(true);
  });

  it("nightly recompute is set-based and timezone-scoped", async () => {
    const nChicago = await recomputeOpenTurnPredictions({
      timezone: CHICAGO,
      now: zonedCivilToUtc(CHICAGO, 2026, 8, 14, 1, 20, 0),
    });
    expect(nChicago).toBeGreaterThan(0);
    const nNone = await recomputeOpenTurnPredictions({
      timezone: "Pacific/Kiritimati",
      now: new Date(),
    });
    expect(nNone).toBe(0);
  });

  it("stamps app-source events with the server clock, not the client timestamp", async () => {
    const unit = await insertUnit(propertyId, "601");
    const fake = new Date("2020-01-01T00:00:00.000Z");
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit.id,
      source: "app",
      occurredAt: fake,
    });
    expect(new Date(created.occurredAt).getUTCFullYear()).toBeGreaterThan(2020);
  });

  it("rolls up live vacancy cost and per-property rank from the metrics read model", async () => {
    const rollup = await computePortfolioMetrics({
      orgId,
      portfolioId,
      from: zonedCivilToUtc(CHICAGO, 2026, 1, 1, 0, 0, 0),
      to: zonedCivilToUtc(CHICAGO, 2026, 12, 31, 23, 59, 59),
    });
    expect(rollup.portfolioId).toBe(portfolioId);
    expect(rollup.openTurns).toBeGreaterThan(0);
    expect(rollup.unitsByStage.notice).toBeGreaterThan(0);
    expect(rollup.properties[0]?.propertyId).toBe(propertyId);
    expect(rollup.medianTurnDays).not.toBeNull();
    expect(typeof rollup.liveVacancyCostCents).toBe("bigint");
  });
});

async function insertUnit(propertyId: string, unitNumber: string) {
  const [unit] = await db
    .insert(clientUnitsTable)
    .values({
      propertyId,
      unitNumber,
      bedrooms: 2,
      bathrooms: "2.0",
      marketRentCents: 145000n,
    })
    .returning();
  return unit!;
}

async function countEvents(turnId: string): Promise<number> {
  const rows = await db
    .select({ id: clientTurnStageEventsTable.id })
    .from(clientTurnStageEventsTable)
    .where(eq(clientTurnStageEventsTable.turnId, turnId));
  return rows.length;
}

async function wipeEngine() {
  const seeded = await db
    .select({ id: propertiesTable.id, clientOrgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.brief, BRIEF));
  const slugOrgs = await db
    .select({ id: clientOrgsTable.id })
    .from(clientOrgsTable)
    .where(eq(clientOrgsTable.slug, "caf-engine-seg2"));
  const ids = seeded.map((r) => r.id);
  const orgIds = [
    ...new Set([
      ...seeded.map((r) => r.clientOrgId).filter((x): x is string => !!x),
      ...slugOrgs.map((r) => r.id),
    ]),
  ];
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('halo.allow_append_delete', 'on', true)`);
    if (ids.length > 0) {
      const inProps = sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(sql`DELETE FROM client_prediction_log WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_outbox WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_stage_events WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE entity_id IN (
        SELECT id::text FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turns WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_units WHERE property_id IN (${inProps})`);
      await tx.execute(
        sql`DELETE FROM client_portfolio_properties WHERE property_id IN (${inProps})`,
      );
      await tx.delete(propertiesTable).where(eq(propertiesTable.brief, BRIEF));
    }
    if (orgIds.length > 0) {
      const inOrgs = sql.join(
        orgIds.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
    await tx.execute(
      sql`DELETE FROM client_portfolio_notifications WHERE user_id LIKE 'test:%'`,
    );
  });
}
