/**
 * Segment 10 (CSV only) — Entrata import HTTP. Same file is idempotent.
 * Flag dark → 404. Product does not call the API adapter.
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
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { EntrataApiAdapter } from "../lib/entrataApiAdapter";
import { EntrataCsvAdapter, getEntrataAdapter } from "../lib/entrataCsvAdapter";

const BRIEF = "CAF_CLIENT_BOARD_IMPORT_SEG10";
const SLUG = "caf-import-seg10";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

const UNITS_CSV = `Property ID,Unit Number,Unit ID,Bedrooms,Bathrooms,Sq Ft,Market Rent
PALOMA,140,U-140,2,2.0,980,$1450.00
`;

const NOTICES_CSV = `Property ID,Unit Number,Notice ID,Notice Date,Scheduled Vacate,Lease ID
PALOMA,140,NTV-140,2026-08-01,2026-08-31,L-9001
`;

describe("Entrata CSV import (HTTP)", () => {
  let orgId = "";
  let propertyId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg10();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Import Seg10 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Import Seg10 Org" },
      })
      .returning();
    orgId = org!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Import — Paloma Creek",
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

    const [portfolio] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region" })
      .returning();
    await db.insert(clientPortfolioPropertiesTable).values({
      portfolioId: portfolio!.id,
      propertyId,
    });
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "csvImport"));
    await wipeSeg10();
  });

  it("defaults to the CSV adapter, not the API stub", () => {
    expect(getEntrataAdapter()).toBeInstanceOf(EntrataCsvAdapter);
    expect(new EntrataApiAdapter().kind).toBe("api");
  });

  it("upserts units and replays the same file", async () => {
    const first = await request(app)
      .post("/api/v1/imports/entrata")
      .set(auth())
      .send({ kind: "units", filename: "units.csv", csv: UNITS_CSV });
    expect(first.status).toBe(200);
    expect(first.body.adapter).toBe("csv");
    expect(first.body.createdCount).toBe(1);
    expect(first.body.status).toBe("applied");

    const units = await db.select().from(clientUnitsTable).where(eq(clientUnitsTable.propertyId, propertyId));
    expect(units).toHaveLength(1);
    expect(units[0]!.marketRentCents).toBe(145000n);
    expect(units[0]!.entrataUnitId).toBe("U-140");

    const again = await request(app)
      .post("/api/v1/imports/entrata")
      .set(auth())
      .send({ kind: "units", filename: "units.csv", csv: UNITS_CSV });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("replayed");
    expect(again.body.id).toBe(first.body.id);

    const still = await db.select().from(clientUnitsTable).where(eq(clientUnitsTable.propertyId, propertyId));
    expect(still).toHaveLength(1);
  });

  it("opens a turn from a notice and skips the same notice id", async () => {
    const first = await request(app)
      .post("/api/v1/imports/entrata")
      .set(auth())
      .send({ kind: "notices", filename: "ntv.csv", csv: NOTICES_CSV });
    expect(first.status).toBe(200);
    expect(first.body.createdCount + first.body.updatedCount).toBeGreaterThanOrEqual(1);

    const turns = await db.select().from(clientTurnsTable).where(eq(clientTurnsTable.propertyId, propertyId));
    expect(turns.length).toBeGreaterThanOrEqual(1);
    expect(turns[0]!.entrataNoticeId).toBe("NTV-140");
    expect(turns[0]!.status).toBe("notice");

    const again = await request(app)
      .post("/api/v1/imports/entrata")
      .set(auth())
      .send({
        kind: "notices",
        filename: "ntv-alias.csv",
        csv: `Property ID,Unit Number,Notice ID,NTV Date,Vacate Date,Lease ID
PALOMA,140,NTV-140,2026-08-01,2026-08-31,L-9001
`,
      });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("applied");
    expect(again.body.skippedCount).toBeGreaterThanOrEqual(1);
    const after = await db.select().from(clientTurnsTable).where(eq(clientTurnsTable.propertyId, propertyId));
    expect(after).toHaveLength(turns.length);
  });

  it("returns 404 when csvImport is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "csvImport"));
    try {
      const res = await request(app).get("/api/v1/imports/entrata").set(auth());
      expect(res.status).toBe(404);
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "csvImport"));
    }
  });
});

async function wipeSeg10() {
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
      await tx.execute(sql`DELETE FROM client_entrata_purchase_orders WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_invoice_lines WHERE invoice_id IN (
        SELECT id FROM client_turn_invoices WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_turn_invoices WHERE turn_id IN (
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
      await tx.execute(sql`DELETE FROM client_entrata_imports WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
