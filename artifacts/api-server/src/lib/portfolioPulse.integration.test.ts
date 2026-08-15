/**
 * Segment 3 Pulse HTTP against real Postgres. Inserts MV rows directly —
 * the pulse path must not need client_turn_stage_events.
 */
import { createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientUnitsTable,
  clientTurnsTable,
  clientTurnMetricsMvTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientSavedViewsTable,
  clientBoardFlagsTable,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";

const BRIEF = "CAF_CLIENT_BOARD_PULSE_v1";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}
const auth = () => ({ Cookie: officeCookie() });

async function wipe() {
  const [org] = await db
    .select({ id: clientOrgsTable.id })
    .from(clientOrgsTable)
    .where(eq(clientOrgsTable.slug, "caf-pulse-seg3"))
    .limit(1);
  if (!org) return;
  const props = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.clientOrgId, org.id));
  const propertyIds = props.map((p) => p.id);
  const turns = await db
    .select({ id: clientTurnsTable.id })
    .from(clientTurnsTable)
    .where(eq(clientTurnsTable.orgId, org.id));
  const turnIds = turns.map((t) => t.id);
  if (turnIds.length) {
    await db.delete(clientTurnMetricsMvTable).where(inArray(clientTurnMetricsMvTable.turnId, turnIds));
    await db.delete(clientTurnsTable).where(eq(clientTurnsTable.orgId, org.id));
  }
  if (propertyIds.length) {
    await db.delete(clientUnitsTable).where(inArray(clientUnitsTable.propertyId, propertyIds));
    await db.delete(clientPortfolioPropertiesTable).where(
      inArray(clientPortfolioPropertiesTable.propertyId, propertyIds),
    );
    await db.delete(propertiesTable).where(eq(propertiesTable.clientOrgId, org.id));
  }
  await db.delete(clientPortfoliosTable).where(eq(clientPortfoliosTable.orgId, org.id));
  await db.delete(clientSavedViewsTable).where(eq(clientSavedViewsTable.userId, "office"));
  await db.delete(clientOrgsTable).where(eq(clientOrgsTable.id, org.id));
}

describe("Portfolio Pulse HTTP", () => {
  let orgId = "";
  let portfolioId = "";
  let propertyA = "";
  let propertyB = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipe();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Pulse Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: "caf-pulse-seg3",
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Pulse Org" },
      })
      .returning();
    orgId = org!.id;

    const [pA] = await db
      .insert(propertiesTable)
      .values({
        name: `${BRIEF} Paloma`,
        units: 40,
        timezone: CHICAGO,
        targetTurnDays: 7,
        avgDailyRentCents: 15000n,
        clientOrgId: orgId,
      })
      .returning();
    const [pB] = await db
      .insert(propertiesTable)
      .values({
        name: `${BRIEF} Sage`,
        units: 40,
        timezone: CHICAGO,
        targetTurnDays: 7,
        avgDailyRentCents: 12000n,
        clientOrgId: orgId,
      })
      .returning();
    propertyA = pA!.id;
    propertyB = pB!.id;

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region Pulse" })
      .returning();
    portfolioId = port!.id;
    await db.insert(clientPortfolioPropertiesTable).values([
      { portfolioId, propertyId: propertyA },
      { portfolioId, propertyId: propertyB },
    ]);

    const [uA] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: propertyA,
        unitNumber: "1101",
        bedrooms: 2,
        marketRentCents: 180000n,
      })
      .returning();
    const [uB] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: propertyB,
        unitNumber: "2202",
        bedrooms: 1,
        marketRentCents: 140000n,
      })
      .returning();

    const now = new Date();
    const [tA] = await db
      .insert(clientTurnsTable)
      .values({
        unitId: uA!.id,
        propertyId: propertyA,
        orgId,
        status: "pending_approval",
        actualVacateAt: new Date(now.getTime() - 10 * 86_400_000),
        targetReadyAt: new Date(now.getTime() - 3 * 86_400_000),
        predictedReadyAt: new Date(now.getTime() + 2 * 86_400_000),
        workSource: "third_party",
      })
      .returning();
    const [tB] = await db
      .insert(clientTurnsTable)
      .values({
        unitId: uB!.id,
        propertyId: propertyB,
        orgId,
        status: "rework",
        actualVacateAt: new Date(now.getTime() - 20 * 86_400_000),
        targetReadyAt: new Date(now.getTime() - 13 * 86_400_000),
        predictedReadyAt: new Date(now.getTime() + 4 * 86_400_000),
        workSource: "in_house",
      })
      .returning();

    await db.insert(clientTurnMetricsMvTable).values([
      {
        turnId: tA!.id,
        propertyId: propertyA,
        daysVacant: 10,
        vacancyCostCents: 150000n,
        isStalled: false,
        currentStage: "pending_approval",
      },
      {
        turnId: tB!.id,
        propertyId: propertyB,
        daysVacant: 20,
        vacancyCostCents: 240000n,
        isStalled: true,
        currentStage: "rework",
      },
    ]);
  });

  afterAll(async () => {
    await wipe();
  });

  it("lists portfolios and returns pulse from the MV (cents as strings)", async () => {
    const list = await request(app).get("/api/v1/portfolios").set(auth());
    expect(list.status).toBe(200);
    expect(list.body.portfolios.some((p: { id: string }) => p.id === portfolioId)).toBe(true);

    const started = Date.now();
    const pulse = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/pulse`)
      .set(auth());
    const elapsed = Date.now() - started;
    expect(pulse.status).toBe(200);
    expect(typeof pulse.body.headline.vacancyCostCents).toBe("string");
    expect(pulse.body.headline.vacancyCostCents).toMatch(/^-?\d+$/);
    expect(pulse.body.tiles).toHaveLength(2);
    expect(pulse.body.tiles[0].sparkline).toHaveLength(12);
    expect(pulse.body.tiles[0].statusLabel).toBeTruthy();
    expect(pulse.body.supporting.unitsInTurn).toBe(2);
    expect(elapsed).toBeLessThan(250);
    expect(pulse.body.headline.vacancyCostCents).not.toBe("390000");

    const attention = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/attention`)
      .set(auth());
    expect(attention.status).toBe(200);
    const kinds = attention.body.groups.map((g: { kind: string }) => g.kind);
    expect(kinds).toContain("awaiting_approval");
    expect(kinds).toContain("failed_qc");
    expect(kinds).toContain("stalled");
    expect(kinds).not.toContain("blocked_invoices");
    const waiting = attention.body.groups.find(
      (g: { kind: string }) => g.kind === "awaiting_approval",
    );
    expect(waiting.summary).toMatch(/waiting on you/i);
  });

  it("404s when the pulse flag is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false })
      .where(eq(clientBoardFlagsTable.segment, "pulse"));
    const res = await request(app).get("/api/v1/portfolios").set(auth());
    expect(res.status).toBe(404);
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true })
      .where(eq(clientBoardFlagsTable.segment, "pulse"));
  });

  it("persists range in client_saved_views", async () => {
    const put = await request(app)
      .put(`/api/v1/portfolios/${portfolioId}/saved-view`)
      .set(auth())
      .send({ range: "last_30", sort: "name", from: null, to: null });
    expect(put.status).toBe(200);
    expect(put.body.range).toBe("last_30");
    const pulse = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/pulse`)
      .set(auth());
    expect(pulse.status).toBe(200);
    expect(pulse.body.range).toBe("last_30");
    expect(pulse.body.sort).toBe("name");

    const override = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/pulse`)
      .query({ range: "this_month" })
      .set(auth());
    expect(override.status).toBe(200);
    expect(override.body.range).toBe("this_month");

    const again = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/pulse`)
      .set(auth());
    expect(again.status).toBe(200);
    expect(again.body.range).toBe("last_30");
  });
});

describe("Portfolio Pulse p95 (17k units)", () => {
  const SLUG = "caf-pulse-p95";
  let orgId = "";
  let portfolioId = "";

  async function wipeP95() {
    const [org] = await db
      .select({ id: clientOrgsTable.id })
      .from(clientOrgsTable)
      .where(eq(clientOrgsTable.slug, SLUG))
      .limit(1);
    if (!org) return;
    await db.execute(sql`
      DELETE FROM client_turn_metrics_mv
      WHERE property_id IN (SELECT id FROM properties WHERE client_org_id = ${org.id})
    `);
    await db.execute(sql`DELETE FROM client_turns WHERE org_id = ${org.id}`);
    await db.execute(sql`
      DELETE FROM client_units
      WHERE property_id IN (SELECT id FROM properties WHERE client_org_id = ${org.id})
    `);
    await db.execute(sql`
      DELETE FROM client_portfolio_properties
      WHERE property_id IN (SELECT id FROM properties WHERE client_org_id = ${org.id})
    `);
    await db.delete(clientPortfoliosTable).where(eq(clientPortfoliosTable.orgId, org.id));
    await db.delete(propertiesTable).where(eq(propertiesTable.clientOrgId, org.id));
    await db.delete(clientOrgsTable).where(eq(clientOrgsTable.id, org.id));
  }

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeP95();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Pulse P95",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Pulse P95" },
      })
      .returning();
    orgId = org!.id;

    await db.execute(sql`
      INSERT INTO properties (name, units, timezone, target_turn_days, avg_daily_rent_cents, client_org_id)
      SELECT ${BRIEF} || ' P' || gs::text, 1417, ${CHICAGO}, 7, 5000, ${orgId}::uuid
      FROM generate_series(1, 12) AS gs
    `);

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "P95 Region" })
      .returning();
    portfolioId = port!.id;

    await db.execute(sql`
      INSERT INTO client_portfolio_properties (portfolio_id, property_id)
      SELECT ${portfolioId}::uuid, p.id
      FROM properties p
      WHERE p.client_org_id = ${orgId}::uuid
    `);

    await db.execute(sql`
      INSERT INTO client_units (property_id, unit_number, bedrooms, bathrooms, market_rent_cents)
      SELECT p.id, 'U' || gs::text, 1, 1.0, 150000
      FROM properties p
      CROSS JOIN generate_series(1, 1417) AS gs
      WHERE p.client_org_id = ${orgId}::uuid
    `);

    await db.execute(sql`
      INSERT INTO client_turns (
        unit_id, property_id, org_id, status, actual_vacate_at, target_ready_at, work_source
      )
      SELECT u.id, u.property_id, ${orgId}::uuid, 'vacated',
        now() - interval '10 days', now() + interval '1 day', 'third_party'
      FROM client_units u
      INNER JOIN properties p ON p.id = u.property_id
      WHERE p.client_org_id = ${orgId}::uuid
    `);

    await db.execute(sql`
      INSERT INTO client_turn_metrics_mv (
        turn_id, property_id, days_vacant, vacancy_cost_cents, is_stalled, current_stage
      )
      SELECT t.id, t.property_id, 10, 0, false, 'vacated'
      FROM client_turns t
      WHERE t.org_id = ${orgId}::uuid
    `);
  }, 120_000);

  afterAll(async () => {
    await wipeP95();
  }, 120_000);

  it("serves pulse p95 under 250ms against ~17k units without scanning events", async () => {
    await request(app).get(`/api/v1/portfolios/${portfolioId}/pulse`).set(auth());
    const times: number[] = [];
    let tiles = 0;
    for (let i = 0; i < 20; i++) {
      const started = Date.now();
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioId}/pulse`)
        .set(auth());
      times.push(Date.now() - started);
      expect(res.status).toBe(200);
      tiles = res.body.tiles.length;
      expect(res.body.supporting.unitsInTurn).toBe(12 * 1417);
    }
    expect(tiles).toBe(12);
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1]!;
    expect(p95).toBeLessThan(250);
  }, 60_000);
});
