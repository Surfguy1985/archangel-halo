/**
 * Segment 11 — audit roles, signed-URL single-use, tombstone still verifies.
 * Flag dark → 404. caf-sec-seg11 / CAF_CLIENT_BOARD_SEC_SEG11.
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
  clientEvidenceItemsTable,
  clientAuditLogTable,
  sha256Hex,
  zonedCivilToUtc,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn } from "../lib/turnEngine";
import { persistVerificationHash } from "../lib/turnEvidence";
import { CLIENT_BOARD_MEMBER_HEADER } from "../lib/clientBoardAccess";

const BRIEF = "CAF_CLIENT_BOARD_SEC_SEG11";
const SLUG = "caf-sec-seg11";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const officeAuth = () => ({ Cookie: COOKIE });

describe("Client board security (HTTP)", () => {
  let orgId = "";
  let portfolioId = "";
  let propertyId = "";
  let turnId = "";
  let evidenceId = "";
  let auditorId = "";
  let regionalId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg11();
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "security"));
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "workSource"));
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "evidence"));

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Sec Seg11 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Sec Seg11 Org" },
      })
      .returning();
    orgId = org!.id;

    const [port] = await db
      .insert(clientPortfoliosTable)
      .values({ orgId, name: "North Region" })
      .returning();
    portfolioId = port!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Sec — Paloma Creek",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 1,
        status: "active",
      })
      .returning();
    propertyId = property!.id;
    await db.insert(clientPortfolioPropertiesTable).values({ portfolioId, propertyId });

    const [auditor] = await db
      .insert(clientOrgMembersTable)
      .values({ orgId, userId: "test:auditor", role: "auditor", scope: null })
      .returning();
    auditorId = auditor!.id;
    const [regional] = await db
      .insert(clientOrgMembersTable)
      .values({
        orgId,
        userId: "test:regional",
        role: "regional_manager",
        scope: { portfolioIds: [portfolioId] },
      })
      .returning();
    regionalId = regional!.id;

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

    const t0 = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 8, 0, 0);
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit!.id,
      source: "import",
      occurredAt: t0,
      actorId: "test:seg11",
      idempotencyKey: "seg11-create",
    });
    turnId = created.turnId;

    const [item] = await db
      .insert(clientEvidenceItemsTable)
      .values({
        turnId,
        unitId: unit!.id,
        kind: "photo",
        phase: "before",
        room: "living",
        storageKey: "seg11/living-before.png",
        sha256: sha256Hex("living:before"),
        mime: "image/png",
        bytes: 70n,
        capturedByUserId: "Maya Chen",
      })
      .returning();
    evidenceId = item!.id;
    await persistVerificationHash(turnId, orgId);

    await db.insert(clientAuditLogTable).values({
      orgId,
      actorId: "test:seg11",
      entityType: "turn",
      entityId: turnId,
      action: "turn.created",
    });
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "security"));
    await wipeSeg11();
  });

  it("lets an auditor read the log and forbids a regional manager", async () => {
    const ok = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/audit`)
      .set(officeAuth())
      .set(CLIENT_BOARD_MEMBER_HEADER, auditorId);
    expect(ok.status).toBe(200);
    expect(ok.body.portfolioId).toBe(portfolioId);
    expect(ok.body.entries.length).toBeGreaterThan(0);

    const office = await request(app).get(`/api/v1/portfolios/${portfolioId}/audit`).set(officeAuth());
    expect(office.status).toBe(200);

    const denied = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/audit`)
      .set(officeAuth())
      .set(CLIENT_BOARD_MEMBER_HEADER, regionalId);
    expect(denied.status).toBe(403);
  });

  it("exports CSV", async () => {
    const res = await request(app)
      .get(`/api/v1/portfolios/${portfolioId}/audit/export`)
      .set(officeAuth());
    expect(res.status).toBe(200);
    expect(String(res.headers["content-type"])).toMatch(/csv/);
    expect(String(res.text)).toMatch(/occurredAt,actorId,entityType,entityId,action/);
  });

  it("returns 404 when security is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "security"));
    try {
      const res = await request(app).get(`/api/v1/portfolios/${portfolioId}/audit`).set(officeAuth());
      expect(res.status).toBe(404);
      expect(String(res.body.error)).toMatch(/not enabled/i);
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "security"));
    }
  });

  it("burns a signed evidence URL after the first GET", async () => {
    const ledger = await request(app).get(`/api/v1/turns/${turnId}/evidence`).set(officeAuth());
    expect(ledger.status).toBe(200);
    const url = ledger.body.rooms[0].before[0].thumbUrl as string;
    expect(url).toMatch(/jti=/);

    const first = await request(app).get(url);
    expect(first.status).toBe(200);

    const second = await request(app).get(url);
    expect(second.status).toBe(404);

    const missing = await request(app).get(url.replace(/jti=[^&]+/, ""));
    expect(missing.status).toBe(404);
  });

  it("still verifies after a retention tombstone", async () => {
    const before = await request(app).get(`/api/v1/turns/${turnId}/verify`).set(officeAuth());
    expect(before.status).toBe(200);
    expect(before.body.matches).toBe(true);

    const cut = await request(app).post(`/api/v1/evidence/${evidenceId}/tombstone`).set(officeAuth());
    expect(cut.status).toBe(200);
    expect(cut.body.turnId).toBe(turnId);

    const after = await request(app).get(`/api/v1/turns/${turnId}/verify`).set(officeAuth());
    expect(after.status).toBe(200);
    expect(after.body.matches).toBe(true);

    const ledger = await request(app).get(`/api/v1/turns/${turnId}/evidence`).set(officeAuth());
    const living = (ledger.body.rooms as Array<{ room: string; before: unknown[] }>).find((r) => r.room === "living");
    expect(living?.before ?? []).toEqual([]);
  });
});

async function wipeSeg11() {
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
      await tx.execute(sql`DELETE FROM client_signed_url_tickets WHERE resource_id IN (
        SELECT id FROM client_evidence_items WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps}))
        UNION
        SELECT id FROM client_turn_records WHERE turn_id IN (SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
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
      await tx.execute(sql`DELETE FROM client_audit_log WHERE entity_id IN (
        SELECT id::text FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (
        SELECT client_org_id FROM properties WHERE id IN (${inProps}))`);
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
      await tx.execute(sql`DELETE FROM client_signed_url_tickets WHERE resource_id IN (
        SELECT e.id FROM client_evidence_items e JOIN client_turns t ON t.id = e.turn_id WHERE t.org_id IN (${inOrgs})
        UNION
        SELECT r.id FROM client_turn_records r JOIN client_turns t ON t.id = r.turn_id WHERE t.org_id IN (${inOrgs}))`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
