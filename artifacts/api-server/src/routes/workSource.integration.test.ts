/**
 * Segment 9 — work-source filter, property_manager 403 on property B,
 * approval cap, cost-to-serve flag. Flag dark → 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHmac, randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientOrgsTable,
  clientUnitsTable,
  clientTurnsTable,
  clientBoardFlagsTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientOrgMembersTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientTurnInvoicesTable,
  mulCents,
  zonedCivilToUtc,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn } from "../lib/turnEngine";
import { createBidRequest } from "../lib/bidBoard";
import {
  CLIENT_BOARD_MEMBER_HEADER,
  CLIENT_BOARD_PROPERTY_BOUND_OFFICE_PATHS,
} from "../lib/clientBoardAccess";

const BRIEF = "CAF_CLIENT_BOARD_WORK_SEG9";
const SLUG = "caf-work-seg9";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const officeAuth = () => ({ Cookie: COOKIE });

describe("Work source + property scope (HTTP)", () => {
  let orgId = "";
  let portfolioId = "";
  let propertyA = "";
  let propertyB = "";
  let turnA = "";
  let turnAInHouse = "";
  let turnB = "";
  let scopeB = "";
  let invoiceB = "";
  let bidRequestB = "";
  let unitBId = "";
  let memberId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg9();
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "pipeline"));

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Work Seg9 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Work Seg9 Org" },
      })
      .returning();
    orgId = org!.id;

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region" })
      .returning();
    portfolioId = port!.id;

    const [propA] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Work — Property A",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 2,
        status: "active",
        scopeApprovalCents: 10000n,
      })
      .returning();
    propertyA = propA!.id;

    const [propB] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Work — Property B",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 1,
        status: "active",
      })
      .returning();
    propertyB = propB!.id;

    await db.insert(clientPortfolioPropertiesTable).values([
      { portfolioId, propertyId: propertyA },
      { portfolioId, propertyId: propertyB },
    ]);

    const [member] = await db
      .insert(clientOrgMembersTable)
      .values({
        orgId,
        userId: "test:pm.a",
        role: "property_manager",
        scope: { propertyIds: [propertyA] },
      })
      .returning();
    memberId = member!.id;

    const [unitA1] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: propertyA,
        unitNumber: "101",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();
    const [unitA2] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: propertyA,
        unitNumber: "102",
        bedrooms: 1,
        bathrooms: "1.0",
        marketRentCents: 120000n,
      })
      .returning();
    const [unitB] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId: propertyB,
        unitNumber: "201",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();
    unitBId = unitB!.id;

    const occurredAt = zonedCivilToUtc(CHICAGO, 2026, 8, 1, 8, 0, 0);
    turnA = (
      await createTurn({
        orgId,
        propertyId: propertyA,
        unitId: unitA1!.id,
        workSource: "third_party",
        source: "import",
        occurredAt,
        actorId: "test:seg9",
        idempotencyKey: "seg9-a-third",
      })
    ).turnId;
    turnAInHouse = (
      await createTurn({
        orgId,
        propertyId: propertyA,
        unitId: unitA2!.id,
        workSource: "in_house",
        source: "import",
        occurredAt,
        actorId: "test:seg9",
        idempotencyKey: "seg9-a-inhouse",
      })
    ).turnId;
    turnB = (
      await createTurn({
        orgId,
        propertyId: propertyB,
        unitId: unitB!.id,
        workSource: "third_party",
        source: "import",
        occurredAt,
        actorId: "test:seg9",
        idempotencyKey: "seg9-b-third",
      })
    ).turnId;

    const [scopeA] = await db
      .insert(clientScopesTable)
      .values({ turnId: turnA, status: "draft", createdBy: "test:seg9" })
      .returning();
    await db.insert(clientScopeLinesTable).values({
      scopeId: scopeA!.id,
      description: "Interior walls paint",
      code: "PAINT-WALLS",
      tier: "2br",
      qty: 1,
      uom: "ea",
      unitPriceCents: 24500n,
      extendedCents: mulCents(24500n, 1),
      compliance: "matched",
    });

    const [scope] = await db
      .insert(clientScopesTable)
      .values({ turnId: turnB, status: "draft", createdBy: "test:seg9" })
      .returning();
    scopeB = scope!.id;
    await db.insert(clientScopeLinesTable).values({
      scopeId: scopeB,
      description: "Interior walls paint",
      code: "PAINT-WALLS",
      tier: "2br",
      qty: 1,
      uom: "ea",
      unitPriceCents: 24500n,
      extendedCents: mulCents(24500n, 1),
      compliance: "matched",
    });

    const [invoice] = await db
      .insert(clientTurnInvoicesTable)
      .values({
        turnId: turnB,
        scopeId: scopeB,
        invoiceNumber: "SEG9-B-001",
        status: "draft",
        subtotalCents: 24500n,
        totalCents: 24500n,
      })
      .returning();
    invoiceB = invoice!.id;

    const published = await createBidRequest({
      scopeId: scopeB,
      orgId,
      actorId: "test:seg9",
      dueAt: new Date(Date.now() + 7 * 86_400_000),
    });
    bidRequestB = published.id;
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "workSource"));
    await wipeSeg9();
  });

  function memberAuth() {
    return { Cookie: COOKIE, [CLIENT_BOARD_MEMBER_HEADER]: memberId };
  }

  function bodyFor(path: string): Record<string, unknown> {
    if (path.includes("/records")) return { variant: "full" };
    if (path.includes("/lines")) {
      return { description: "Paint", qty: 1, unitPriceCents: "100" };
    }
    if (path.endsWith("/bid-requests")) return { dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() };
    if (path.endsWith("/invitations")) return { vendorOrgIds: ["00000000-0000-0000-0000-000000000001"] };
    if (path.endsWith("/bids")) {
      return { vendorOrgId: "00000000-0000-0000-0000-000000000001", lines: [{ code: "PAINT-WALLS", unitPriceCents: "1" }] };
    }
    if (path.endsWith("/award")) return { vendorOrgId: "00000000-0000-0000-0000-000000000001" };
    if (path.endsWith("/vacate-notice")) return { scheduledVacate: "2026-09-01" };
    return {};
  }

  it("returns 403 on every property B office resource for a property_manager scoped to A", async () => {
    const ids = { propertyId: propertyB, turnId: turnB, scopeId: scopeB, invoiceId: invoiceB, bidRequestId: bidRequestB, unitId: unitBId };
    const failures: string[] = [];
    for (const entry of CLIENT_BOARD_PROPERTY_BOUND_OFFICE_PATHS) {
      const path = entry.path(ids);
      const req =
        entry.method === "GET"
          ? request(app).get(path)
          : request(app).post(path).send(bodyFor(path));
      const res = await req.set(memberAuth());
      if (res.status !== 403) {
        failures.push(`${entry.method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("lets the same property_manager read property A", async () => {
    const res = await request(app).get(`/api/v1/properties/${propertyA}/board`).set(memberAuth());
    expect(res.status).toBe(200);
    expect(res.body.propertyId).toBe(propertyA);
  });

  it("blocks a property_manager approve over the cents cap", async () => {
    const res = await request(app)
      .post(`/api/v1/turns/${turnA}/approve-scope`)
      .set(memberAuth())
      .send({});
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/cap/i);
  });

  it("hides third-party turns when workSource=in_house", async () => {
    const all = await request(app).get(`/api/v1/properties/${propertyA}/board`).set(officeAuth());
    expect(all.status).toBe(200);
    const allSources = (all.body.cards as Array<{ workSource: string }>).map((c) => c.workSource);
    expect(allSources).toEqual(expect.arrayContaining(["in_house", "third_party"]));

    const filtered = await request(app)
      .get(`/api/v1/properties/${propertyA}/board`)
      .query({ workSource: "in_house" })
      .set(officeAuth());
    expect(filtered.status).toBe(200);
    const sources = (filtered.body.cards as Array<{ workSource: string; turnId: string }>).map(
      (c) => c.workSource,
    );
    expect(sources.length).toBeGreaterThan(0);
    expect(sources.every((s) => s === "in_house")).toBe(true);
    expect(filtered.body.cards.some((c: { turnId: string }) => c.turnId === turnAInHouse)).toBe(true);
    expect(filtered.body.cards.some((c: { turnId: string }) => c.turnId === turnA)).toBe(false);
  });

  it("returns 404 on cost-to-serve when workSource is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "workSource"));
    try {
      const res = await request(app)
        .get(`/api/v1/portfolios/${portfolioId}/cost-to-serve`)
        .set(officeAuth());
      expect(res.status).toBe(404);
      expect(String(res.body.error)).toMatch(/not enabled/i);
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "workSource"));
    }
  });

  it("returns how-work cost-to-serve when the flag is on", async () => {
    const res = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/cost-to-serve`)
      .set(officeAuth());
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("How work gets done across the portfolio");
    expect(res.body.workSource).toBe("all");
  });
});

async function wipeSeg9() {
  const seeded = await db
    .select({ id: propertiesTable.id, clientOrgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.brief, BRIEF));
  const slugOrgs = await db
    .select({ id: clientOrgsTable.id })
    .from(clientOrgsTable)
    .where(eq(clientOrgsTable.slug, SLUG));
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
      await tx.execute(sql`DELETE FROM client_vendor_bid_lines WHERE bid_id IN (
        SELECT id FROM client_vendor_bids WHERE bid_request_id IN (
          SELECT id FROM client_bid_requests WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_vendor_bids WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_bid_invitations WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_bid_requests WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_invoice_lines WHERE invoice_id IN (
        SELECT id FROM client_turn_invoices WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_turn_invoices WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_variance_requests WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_scope_lines WHERE scope_id IN (
        SELECT id FROM client_scopes WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_scopes WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_records WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_evidence_items WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_gps_events WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_prediction_log WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_outbox WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
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
      await tx.execute(sql`DELETE FROM client_audit_log WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
