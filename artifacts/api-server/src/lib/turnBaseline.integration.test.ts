/**
 * The long-turn yardstick must be the operation's ACTUAL rolling average.
 *
 * This guards a specific defect: the baseline used to fetch turns with a bare
 * `limit(200)` and average them in JS.  Without an ORDER BY, Postgres is free
 * to return any 200 rows it likes, so once an operation passed 200 completed
 * turns the quoted average — and every "running long" flag measured against
 * it — drifted with table layout instead of with the operation.
 *
 * The fixture is deliberately bimodal and larger than that old cap: 200 fast
 * turns then 50 slow ones.  The true mean over all 250 is 9.6 days, while any
 * 200-row subset that misses the slow tail lands at 2.0.  An assertion on the
 * exact mean therefore fails loudly if the cohort is ever truncated again.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientUnitsTable,
  clientTurnsTable,
} from "@workspace/db";
import { ensureClientBoardSchema } from "./ensureClientBoardSchema";
import { loadTurnBaseline } from "./commandBrain";

const BRIEF = "HALO_TURN_BASELINE_COHORT_FIXTURE";
const SLUG = "halo-turn-baseline-cohort";
const NAME = "HALO — Turn Baseline Cohort";

const FAST_COUNT = 200;
const FAST_DAYS = 2;
const SLOW_COUNT = 50;
const SLOW_DAYS = 40;
const TOTAL = FAST_COUNT + SLOW_COUNT;
const TRUE_MEAN = (FAST_COUNT * FAST_DAYS + SLOW_COUNT * SLOW_DAYS) / TOTAL; // 9.6

describe("turn baseline uses the whole completed-turn cohort", () => {
  let propertyId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipe();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({ name: "Baseline Cohort Org", type: "pm_company", timezone: "America/Chicago", slug: SLUG })
      .onConflictDoUpdate({ target: clientOrgsTable.slug, set: { name: "Baseline Cohort Org" } })
      .returning();

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: NAME,
        brief: BRIEF,
        timezone: "America/Chicago",
        targetTurnDays: 7,
        clientOrgId: org!.id,
        units: 1,
        status: "active",
      })
      .returning();
    propertyId = property!.id;

    const [unit] = await db
      .insert(clientUnitsTable)
      .values({ propertyId, unitNumber: "101", bedrooms: 2, bathrooms: "2.0", marketRentCents: 145000n })
      .returning();

    // Every turn is finished and inside the 90-day window.  No metrics rows are
    // created, so this also exercises the readyAt-minus-vacatedAt fallback the
    // aggregate computes in SQL.
    const rows = Array.from({ length: TOTAL }, (_, i) => {
      const days = i < FAST_COUNT ? FAST_DAYS : SLOW_DAYS;
      // Spread readyAt over the recent past, newest last, so the slow tail is
      // exactly what an unordered bounded fetch is most likely to drop.
      const readyAt = new Date(Date.now() - (TOTAL - i) * 6 * 3_600_000);
      return {
        unitId: unit!.id,
        propertyId,
        orgId: org!.id,
        status: "ready" as const,
        actualVacateAt: new Date(readyAt.getTime() - days * 86_400_000),
        readyAt,
        workSource: "third_party" as const,
      };
    });
    for (let i = 0; i < rows.length; i += 50) {
      await db.insert(clientTurnsTable).values(rows.slice(i, i + 50));
    }
  });

  afterAll(async () => {
    await wipe();
  });

  it("averages every completed turn, not an arbitrary bounded subset", async () => {
    const { avgDays, sample } = await loadTurnBaseline([propertyId], []);

    expect(sample).toBe(TOTAL);
    expect(avgDays).not.toBeNull();
    expect(avgDays!).toBeCloseTo(TRUE_MEAN, 5);
    // The value a truncated cohort would have produced.
    expect(avgDays!).not.toBeCloseTo(FAST_DAYS, 1);
  });

  it("excludes finished turns whose length is unknowable, rather than scoring them zero", async () => {
    // A turn that is ready but has neither a metrics row nor a recorded vacate
    // date has no derivable duration.  Postgres GREATEST ignores NULLs, so the
    // obvious fallback expression scores these as ZERO-day turns and drags the
    // baseline down — the exact defect this asserts against.  Twenty of them
    // against a 9.6-day mean would pull it to about 8.9 if counted.
    const [unit] = await db.select().from(clientUnitsTable).where(eq(clientUnitsTable.propertyId, propertyId));
    const [org] = await db.select().from(clientOrgsTable).where(eq(clientOrgsTable.slug, SLUG));
    await db.insert(clientTurnsTable).values(
      Array.from({ length: 20 }, (_, i) => ({
        unitId: unit!.id,
        propertyId,
        orgId: org!.id,
        status: "ready" as const,
        actualVacateAt: null,
        readyAt: new Date(Date.now() - (i + 1) * 3_600_000),
        workSource: "third_party" as const,
      })),
    );

    const { avgDays, sample } = await loadTurnBaseline([propertyId], []);
    expect(sample).toBe(TOTAL);
    expect(avgDays!).toBeCloseTo(TRUE_MEAN, 5);

    await db
      .delete(clientTurnsTable)
      .where(and(eq(clientTurnsTable.propertyId, propertyId), isNull(clientTurnsTable.actualVacateAt)));
  });

  it("counts turns whose length can be derived, and ignores unfinished ones", async () => {
    // An in-flight turn has no readyAt and must not dilute the average.
    const [unit] = await db.select().from(clientUnitsTable).where(eq(clientUnitsTable.propertyId, propertyId));
    const [org] = await db.select().from(clientOrgsTable).where(eq(clientOrgsTable.slug, SLUG));
    await db.insert(clientTurnsTable).values({
      unitId: unit!.id,
      propertyId,
      orgId: org!.id,
      status: "in_progress",
      actualVacateAt: new Date(Date.now() - 3 * 86_400_000),
      readyAt: null,
      workSource: "third_party",
    });

    const { avgDays, sample } = await loadTurnBaseline([propertyId], []);
    expect(sample).toBe(TOTAL);
    expect(avgDays!).toBeCloseTo(TRUE_MEAN, 5);
  });
});

async function wipe() {
  const props = await db.select({ id: propertiesTable.id }).from(propertiesTable).where(eq(propertiesTable.brief, BRIEF));
  for (const p of props) {
    await db.delete(clientTurnsTable).where(eq(clientTurnsTable.propertyId, p.id));
    await db.delete(clientUnitsTable).where(eq(clientUnitsTable.propertyId, p.id));
  }
  await db.delete(propertiesTable).where(eq(propertiesTable.brief, BRIEF));
  await db.execute(sql`DELETE FROM client_orgs WHERE slug = ${SLUG}`);
}
