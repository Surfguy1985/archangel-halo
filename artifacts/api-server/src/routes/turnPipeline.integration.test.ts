/**
 * Segment 8 — 13-week pipeline HTTP. Spend band is the same formula as
 * turnPipelineMath. Flag dark → 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHmac, randomBytes } from "crypto";
import { eq, like, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientUnitsTable,
  clientBoardFlagsTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientCapacityDeclarationsTable,
  clientTurnInvoicesTable,
  clientScopesTable,
  spendBand,
  startOfWeekMondayInZone,
  addCivilDaysInZone,
  zonedCivilToUtc,
  PIPELINE_WEEKS,
  PIPELINE_TRADES,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn, transitionTurn } from "../lib/turnEngine";
import { computePipeline } from "../lib/turnPipeline";
import type { TurnStage } from "@workspace/db";

const BRIEF = "CAF_CLIENT_BOARD_PIPE_SEG8";
const SLUG = "caf-pipe-seg8";
const CHICAGO = "America/Chicago";
const TOKEN = "caf-pipe-seg8-token";
const READY_STAGES: TurnStage[] = [
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

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

async function walk(orgId: string, turnId: string, start: Date): Promise<void> {
  let at = start;
  for (const to of READY_STAGES) {
    at = new Date(at.getTime() + 2 * 3_600_000);
    await transitionTurn({
      orgId,
      turnId,
      to,
      source: "import",
      occurredAt: at,
      actorId: "test:seg8",
      idempotencyKey: `seg8-${turnId}-${to}`,
    });
  }
}

async function invoiceTurn(turnId: string, invoiceNumber: string, totalCents: bigint): Promise<void> {
  const [scope] = await db
    .insert(clientScopesTable)
    .values({ turnId, status: "draft", createdBy: "test:seg8" })
    .returning();
  await db.insert(clientTurnInvoicesTable).values({
    turnId,
    scopeId: scope!.id,
    invoiceNumber,
    status: "issued",
    subtotalCents: totalCents,
    totalCents,
  });
}

describe("Turn pipeline (HTTP)", () => {
  let orgId = "";
  let portfolioId = "";
  let futureTurnId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg8();
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "pipeline"));

    const [org] = await db
      .insert(clientOrgsTable)
      .values({ name: "CAF Pipe Seg8 Org", type: "pm_company", timezone: CHICAGO, slug: SLUG })
      .onConflictDoUpdate({ target: clientOrgsTable.slug, set: { name: "CAF Pipe Seg8 Org" } })
      .returning();
    orgId = org!.id;

    const [vendor] = await db
      .insert(clientOrgsTable)
      .values({ name: "Archangel Pipe", type: "vendor", timezone: CHICAGO, slug: `${SLUG}-v` })
      .onConflictDoUpdate({ target: clientOrgsTable.slug, set: { name: "Archangel Pipe" } })
      .returning();

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region", dashboardToken: TOKEN })
      .returning();
    portfolioId = port!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Pipe — Paloma Creek",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 4,
        status: "active",
        avgDailyRentCents: 145000n,
      })
      .returning();
    await db.insert(clientPortfolioPropertiesTable).values({ portfolioId, propertyId: property!.id });

    const units = [];
    for (const num of ["101", "102", "103", "104"]) {
      const [u] = await db
        .insert(clientUnitsTable)
        .values({
          propertyId: property!.id,
          unitNumber: num,
          bedrooms: 1,
          bathrooms: "1.0",
          marketRentCents: 125000n,
        })
        .returning();
      units.push(u!);
    }

    const readyStart = zonedCivilToUtc(CHICAGO, 2026, 5, 1, 8, 0, 0);
    const onSchedule = await createTurn({
      orgId,
      propertyId: property!.id,
      unitId: units[0]!.id,
      source: "import",
      occurredAt: readyStart,
      actorId: "test:seg8",
      idempotencyKey: "seg8-ready-on",
      noticeGivenAt: readyStart,
      scheduledVacateAt: readyStart,
    });
    await walk(orgId, onSchedule.turnId, new Date(onSchedule.occurredAt));
    await invoiceTurn(onSchedule.turnId, "PIPE-101", 100000n);

    const offSchedule = await createTurn({
      orgId,
      propertyId: property!.id,
      unitId: units[1]!.id,
      source: "import",
      occurredAt: readyStart,
      actorId: "test:seg8",
      idempotencyKey: "seg8-ready-off",
      noticeGivenAt: readyStart,
      scheduledVacateAt: addCivilDaysInZone(readyStart, 2, CHICAGO),
    });
    await walk(orgId, offSchedule.turnId, new Date(offSchedule.occurredAt));
    await invoiceTurn(offSchedule.turnId, "PIPE-102", 100000n);

    const monday = startOfWeekMondayInZone(new Date(), CHICAGO);
    const capRows = [];
    for (let w = 0; w < PIPELINE_WEEKS; w++) {
      for (const trade of PIPELINE_TRADES) {
        capRows.push({
          vendorOrgId: vendor!.id,
          trade,
          weekStart: addCivilDaysInZone(monday, w * 7, CHICAGO),
          unitsCapacity: 8,
        });
      }
    }
    await db.insert(clientCapacityDeclarationsTable).values(capRows);

    const future = await createTurn({
      orgId,
      propertyId: property!.id,
      unitId: units[2]!.id,
      source: "app",
      actorId: "test:seg8",
      idempotencyKey: "seg8-future",
      noticeGivenAt: new Date(),
      scheduledVacateAt: addCivilDaysInZone(monday, 16, CHICAGO),
    });
    futureTurnId = future.turnId;

    await createTurn({
      orgId,
      propertyId: property!.id,
      unitId: units[3]!.id,
      source: "app",
      actorId: "test:seg8",
      idempotencyKey: "seg8-notice",
      noticeGivenAt: new Date(),
    });
  });

  afterAll(async () => {
    await wipeSeg8();
  });

  it("renders 13 weeks, a spend band a human can check, and holds capacity", async () => {
    // Capacity guard against a PATHOLOGICAL regression (an N+1 over 13 weeks ×
    // units), not a benchmark.  The whole suite shares one dev database that
    // accumulates rows as test files are added, so the pipeline legitimately
    // does more work in a full run than it does with this file alone — a tight
    // wall-clock budget here fails on unrelated tests being added rather than
    // on this code getting slower.  The ceiling is deliberately generous: a
    // real regression here is an order of magnitude, not tens of milliseconds.
    const t0 = Date.now();
    const computed = await computePipeline({ portfolioId, orgId });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(computed.weekStarts).toHaveLength(13);
    expect(computed.timezone).toBe(CHICAGO);
    expect(computed.heatmap).toHaveLength(13 * 6);
    expect(computed.method.toLowerCase()).toContain("conversion");
    expect(computed.conversionRate).toBe(0.5);

    const res = await request(app).get(`/api/v1/portfolios/${portfolioId}/pipeline`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.weekStarts).toHaveLength(13);
    expect(res.body.units.length).toBeGreaterThan(0);
    const portfolioSpend = res.body.spend.find((s: { propertyId: string | null }) => s.propertyId == null);
    expect(portfolioSpend.horizons).toHaveLength(3);
    const h90 = portfolioSpend.horizons.find((h: { days: number }) => h.days === 90);
    const scheduled = BigInt(h90.lowCents);
    const high = BigInt(h90.highCents);
    const mid = BigInt(h90.midCents);
    expect(mid >= scheduled && high >= mid).toBe(true);
    const hand = spendBand({
      scheduledCostCents: scheduled,
      noticeCostCents: high - scheduled,
      conversionRate: res.body.conversionRate,
    });
    expect(h90.midCents).toBe(hand.midCents);

    const twin = await request(app).get(`/api/client/${TOKEN}/portfolio/pipeline`);
    expect(twin.status).toBe(200);
    expect(twin.body.weekStarts).toHaveLength(13);

    const held = await request(app).post(`/api/v1/turns/${futureTurnId}/capacity-hold`).set(auth());
    expect(held.status).toBe(200);
    expect(held.body.status).toBe("held");
    const again = await request(app).post(`/api/v1/turns/${futureTurnId}/capacity-hold`).set(auth());
    expect(again.status).toBe(409);
    const confirmed = await request(app)
      .post(`/api/v1/capacity-holds/${held.body.bundleId}/confirm`)
      .set(auth());
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("confirmed");
  });

  it("returns 404 when pipeline is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "pipeline"));
    try {
      const res = await request(app).get(`/api/v1/portfolios/${portfolioId}/pipeline`).set(auth());
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Pipeline is not enabled");
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "pipeline"));
    }
  });
});

async function wipeSeg8() {
  const seeded = await db
    .select({ id: propertiesTable.id, clientOrgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.brief, BRIEF));
  const slugOrgs = await db
    .select({ id: clientOrgsTable.id })
    .from(clientOrgsTable)
    .where(like(clientOrgsTable.slug, `${SLUG}%`));
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
      await tx.execute(sql`DELETE FROM client_capacity_holds WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_forecasts WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_invoice_lines WHERE invoice_id IN (
        SELECT id FROM client_turn_invoices WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_turn_invoices WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_scope_lines WHERE scope_id IN (
        SELECT id FROM client_scopes WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_scopes WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_accounts WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_outbox WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_prediction_log WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_stage_events WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turns WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_units WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_portfolio_properties WHERE property_id IN (${inProps})`);
      await tx.delete(propertiesTable).where(eq(propertiesTable.brief, BRIEF));
    }
    if (orgIds.length > 0) {
      const inOrgs = sql.join(
        orgIds.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(sql`DELETE FROM client_capacity_declarations WHERE vendor_org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
