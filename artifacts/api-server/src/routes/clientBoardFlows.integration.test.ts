/**
 * Segment 12 — four HTTP e2e flows: approve a scope, block a non-compliant
 * invoice, award a bid, generate and verify a unit turn record.
 * Playwright (browser) lives in e2e/ and skips when browsers are missing.
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
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientPriceListsTable,
  clientPriceListItemsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientVendorScorecardsTable,
  clientOrgMembersTable,
  clientEvidenceItemsTable,
  mulCents,
  sha256Hex,
  zonedCivilToUtc,
  type TurnStage,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn, transitionTurn } from "../lib/turnEngine";
import { persistVerificationHash } from "../lib/turnEvidence";
import { VENDOR_ORG_HEADER } from "../lib/bidBoard";

const BRIEF = "CAF_CLIENT_BOARD_FLOWS_SEG12";
const SLUG = "caf-flows-seg12";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

const LINES = [
  { code: "PAINT-WALLS", tier: "2br", description: "Interior walls paint", category: "Paint", unitPriceCents: 24500n },
  { code: "CLEAN-FULL", tier: null, description: "Full make-ready clean", category: "Clean", unitPriceCents: 16500n },
  { code: "PUNCH-MISC", tier: null, description: "Punch list miscellaneous", category: "Punch", unitPriceCents: 4500n },
];

async function walk(orgId: string, turnId: string, stages: TurnStage[], start: Date) {
  let at = start;
  for (const to of stages) {
    at = new Date(at.getTime() + 2 * 3_600_000);
    await transitionTurn({
      orgId,
      turnId,
      to,
      source: "import",
      occurredAt: at,
      actorId: "test:seg12",
      idempotencyKey: `seg12-${turnId}-${to}`,
    });
  }
  return at;
}

describe("Client board e2e flows (HTTP)", () => {
  let orgId = "";
  let propertyId = "";
  let approveTurnId = "";
  let invoiceTurnId = "";
  let invoiceScopeId = "";
  let bidTurnId = "";
  let bidScopeId = "";
  let recordTurnId = "";
  const vendors: Array<{ id: string; pct: number; days: number }> = [];

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipe();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({ name: "CAF Flows Seg12", type: "pm_company", timezone: CHICAGO, slug: SLUG })
      .onConflictDoUpdate({ target: clientOrgsTable.slug, set: { name: "CAF Flows Seg12" } })
      .returning();
    orgId = org!.id;

    for (const v of [
      { slug: `${SLUG}-v1`, name: "Archangel Flows", pct: 0, days: 5 },
      { slug: `${SLUG}-v2`, name: "Summit Flows", pct: 10, days: 7 },
      { slug: `${SLUG}-v3`, name: "Prairie Flows", pct: 20, days: 10 },
    ]) {
      const [row] = await db
        .insert(clientOrgsTable)
        .values({ name: v.name, type: "vendor", timezone: CHICAGO, slug: v.slug })
        .onConflictDoUpdate({ target: clientOrgsTable.slug, set: { name: v.name } })
        .returning();
      vendors.push({ id: row!.id, pct: v.pct, days: v.days });
      await db.insert(clientOrgMembersTable).values({
        orgId: row!.id,
        userId: `test:seg12.vendor.${row!.id.slice(0, 8)}`,
        role: "vendor_admin",
        scope: null,
      });
    }

    const [port] = await db.insert(clientPortfoliosTable).values({ orgId, name: "Flows" }).returning();
    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Flows — Paloma Creek",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 4,
        status: "active",
        entrataPropertyId: "FLOWS",
      })
      .returning();
    propertyId = property!.id;
    await db.insert(clientPortfolioPropertiesTable).values({ portfolioId: port!.id, propertyId });

    const [list] = await db
      .insert(clientPriceListsTable)
      .values({
        propertyId,
        revision: "Rev 01",
        effectiveFrom: zonedCivilToUtc(CHICAGO, 2026, 1, 1, 0, 0, 0),
        effectiveTo: null,
      })
      .returning();
    await db.insert(clientPriceListItemsTable).values(
      LINES.map((item) => ({
        priceListId: list!.id,
        code: item.code,
        description: item.description,
        category: item.category,
        uom: "ea",
        unitPriceCents: item.unitPriceCents,
        tier: item.tier,
        isBidOnly: false,
      })),
    );

    const now = new Date();
    for (const v of vendors) {
      await db.insert(clientVendorScorecardsTable).values({
        vendorOrgId: v.id,
        propertyId,
        onTimePct: 90,
        reworkRate: 8,
        capacityUnitsPerWeek: 4,
        windowStart: new Date(now.getTime() - 90 * 86_400_000),
        windowEnd: now,
      });
    }

    const units = [];
    for (let i = 0; i < 4; i++) {
      const [unit] = await db
        .insert(clientUnitsTable)
        .values({
          propertyId,
          unitNumber: String(100 + i),
          bedrooms: 2,
          bathrooms: "2.0",
          marketRentCents: 145000n,
        })
        .returning();
      units.push(unit!);
    }

    const t0 = zonedCivilToUtc(CHICAGO, 2026, 8, 1, 8, 0, 0);

    const a = await createTurn({
      orgId, propertyId, unitId: units[0]!.id, source: "import", occurredAt: t0,
      actorId: "test:seg12", idempotencyKey: "seg12-approve",
    });
    approveTurnId = a.turnId;
    await walk(orgId, approveTurnId, ["vacated", "walk", "scoped", "pending_approval"], new Date(a.occurredAt));

    const b = await createTurn({
      orgId, propertyId, unitId: units[1]!.id, source: "import", occurredAt: t0,
      actorId: "test:seg12", idempotencyKey: "seg12-invoice",
    });
    invoiceTurnId = b.turnId;
    await walk(orgId, invoiceTurnId, ["vacated", "walk", "scoped"], new Date(b.occurredAt));
    const [invScope] = await db
      .insert(clientScopesTable)
      .values({ turnId: invoiceTurnId, status: "draft", createdBy: "test:seg12" })
      .returning();
    invoiceScopeId = invScope!.id;
    await db.insert(clientScopeLinesTable).values([
      {
        scopeId: invoiceScopeId,
        description: LINES[0]!.description,
        code: LINES[0]!.code,
        tier: LINES[0]!.tier,
        qty: 1,
        uom: "ea",
        unitPriceCents: LINES[0]!.unitPriceCents,
        extendedCents: mulCents(LINES[0]!.unitPriceCents, 1),
        compliance: "matched",
      },
      {
        scopeId: invoiceScopeId,
        description: "Marble counter upgrade",
        code: "MARBLE-UP",
        qty: 1,
        uom: "ea",
        unitPriceCents: 89000n,
        extendedCents: 89000n,
        compliance: "off_schedule",
      },
    ]);

    const c = await createTurn({
      orgId, propertyId, unitId: units[2]!.id, source: "import", occurredAt: t0,
      actorId: "test:seg12", idempotencyKey: "seg12-bid",
    });
    bidTurnId = c.turnId;
    await walk(orgId, bidTurnId, ["vacated", "walk", "scoped", "pending_approval", "approved"], new Date(c.occurredAt));
    const [bidScope] = await db
      .insert(clientScopesTable)
      .values({ turnId: bidTurnId, status: "draft", createdBy: "test:seg12" })
      .returning();
    bidScopeId = bidScope!.id;
    await db.insert(clientScopeLinesTable).values(
      LINES.map((item) => ({
        scopeId: bidScopeId,
        description: item.description,
        code: item.code,
        tier: item.tier,
        qty: 1,
        uom: "ea",
        unitPriceCents: item.unitPriceCents,
        extendedCents: mulCents(item.unitPriceCents, 1),
        compliance: "matched",
      })),
    );

    const d = await createTurn({
      orgId, propertyId, unitId: units[3]!.id, source: "import", occurredAt: t0,
      actorId: "test:seg12", idempotencyKey: "seg12-record",
    });
    recordTurnId = d.turnId;
    const at = await walk(orgId, recordTurnId, ["vacated", "walk"], new Date(d.occurredAt));
    await db.insert(clientEvidenceItemsTable).values({
      turnId: recordTurnId,
      unitId: units[3]!.id,
      kind: "photo",
      phase: "before",
      room: "living",
      storageKey: "seg12/living-before.png",
      sha256: sha256Hex("seg12-living-before"),
      mime: "image/png",
      bytes: 70n,
      deviceCapturedAt: at,
      serverReceivedAt: at,
      capturedByUserId: "Maya Chen",
    });
    await persistVerificationHash(recordTurnId, orgId);
  });

  afterAll(async () => {
    await wipe();
  });

  it("approves a scope from pending_approval", async () => {
    const ok = await request(app)
      .post(`/api/v1/turns/${approveTurnId}/approve-scope`)
      .set(auth())
      .set("Idempotency-Key", "seg12-approve-scope");
    expect(ok.status).toBe(200);
    expect(ok.body.to).toBe("approved");
  });

  it("blocks a non-compliant invoice naming the off-schedule line", async () => {
    const blocked = await request(app).post(`/api/v1/scopes/${invoiceScopeId}/invoice`).set(auth()).send({});
    expect(blocked.status).toBe(422);
    expect(String(blocked.body.error)).toMatch(/Marble counter upgrade/);
    expect(blocked.body.priceListRevision).toBe("Rev 01");
  });

  it("awards a bid with three vendor responses", async () => {
    const published = await request(app)
      .post(`/api/v1/scopes/${bidScopeId}/bid-requests`)
      .set(auth())
      .send({ dueAt: new Date(Date.now() + 14 * 86_400_000).toISOString() });
    expect(published.status).toBe(200);
    const bidRequestId = published.body.id as string;

    const invited = await request(app)
      .post(`/api/v1/bid-requests/${bidRequestId}/invitations`)
      .set(auth())
      .send({ vendorOrgIds: vendors.map((v) => v.id) });
    expect(invited.status).toBe(200);

    for (let i = 0; i < vendors.length; i++) {
      const vendor = vendors[i]!;
      const payload = {
        promisedDays: vendor.days,
        earliestStartAt: new Date(Date.now() + vendor.days * 86_400_000).toISOString(),
        lines: LINES.map((item) => ({
          code: item.code,
          tier: item.tier,
          unitPriceCents: (item.unitPriceCents + (item.unitPriceCents * BigInt(vendor.pct)) / 100n).toString(),
        })),
      };
      const submitted =
        i === 0
          ? await request(app)
              .post(`/api/v1/bid-requests/${bidRequestId}/bids`)
              .set(auth())
              .send({ ...payload, vendorOrgId: vendor.id })
          : await request(app)
              .post(`/api/v1/bid-requests/${bidRequestId}/bids`)
              .set(VENDOR_ORG_HEADER, vendor.id)
              .send(payload);
      expect(submitted.status).toBe(200);
    }

    const awarded = await request(app)
      .post(`/api/v1/bid-requests/${bidRequestId}/award`)
      .set(auth())
      .send({ vendorOrgId: vendors[0]!.id });
    expect(awarded.status).toBe(200);
    expect(awarded.body.vendorOrgId).toBe(vendors[0]!.id);
  });

  it("generates a unit turn record and verifies the ledger", async () => {
    const rec = await request(app)
      .post(`/api/v1/turns/${recordTurnId}/records`)
      .set(auth())
      .set("Idempotency-Key", "seg12-record")
      .send({ variant: "full" });
    expect(rec.status).toBe(200);
    expect(rec.body.status).toBe("ready");
    expect(rec.body.url).toMatch(/^\/api\/v1\/records\/[^/]+\/file\?/);

    const verify = await request(app).get(`/api/v1/turns/${recordTurnId}/verify`).set(auth());
    expect(verify.status).toBe(200);
    expect(verify.body.matches).toBe(true);
  });
});

async function wipe() {
  const seeded = await db
    .select({ id: propertiesTable.id, clientOrgId: propertiesTable.clientOrgId })
    .from(propertiesTable)
    .where(eq(propertiesTable.brief, BRIEF));
  const slugOrgs = await db.select({ id: clientOrgsTable.id }).from(clientOrgsTable).where(like(clientOrgsTable.slug, `${SLUG}%`));
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
      const inProps = sql.join(ids.map((id) => sql`${id}`), sql`, `);
      await tx.execute(sql`DELETE FROM client_turn_invoice_lines WHERE invoice_id IN (
        SELECT id FROM client_turn_invoices WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_turn_invoices WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_variance_requests WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_vendor_bid_lines WHERE bid_id IN (
        SELECT id FROM client_vendor_bids WHERE bid_request_id IN (
          SELECT id FROM client_bid_requests WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_vendor_bids WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_bid_invitations WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_bid_requests WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_scope_lines WHERE scope_id IN (
        SELECT id FROM client_scopes WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_scopes WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_price_list_items WHERE price_list_id IN (
        SELECT id FROM client_price_lists WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_price_lists WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_signed_url_tickets WHERE resource_id IN (
        SELECT id FROM client_turn_records WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps}))
        UNION SELECT id FROM client_evidence_items WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_turn_records WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_evidence_items WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_prediction_log WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_outbox WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_stage_events WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turns WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_vendor_scorecards WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_portfolio_properties WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_units WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM properties WHERE id IN (${inProps})`);
    }
    if (orgIds.length > 0) {
      const inOrgs = sql.join(orgIds.map((id) => sql`${id}`), sql`, `);
      await tx.execute(sql`DELETE FROM client_capacity_declarations WHERE vendor_org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolio_notifications WHERE user_id LIKE 'test:seg12.vendor.%' OR user_id LIKE 'vendor-org:%'`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
