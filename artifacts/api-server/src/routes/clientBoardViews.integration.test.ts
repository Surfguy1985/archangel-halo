/**
 * Password-free regional vs property Client Board links.
 * Regional token: full portfolio + add property.
 * Property token: that community only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientUnitsTable,
  clientTurnsTable,
  clientTurnMetricsMvTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientAccountsTable,
  clientBoardFlagsTable,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";

const BRIEF = "CAF_CLIENT_BOARD_VIEWS";
const SLUG = "caf-views-seg";
const CHICAGO = "America/Chicago";
const REGIONAL = "caf-views-regional";
const PALOMA = "caf-views-paloma";

async function clientCookie(token: string): Promise<string> {
  const exchange = await request(app).post(`/api/client/${token}/session`);
  expect(exchange.status).toBe(204);
  return (exchange.headers["set-cookie"]?.[0] ?? "").split(";")[0]!;
}

async function wipe() {
  const [org] = await db
    .select({ id: clientOrgsTable.id })
    .from(clientOrgsTable)
    .where(eq(clientOrgsTable.slug, SLUG))
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
    await db.delete(clientAccountsTable).where(inArray(clientAccountsTable.propertyId, propertyIds));
    await db.delete(clientUnitsTable).where(inArray(clientUnitsTable.propertyId, propertyIds));
    await db.delete(clientPortfolioPropertiesTable).where(
      inArray(clientPortfolioPropertiesTable.propertyId, propertyIds),
    );
    await db.delete(propertiesTable).where(eq(propertiesTable.clientOrgId, org.id));
  }
  await db.delete(clientPortfoliosTable).where(eq(clientPortfoliosTable.orgId, org.id));
  await db.delete(clientOrgsTable).where(eq(clientOrgsTable.id, org.id));
}

describe("Regional vs property client views", () => {
  let orgId = "";
  let portfolioId = "";
  let palomaId = "";
  let sageId = "";
  let spareId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipe();
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "pulse"));
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "propertyBoard"));

    await db
      .update(clientPortfoliosTable)
      .set({ dashboardToken: null })
      .where(eq(clientPortfoliosTable.dashboardToken, REGIONAL));
    await db.delete(clientAccountsTable).where(eq(clientAccountsTable.dashboardToken, PALOMA));

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Views Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Views Org" },
      })
      .returning();
    orgId = org!.id;

    const [pA] = await db
      .insert(propertiesTable)
      .values({
        name: `${BRIEF} Paloma`,
        city: "Plano",
        units: 40,
        timezone: CHICAGO,
        targetTurnDays: 7,
        avgDailyRentCents: 15000n,
        clientOrgId: orgId,
        brief: BRIEF,
      })
      .returning();
    const [pB] = await db
      .insert(propertiesTable)
      .values({
        name: `${BRIEF} Sage`,
        city: "Austin",
        units: 40,
        timezone: CHICAGO,
        targetTurnDays: 7,
        avgDailyRentCents: 12000n,
        clientOrgId: orgId,
        brief: BRIEF,
      })
      .returning();
    const [pC] = await db
      .insert(propertiesTable)
      .values({
        name: `${BRIEF} Spare`,
        city: "Dallas",
        units: 20,
        timezone: CHICAGO,
        targetTurnDays: 7,
        avgDailyRentCents: 11000n,
        clientOrgId: orgId,
        brief: BRIEF,
      })
      .returning();
    palomaId = pA!.id;
    sageId = pB!.id;
    spareId = pC!.id;

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region Views", dashboardToken: REGIONAL })
      .returning();
    portfolioId = port!.id;
    await db.insert(clientPortfolioPropertiesTable).values([
      { portfolioId, propertyId: palomaId },
      { portfolioId, propertyId: sageId },
    ]);

    await db.insert(clientAccountsTable).values({
      propertyId: palomaId,
      dashboardToken: PALOMA,
      status: "active",
    });

    const [uA] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: palomaId,
        unitNumber: "1101",
        bedrooms: 2,
        marketRentCents: 180000n,
      })
      .returning();
    await db.insert(clientTurnsTable).values({
      unitId: uA!.id,
      propertyId: palomaId,
      orgId,
      status: "pending_approval",
      actualVacateAt: new Date(Date.now() - 10 * 86_400_000),
      targetReadyAt: new Date(Date.now() - 3 * 86_400_000),
      workSource: "third_party",
    });
  });

  afterAll(async () => {
    await wipe();
  });

  it("scopes Pulse: regional sees both properties, Paloma sees only Paloma", async () => {
    const regional = await request(app).get(`/api/client/${REGIONAL}/portfolio/pulse`);
    expect(regional.status).toBe(200);
    expect(regional.body.viewKind).toBe("regional");
    expect(regional.body.canAddProperties).toBe(true);
    expect(regional.body.tiles).toHaveLength(2);

    const paloma = await request(app).get(`/api/client/${PALOMA}/portfolio/pulse`);
    expect(paloma.status).toBe(200);
    expect(paloma.body.viewKind).toBe("property");
    expect(paloma.body.canAddProperties).toBe(false);
    expect(paloma.body.tiles).toHaveLength(1);
    expect(paloma.body.tiles[0].propertyId).toBe(palomaId);
  });

  it("blocks Paloma from Desert Sage turn board; regional can open it", async () => {
    const denied = await request(app).get(`/api/client/${PALOMA}/properties/${sageId}/board`);
    expect(denied.status).toBe(404);

    const allowed = await request(app).get(`/api/client/${REGIONAL}/properties/${sageId}/board`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.propertyId).toBe(sageId);
  });

  it("lets regional attach an org property; Paloma cannot add", async () => {
    const palomaCookie = await clientCookie(PALOMA);
    const palomaAdd = await request(app)
      .post(`/api/client/${PALOMA}/portfolio/properties`)
      .set("Cookie", palomaCookie)
      .send({ name: "Should Fail", city: "Nowhere" });
    expect(palomaAdd.status).toBe(403);

    const listed = await request(app).get(`/api/client/${REGIONAL}/portfolio/available-properties`);
    expect(listed.status).toBe(200);
    expect(listed.body.properties.some((p: { propertyId: string }) => p.propertyId === spareId)).toBe(true);

    const cookie = await clientCookie(REGIONAL);
    const attached = await request(app)
      .post(`/api/client/${REGIONAL}/portfolio/properties`)
      .set("Cookie", cookie)
      .send({ propertyId: spareId });
    expect(attached.status).toBe(200);
    expect(attached.body.propertyId).toBe(spareId);
    expect(attached.body.created).toBe(false);

    const created = await request(app)
      .post(`/api/client/${REGIONAL}/portfolio/properties`)
      .set("Cookie", cookie)
      .send({ name: `${BRIEF} New Community`, city: "Frisco" });
    expect(created.status).toBe(200);
    expect(created.body.created).toBe(true);

    const pulse = await request(app).get(`/api/client/${REGIONAL}/portfolio/pulse`);
    expect(pulse.status).toBe(200);
    expect(pulse.body.tiles.length).toBeGreaterThanOrEqual(4);
  });
});
