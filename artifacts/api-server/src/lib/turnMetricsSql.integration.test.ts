/**
 * SQL refresh_client_turn_metrics must equal computeTurnMetrics on a known
 * fixture. If these diverge, the number on Pulse is indefensible.
 *
 * Hits the real Postgres. Cleans up a double-marker property so it cannot
 * collide with the CAF Demo seed.
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
  computeTurnMetrics,
  zonedCivilToUtc,
  type TurnStage,
} from "@workspace/db";
import { ensureClientBoardSchema } from "./ensureClientBoardSchema";

const BRIEF = "CAF_CLIENT_BOARD_METRICS_GOLDEN_v1";
const NAME = "CAF Golden — Metrics Fixture";
const CHICAGO = "America/Chicago";

describe("SQL turn metrics match the TypeScript formula", () => {
  let turnId = "";
  let expected: ReturnType<typeof computeTurnMetrics>;

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeGolden();

    const vacate = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 10, 0, 0);
    const ready = zonedCivilToUtc(CHICAGO, 2026, 7, 12, 10, 0, 0);
    const approvalIn = zonedCivilToUtc(CHICAGO, 2026, 7, 2, 9, 0, 0);
    const approvalOut = zonedCivilToUtc(CHICAGO, 2026, 7, 8, 9, 0, 0);

    const events: { id: string; stage: TurnStage; event: "entered" | "exited"; occurredAt: Date }[] = [
      { id: crypto.randomUUID(), stage: "pending_approval", event: "entered", occurredAt: approvalIn },
      { id: crypto.randomUUID(), stage: "pending_approval", event: "exited", occurredAt: approvalOut },
      { id: crypto.randomUUID(), stage: "in_progress", event: "entered", occurredAt: zonedCivilToUtc(CHICAGO, 2026, 7, 9, 11, 0, 0) },
      { id: crypto.randomUUID(), stage: "in_progress", event: "exited", occurredAt: zonedCivilToUtc(CHICAGO, 2026, 7, 11, 11, 0, 0) },
      { id: crypto.randomUUID(), stage: "ready", event: "entered", occurredAt: ready },
    ];

    expected = computeTurnMetrics({
      timezone: CHICAGO,
      targetTurnDays: 7,
      marketRentCents: 145000n,
      actualVacateAt: vacate,
      readyAt: ready,
      now: ready,
      events,
    });

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Golden Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: "caf-metrics-golden",
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Golden Org" },
      })
      .returning();

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: NAME,
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: org!.id,
        units: 1,
        status: "active",
      })
      .returning();

    const [unit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: property!.id,
        unitNumber: "101",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();

    const [turn] = await db
      .insert(clientTurnsTable)
      .values({
        unitId: unit!.id,
        propertyId: property!.id,
        orgId: org!.id,
        status: "ready",
        actualVacateAt: vacate,
        readyAt: ready,
        targetReadyAt: zonedCivilToUtc(CHICAGO, 2026, 7, 8, 10, 0, 0),
        workSource: "third_party",
      })
      .returning();
    turnId = turn!.id;

    await db.execute(
      sql`ALTER TABLE client_turn_stage_events DISABLE TRIGGER client_turn_stage_events_refresh_metrics`,
    );
    try {
      await db.insert(clientTurnStageEventsTable).values(
        events.map((e) => ({
          id: e.id,
          turnId,
          stage: e.stage,
          event: e.event,
          occurredAt: e.occurredAt,
          source: "system",
        })),
      );
    } finally {
      await db.execute(
        sql`ALTER TABLE client_turn_stage_events ENABLE TRIGGER client_turn_stage_events_refresh_metrics`,
      );
    }

    await db.execute(sql`SELECT refresh_client_turn_metrics(${turnId})`);
  });

  afterAll(async () => {
    await wipeGolden();
  });

  it("days vacant, over-target, vacancy cents, and client-owned hours match", async () => {
    const [row] = await db
      .select()
      .from(clientTurnMetricsMvTable)
      .where(eq(clientTurnMetricsMvTable.turnId, turnId));
    expect(row).toBeTruthy();
    expect(row!.daysVacant).toBe(expected.daysVacant);
    expect(row!.overTargetDays).toBe(expected.overTargetDays);
    expect(row!.vacancyCostCents).toBe(expected.vacancyCostCents);
    expect(row!.clientOwnedMs).toBe(expected.clientOwnedMs);
    expect(row!.vendorOwnedMs).toBe(expected.vendorOwnedMs);
    expect(row!.clientOwnedHours).toBe(expected.clientOwnedHours);
    expect(row!.daysVacant).toBe(11);
    expect(row!.overTargetDays).toBe(4);
    expect(row!.vacancyCostCents).toBe(18709n);
    expect(row!.clientOwnedHours).toBe("144.00");
    expect(row!.isStalled).toBe(false);
  });
});

async function wipeGolden() {
  const seeded = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.brief, BRIEF));
  const ids = seeded.map((r) => r.id);
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('halo.allow_append_delete', 'on', true)`);
    if (ids.length > 0) {
      const inProps = sql.join(ids.map((id) => sql`${id}`), sql`, `);
      await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_stage_events WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turns WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_units WHERE property_id IN (${inProps})`);
      await tx.delete(propertiesTable).where(eq(propertiesTable.brief, BRIEF));
    }
  });
}
