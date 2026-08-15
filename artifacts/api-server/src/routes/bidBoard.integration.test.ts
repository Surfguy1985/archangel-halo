/**
 * Segment 7 — Bid Board HTTP. Three vendors on one 14-line scope produce
 * an aligned comparison. Award schedules the turn and emits SSE.
 * Flag dark → 404.
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
  clientTurnsTable,
  clientBoardFlagsTable,
  clientPortfoliosTable,
  clientPortfolioPropertiesTable,
  clientPriceListsTable,
  clientPriceListItemsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientVendorScorecardsTable,
  clientCapacityDeclarationsTable,
  clientOrgMembersTable,
  clientPortfolioNotificationsTable,
  clientAccountsTable,
  mulCents,
  zonedCivilToUtc,
  type TurnStage,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn, transitionTurn } from "../lib/turnEngine";
import { onPortfolioFrame } from "../lib/clientPortfolioEvents";
import { VENDOR_ORG_HEADER } from "../lib/bidBoard";

const BRIEF = "CAF_CLIENT_BOARD_BID_SEG7";
const SLUG = "caf-bid-seg7";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

const BOOK: Array<{
  code: string;
  tier: string | null;
  description: string;
  category: string;
  unitPriceCents: bigint;
}> = [
  { code: "PAINT-WALLS", tier: "2br", description: "Interior walls paint", category: "Paint", unitPriceCents: 24500n },
  { code: "CLEAN-FULL", tier: null, description: "Full make-ready clean", category: "Clean", unitPriceCents: 16500n },
  { code: "FLOOR-LVP", tier: null, description: "LVP plank replace (room)", category: "Flooring", unitPriceCents: 42000n },
  { code: "DRYWALL-PATCH", tier: null, description: "Drywall patch and texture", category: "Drywall", unitPriceCents: 8500n },
  { code: "PUNCH-MISC", tier: null, description: "Punch list miscellaneous", category: "Punch", unitPriceCents: 4500n },
  { code: "HVAC-FILTER", tier: null, description: "HVAC filter replace", category: "HVAC", unitPriceCents: 2500n },
  { code: "BLINDS-STD", tier: null, description: "Standard blinds replace", category: "Punch", unitPriceCents: 6500n },
  { code: "APPL-WIPE", tier: null, description: "Appliance wipe-down", category: "Clean", unitPriceCents: 3500n },
  { code: "CARPET-STEAM", tier: null, description: "Carpet steam clean", category: "Clean", unitPriceCents: 12000n },
  { code: "TUB-REGROUT", tier: null, description: "Tub / surround regrout", category: "Punch", unitPriceCents: 14500n },
  { code: "TOILET-SEAT", tier: null, description: "Toilet seat replace", category: "Punch", unitPriceCents: 4200n },
  { code: "OUTLET-COVER", tier: null, description: "Outlet cover replace", category: "Punch", unitPriceCents: 1500n },
  { code: "CAULK-KITCHEN", tier: null, description: "Kitchen backsplash recaulk", category: "Punch", unitPriceCents: 3800n },
  { code: "SCREEN-REPAIR", tier: null, description: "Window screen repair", category: "Punch", unitPriceCents: 2800n },
];

function bump(cents: bigint, pct: number): string {
  return (cents + (cents * BigInt(pct)) / 100n).toString();
}

async function walk(
  orgId: string,
  turnId: string,
  stages: TurnStage[],
  start: Date,
): Promise<void> {
  let at = start;
  for (const to of stages) {
    at = new Date(at.getTime() + 2 * 3_600_000);
    await transitionTurn({
      orgId,
      turnId,
      to,
      source: "import",
      occurredAt: at,
      actorId: "test:seg7",
      idempotencyKey: `seg7-${turnId}-${to}`,
    });
  }
}

describe("Bid board (HTTP)", () => {
  let orgId = "";
  let portfolioId = "";
  let propertyId = "";
  let turnId = "";
  let scopeId = "";
  let bidRequestId = "";
  const vendors: Array<{ id: string; name: string; pct: number; days: number }> = [];

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg7();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Bid Seg7 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Bid Seg7 Org" },
      })
      .returning();
    orgId = org!.id;

    const vendorSeed = [
      { slug: `${SLUG}-v1`, name: "Archangel Make-Ready", pct: 0, days: 5, onTime: 94, rework: 4, cap: 4 },
      { slug: `${SLUG}-v2`, name: "Prairie Star Painting", pct: 10, days: 7, onTime: 82, rework: 11, cap: 2 },
      { slug: `${SLUG}-v3`, name: "Summit Punch Co", pct: 20, days: 10, onTime: 70, rework: 18, cap: 1 },
    ];
    for (const v of vendorSeed) {
      const [row] = await db
        .insert(clientOrgsTable)
        .values({
          name: v.name,
          type: "vendor",
          timezone: CHICAGO,
          slug: v.slug,
        })
        .onConflictDoUpdate({
          target: clientOrgsTable.slug,
          set: { name: v.name },
        })
        .returning();
      vendors.push({ id: row!.id, name: v.name, pct: v.pct, days: v.days });
    }

    await db.insert(clientOrgMembersTable).values(
      vendors.map((v, i) => ({
        orgId: v.id,
        userId: `test:vendor.${i + 1}`,
        role: "vendor_admin",
        scope: null,
      })),
    );

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region" })
      .returning();
    portfolioId = port!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Bid — Paloma Creek",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 1,
        status: "active",
        entrataPropertyId: "PALOMA",
      })
      .returning();
    propertyId = property!.id;

    await db.insert(clientPortfolioPropertiesTable).values({ portfolioId, propertyId });

    await db.insert(clientAccountsTable).values({
      propertyId,
      dashboardToken: "caf-bid-seg7-token",
      status: "active",
    });

    const [unit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "214",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();

    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit!.id,
      source: "import",
      occurredAt: zonedCivilToUtc(CHICAGO, 2026, 8, 1, 8, 0, 0),
      actorId: "test:seg7",
      idempotencyKey: "seg7-create",
    });
    turnId = created.turnId;
    await walk(
      orgId,
      turnId,
      ["vacated", "walk", "scoped", "pending_approval", "approved"],
      new Date(created.occurredAt),
    );

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
      BOOK.map((item) => ({
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

    const [scope] = await db
      .insert(clientScopesTable)
      .values({
        turnId,
        status: "draft",
        createdBy: "test:seg7",
      })
      .returning();
    scopeId = scope!.id;

    await db.insert(clientScopeLinesTable).values(
      BOOK.map((item) => ({
        scopeId,
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

    const now = new Date();
    const windowStart = new Date(now.getTime() - 90 * 86_400_000);
    for (let i = 0; i < vendors.length; i++) {
      const v = vendorSeed[i]!;
      await db.insert(clientVendorScorecardsTable).values({
        vendorOrgId: vendors[i]!.id,
        propertyId,
        onTimePct: v.onTime,
        reworkRate: v.rework,
        capacityUnitsPerWeek: v.cap,
        windowStart,
        windowEnd: now,
      });
      await db.insert(clientCapacityDeclarationsTable).values({
        vendorOrgId: vendors[i]!.id,
        trade: "make_ready",
        weekStart: now,
        unitsCapacity: v.cap,
      });
    }
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "bidBoard"));
    await wipeSeg7();
  });

  it("aligns three vendors on every line of a 14-code scope, then awards", async () => {
    const dueAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const published = await request(app)
      .post(`/api/v1/scopes/${scopeId}/bid-requests`)
      .set(auth())
      .send({ dueAt });
    expect(published.status).toBe(200);
    bidRequestId = published.body.id;
    expect(bidRequestId).toBeTruthy();

    const scopeDoc = await request(app).get(`/api/v1/turns/${turnId}/scope`).set(auth());
    expect(scopeDoc.status).toBe(200);
    expect(scopeDoc.body.bidRequestId).toBe(bidRequestId);

    const invited = await request(app)
      .post(`/api/v1/bid-requests/${bidRequestId}/invitations`)
      .set(auth())
      .send({ vendorOrgIds: vendors.map((v) => v.id) });
    expect(invited.status).toBe(200);
    expect(invited.body.invited).toHaveLength(3);

    const inviteNotes = await db
      .select()
      .from(clientPortfolioNotificationsTable)
      .where(eq(clientPortfolioNotificationsTable.kind, "bid.invited"));
    expect(inviteNotes.filter((n) => n.userId.startsWith("test:vendor."))).toHaveLength(3);

    for (let i = 0; i < vendors.length; i++) {
      const vendor = vendors[i]!;
      const payload = {
        promisedDays: vendor.days,
        earliestStartAt: new Date(Date.now() + vendor.days * 86_400_000).toISOString(),
        lines: BOOK.map((item) => ({
          code: item.code,
          tier: item.tier,
          unitPriceCents: bump(item.unitPriceCents, vendor.pct),
        })),
      };
      const req =
        i === 0
          ? request(app)
              .post(`/api/v1/bid-requests/${bidRequestId}/bids`)
              .set(auth())
              .send({ ...payload, vendorOrgId: vendor.id })
          : request(app)
              .post(`/api/v1/bid-requests/${bidRequestId}/bids`)
              .set(VENDOR_ORG_HEADER, vendor.id)
              .send(payload);
      const submitted = await req;
      expect(submitted.status).toBe(200);
      expect(submitted.body.bidId).toBeTruthy();
      expect(typeof submitted.body.score).toBe("number");
    }

    const comparison = await request(app)
      .get(`/api/v1/bid-requests/${bidRequestId}/comparison`)
      .set(auth());
    expect(comparison.status).toBe(200);
    expect(comparison.body.weights).toEqual({
      priceVsSchedule: 35,
      onTime: 25,
      rework: 20,
      capacity: 20,
    });
    expect(comparison.body.timezone).toBe(CHICAGO);
    expect(comparison.body.lines).toHaveLength(14);
    expect(comparison.body.vendors).toHaveLength(3);
    expect(comparison.body.vendors.every((v: { submitted: boolean }) => v.submitted)).toBe(true);
    const invitedIds = vendors.map((v) => v.id);
    expect(
      (comparison.body.eligibleVendors as Array<{ vendorOrgId: string }>).every(
        (e) => !invitedIds.includes(e.vendorOrgId),
      ),
    ).toBe(true);

    const twin = await request(app).get(`/api/client/caf-bid-seg7-token/bid-requests/${bidRequestId}/comparison`);
    expect(twin.status).toBe(200);
    expect(twin.body.lines).toHaveLength(14);

    const codes = comparison.body.lines.map((l: { code: string }) => l.code);
    expect(new Set(codes).size).toBe(14);
    expect(codes.sort()).toEqual([...BOOK.map((b) => b.code)].sort());

    for (const line of comparison.body.lines as Array<{
      code: string;
      cells: Array<{ vendorOrgId: string; unitPriceCents: string | null }>;
    }>) {
      expect(line.cells).toHaveLength(3);
      expect(line.cells.map((c) => c.vendorOrgId).sort()).toEqual(vendors.map((v) => v.id).sort());
      expect(line.cells.every((c) => typeof c.unitPriceCents === "string")).toBe(true);
    }

    const frames: Array<{ type: string; scores?: Array<{ score: number; awarded: boolean }> }> = [];
    const stop = onPortfolioFrame(portfolioId, (f) => frames.push(f));
    const winner = vendors[0]!;
    const awarded = await request(app)
      .post(`/api/v1/bid-requests/${bidRequestId}/award`)
      .set(auth())
      .set("Idempotency-Key", "seg7-award")
      .send({ vendorOrgId: winner.id });
    stop();

    expect(awarded.status).toBe(200);
    expect(awarded.body.to).toBe("scheduled");
    expect(awarded.body.vendorOrgId).toBe(winner.id);
    expect(awarded.body.poPayload).toMatchObject({
      adapter: "csv",
      kind: "purchase_order",
      vendorOrgId: winner.id,
    });
    expect(awarded.body.scores).toHaveLength(3);
    expect(awarded.body.scores.filter((s: { awarded: boolean }) => s.awarded)).toHaveLength(1);
    const awardedFrame = frames.find((f) => f.type === "bid.awarded");
    expect(awardedFrame?.scores).toHaveLength(3);
    expect(awardedFrame?.scores?.some((s) => s.awarded)).toBe(true);

    const notes = await db
      .select()
      .from(clientPortfolioNotificationsTable)
      .where(eq(clientPortfolioNotificationsTable.kind, "bid.awarded"));
    const vendorNotes = notes.filter((n) => n.userId.startsWith("test:vendor."));
    expect(vendorNotes).toHaveLength(3);
    expect(
      vendorNotes.every((n) => {
        const payload = n.payload as { score?: number; awarded?: boolean };
        return typeof payload.score === "number";
      }),
    ).toBe(true);
    expect(vendorNotes.filter((n) => (n.payload as { awarded?: boolean }).awarded)).toHaveLength(1);

    const [turn] = await db
      .select({ status: clientTurnsTable.status, assignedVendorOrgId: clientTurnsTable.assignedVendorOrgId })
      .from(clientTurnsTable)
      .where(eq(clientTurnsTable.id, turnId))
      .limit(1);
    expect(turn?.status).toBe("scheduled");
    expect(turn?.assignedVendorOrgId).toBe(winner.id);

    const after = await request(app)
      .get(`/api/v1/bid-requests/${bidRequestId}/comparison`)
      .set(auth());
    expect(after.body.status).toBe("awarded");
    expect(after.body.awardedVendorOrgId).toBe(winner.id);
    expect(after.body.poPayload).toBeTruthy();
  });

  it("refuses to award until two vendors have submitted", async () => {
    const [unit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "215",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit!.id,
      source: "import",
      occurredAt: zonedCivilToUtc(CHICAGO, 2026, 8, 2, 8, 0, 0),
      actorId: "test:seg7",
      idempotencyKey: "seg7-solo-create",
    });
    await walk(
      orgId,
      created.turnId,
      ["vacated", "walk", "scoped", "pending_approval", "approved"],
      new Date(created.occurredAt),
    );
    const [scope] = await db
      .insert(clientScopesTable)
      .values({
        turnId: created.turnId,
        status: "draft",
        createdBy: "test:seg7",
      })
      .returning();
    await db.insert(clientScopeLinesTable).values(
      BOOK.map((item) => ({
        scopeId: scope!.id,
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
    const published = await request(app)
      .post(`/api/v1/scopes/${scope!.id}/bid-requests`)
      .set(auth())
      .send({ dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    expect(published.status).toBe(200);
    const soloId = published.body.id as string;
    const invited = await request(app)
      .post(`/api/v1/bid-requests/${soloId}/invitations`)
      .set(auth())
      .send({ vendorOrgIds: [vendors[0]!.id] });
    expect(invited.status).toBe(200);
    const submitted = await request(app)
      .post(`/api/v1/bid-requests/${soloId}/bids`)
      .set(auth())
      .send({
        vendorOrgId: vendors[0]!.id,
        promisedDays: 5,
        lines: BOOK.map((item) => ({
          code: item.code,
          tier: item.tier,
          unitPriceCents: item.unitPriceCents.toString(),
        })),
      });
    expect(submitted.status).toBe(200);
    const awarded = await request(app)
      .post(`/api/v1/bid-requests/${soloId}/award`)
      .set(auth())
      .set("Idempotency-Key", "seg7-solo-award")
      .send({ vendorOrgId: vendors[0]!.id });
    expect(awarded.status).toBe(409);
    expect(awarded.body.error).toMatch(/single-vendor board is not a product/i);
  });

  it("returns 404 when bidBoard is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "bidBoard"));
    try {
      const res = await request(app)
        .get(`/api/v1/bid-requests/${bidRequestId || "00000000-0000-0000-0000-000000000000"}/comparison`)
        .set(auth());
      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Bid board is not enabled");
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "bidBoard"));
    }
  });
});

async function wipeSeg7() {
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
      await tx.execute(sql`DELETE FROM client_vendor_bid_lines WHERE bid_id IN (
        SELECT id FROM client_vendor_bids WHERE bid_request_id IN (
          SELECT id FROM client_bid_requests WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_vendor_bids WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_bid_invitations WHERE bid_request_id IN (
        SELECT id FROM client_bid_requests WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_bid_requests WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_accounts WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_vendor_scorecards WHERE property_id IN (${inProps})`);
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
      await tx.execute(sql`DELETE FROM client_price_list_items WHERE price_list_id IN (
        SELECT id FROM client_price_lists WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_price_lists WHERE property_id IN (${inProps})`);
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
      await tx.execute(sql`DELETE FROM client_capacity_declarations WHERE vendor_org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolio_notifications WHERE user_id LIKE 'test:vendor.%' OR user_id LIKE 'vendor-org:%'`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
