/**
 * Segment 6 — invoice compliance HTTP. Off-schedule lines 422 the invoice
 * gate, naming the line and the schedule. Flag dark → 404.
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
  clientPriceListsTable,
  clientPriceListItemsTable,
  clientScopesTable,
  clientScopeLinesTable,
  clientAuditLogTable,
  mulCents,
  zonedCivilToUtc,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn } from "../lib/turnEngine";

const BRIEF = "CAF_CLIENT_BOARD_INVOICE_SEG6";
const SLUG = "caf-invoice-seg6";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

describe("Property invoice compliance (HTTP)", () => {
  let orgId = "";
  let propertyId = "";
  let turnId = "";
  let scopeId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg6();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Invoice Seg6 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Invoice Seg6 Org" },
      })
      .returning();
    orgId = org!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Invoice — Paloma Creek",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 1,
        status: "active",
        entrataPropertyId: "PALOMA",
        invoiceToleranceBps: 0,
        varianceReviewMinutes: 12,
      })
      .returning();
    propertyId = property!.id;

    const [unit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "140",
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
      actorId: "test:seg6",
      idempotencyKey: "seg6-create",
    });
    turnId = created.turnId;

    const [list] = await db
      .insert(clientPriceListsTable)
      .values({
        propertyId,
        revision: "Rev 01",
        effectiveFrom: zonedCivilToUtc(CHICAGO, 2026, 8, 1, 0, 0, 0),
        effectiveTo: null,
      })
      .returning();

    await db.insert(clientPriceListItemsTable).values({
      priceListId: list!.id,
      code: "PAINT-WALLS",
      description: "Interior walls paint",
      category: "Paint",
      uom: "ea",
      unitPriceCents: 24500n,
      tier: "2br",
      isBidOnly: false,
    });

    const [scope] = await db
      .insert(clientScopesTable)
      .values({
        turnId,
        status: "draft",
        createdBy: "test:seg6",
      })
      .returning();
    scopeId = scope!.id;

    await db.insert(clientScopeLinesTable).values({
      scopeId,
      description: "Interior walls paint",
      code: "PAINT-WALLS",
      tier: "2br",
      qty: 1,
      uom: "ea",
      unitPriceCents: 24500n,
      extendedCents: mulCents(24500n, 1),
      compliance: "matched",
    });
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "invoiceCompliance"));
    await wipeSeg6();
  });

  it("blocks an invoice that names the off-schedule line and Rev 01", async () => {
    const added = await request(app)
      .post(`/api/v1/scopes/${scopeId}/lines`)
      .set(auth())
      .send({
        description: "Marble counter upgrade",
        code: "MARBLE-UP",
        qty: 1,
        unitPriceCents: "89000",
      });
    expect(added.status).toBe(200);
    expect(added.body.canInvoice).toBe(false);
    expect(added.body.lines.some((l: { code: string }) => l.code === "MARBLE-UP")).toBe(true);

    const blocked = await request(app).post(`/api/v1/scopes/${scopeId}/invoice`).set(auth()).send({});
    expect(blocked.status).toBe(422);
    expect(String(blocked.body.error)).toMatch(/Marble counter upgrade/);
    expect(String(blocked.body.error)).toMatch(/Rev 01/);
    expect(blocked.body.priceListRevision).toBe("Rev 01");
  });

  it("requires a reason, then invoices after variance approval", async () => {
    const scopeDoc = await request(app).get(`/api/v1/turns/${turnId}/scope`).set(auth());
    expect(scopeDoc.status).toBe(200);
    const marble = (scopeDoc.body.lines as Array<{ id: string; description: string }>).find(
      (l) => l.description === "Marble counter upgrade",
    );
    expect(marble).toBeTruthy();

    const missing = await request(app)
      .post(`/api/v1/scopes/${scopeId}/variance-request`)
      .set(auth())
      .send({ scopeLineId: marble!.id, reason: "   " });
    expect(missing.status).toBe(400);
    expect(String(missing.body.error)).toMatch(/reason/i);

    const raised = await request(app)
      .post(`/api/v1/scopes/${scopeId}/variance-request`)
      .set(auth())
      .send({
        scopeLineId: marble!.id,
        reason: "Owner-requested stone upgrade after walk.",
      });
    expect(raised.status).toBe(200);
    expect(raised.body.status).toBe("pending");

    const requested = await db
      .select({ action: clientAuditLogTable.action })
      .from(clientAuditLogTable)
      .where(eq(clientAuditLogTable.orgId, orgId));
    expect(requested.map((r) => r.action)).toContain("variance.requested");

    const approved = await request(app)
      .post(`/api/v1/variances/${raised.body.id}/approve`)
      .set(auth());
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");

    const after = await db
      .select({ action: clientAuditLogTable.action })
      .from(clientAuditLogTable)
      .where(eq(clientAuditLogTable.orgId, orgId));
    expect(after.map((r) => r.action)).toContain("variance.approved");

    const invoiced = await request(app).post(`/api/v1/scopes/${scopeId}/invoice`).set(auth()).send({});
    expect(invoiced.status).toBe(200);
    expect(invoiced.body.invoiceNumber).toMatch(/^PALOMA-140-\d{6}-001$/);
    expect(invoiced.body.firstPassAccepted).toBe(false);

    const json = await request(app)
      .get(`/api/v1/invoices/${invoiced.body.id}/export`)
      .query({ format: "json" })
      .set(auth());
    expect(json.status).toBe(200);
    expect(json.body.propertyCode).toBe("PALOMA");
    expect(json.body.unitNumber).toBe("140");
    expect(json.body.poNumber).toBeTruthy();
    expect(json.body.lines[0].glCode).toBe("6200");

    const csv = await request(app)
      .get(`/api/v1/invoices/${invoiced.body.id}/export`)
      .query({ format: "csv" })
      .set(auth());
    expect(csv.status).toBe(200);
    expect(String(csv.headers["content-type"])).toMatch(/csv/);
    expect(csv.text).toMatch(/PALOMA/);
    expect(csv.text).toMatch(/6200/);

    const pdf = await request(app)
      .get(`/api/v1/invoices/${invoiced.body.id}/export`)
      .query({ format: "pdf" })
      .set(auth())
      .buffer(true)
      .parse((res, fn) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        res.on("end", () => fn(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(String(pdf.headers["content-type"])).toMatch(/pdf/);
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe("%PDF");

    const stats = await request(app).get(`/api/v1/properties/${propertyId}/compliance-stats`).set(auth());
    expect(stats.status).toBe(200);
    expect(stats.body.assumption).toMatch(/assumption, not a measured duration/);
  });

  it("returns 404 when invoiceCompliance is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "invoiceCompliance"));
    try {
      const res = await request(app).get(`/api/v1/turns/${turnId}/scope`).set(auth());
      expect(res.status).toBe(404);
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "invoiceCompliance"));
    }
  });
});

async function wipeSeg6() {
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
