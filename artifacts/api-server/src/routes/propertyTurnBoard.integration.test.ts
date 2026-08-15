/**
 * Segment 4 — Turn Ring HTTP. Two-rework fixture, band clock, drag off,
 * approve-scope 200/409, flag dark → 404.
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
  zonedCivilToUtc,
  calendarDaysBetween,
  type TurnStage,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn, transitionTurn } from "../lib/turnEngine";

const BRIEF = "CAF_CLIENT_BOARD_TURN_SEG4";
const SLUG = "caf-turn-seg4";
const CHICAGO = "America/Chicago";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

async function walk(
  orgId: string,
  turnId: string,
  stages: TurnStage[],
  start: Date,
  hours: number,
): Promise<Date> {
  let at = start;
  for (const to of stages) {
    at = new Date(at.getTime() + hours * 3_600_000);
    await transitionTurn({
      orgId,
      turnId,
      to,
      source: "import",
      occurredAt: at,
      actorId: "test:seg4",
      idempotencyKey: `seg4-${turnId}-${to}-${at.toISOString()}`,
    });
  }
  return at;
}

describe("Property Turn Ring board (HTTP)", () => {
  let orgId = "";
  let propertyId = "";
  let reworkTurnId = "";
  let approvalTurnId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg4();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Turn Seg4 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Turn Seg4 Org" },
      })
      .returning();
    orgId = org!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Turn — Desert Sage",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 4,
        status: "active",
      })
      .returning();
    propertyId = property!.id;

    const [reworkUnit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "204",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
      })
      .returning();
    const [approvalUnit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "305",
        bedrooms: 1,
        bathrooms: "1.0",
        marketRentCents: 120000n,
      })
      .returning();

    const t0 = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 8, 0, 0);
    const rework = await createTurn({
      orgId,
      propertyId,
      unitId: reworkUnit!.id,
      source: "import",
      occurredAt: t0,
      actorId: "test:seg4",
      idempotencyKey: "seg4-create-rework",
    });
    reworkTurnId = rework.turnId;
    await walk(
      orgId,
      reworkTurnId,
      [
        "vacated",
        "walk",
        "scoped",
        "pending_approval",
        "approved",
        "scheduled",
        "in_progress",
        "qc",
        "rework",
        "in_progress",
        "qc",
        "rework",
        "in_progress",
      ],
      t0,
      4,
    );

    const a0 = zonedCivilToUtc(CHICAGO, 2026, 7, 10, 8, 0, 0);
    const approval = await createTurn({
      orgId,
      propertyId,
      unitId: approvalUnit!.id,
      source: "import",
      occurredAt: a0,
      actorId: "test:seg4",
      idempotencyKey: "seg4-create-approval",
    });
    approvalTurnId = approval.turnId;
    await walk(
      orgId,
      approvalTurnId,
      ["vacated", "walk", "scoped", "pending_approval"],
      a0,
      3,
    );
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "propertyBoard"));
    await wipeSeg4();
  });

  it("lists open turns with drag disabled", async () => {
    const res = await request(app).get(`/api/v1/properties/${propertyId}/board`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.dragEnabled).toBe(false);
    expect(res.body.propertyId).toBe(propertyId);
    const ids = (res.body.cards as Array<{ turnId: string }>).map((c) => c.turnId);
    expect(ids).toContain(reworkTurnId);
    expect(ids).toContain(approvalTurnId);
  });

  it("shows two rework arcs and a stage band that sums to the event clock", async () => {
    const res = await request(app).get(`/api/v1/turns/${reworkTurnId}`).set(auth());
    expect(res.status).toBe(200);
    const reworkArcs = (res.body.ring.arcs as Array<{
      stage: string;
      visitIndex: number;
      predicted: boolean;
      actorId: string | null;
      durationMs: number;
    }>).filter((a) => a.stage === "rework" && !a.predicted);
    expect(reworkArcs).toHaveLength(2);
    expect(reworkArcs.some((a) => a.visitIndex > 0)).toBe(true);
    expect(reworkArcs.every((a) => a.actorId === "test:seg4")).toBe(true);
    expect(reworkArcs.every((a) => a.durationMs > 0)).toBe(true);

    const band = res.body.band as Array<{
      durationMs: number;
      stage: string;
      visitIndex: number;
      enteredAt: string;
      exitedAt: string | null;
      actorId: string | null;
    }>;
    const sum = band.reduce((s, r) => s + r.durationMs, 0);
    expect(res.body.bandDurationMs).toBe(sum);
    expect(sum).toBeGreaterThan(0);
    expect(band.filter((r) => r.stage === "rework")).toHaveLength(2);
    expect(band.some((r) => r.visitIndex > 0)).toBe(true);
    expect(band.every((r) => r.actorId === "test:seg4")).toBe(true);

    const chrono = [...band].sort((a, b) => a.enteredAt.localeCompare(b.enteredAt));
    for (let i = 0; i < chrono.length - 1; i++) {
      expect(chrono[i]!.exitedAt).toBe(chrono[i + 1]!.enteredAt);
    }
    const first = new Date(chrono[0]!.enteredAt).getTime();
    const last = chrono[chrono.length - 1]!;
    const end = last.exitedAt ? new Date(last.exitedAt).getTime() : Date.now();
    expect(Math.abs(sum - (end - first))).toBeLessThan(8_000);

    const [turn] = await db
      .select({ actualVacateAt: clientTurnsTable.actualVacateAt })
      .from(clientTurnsTable)
      .where(eq(clientTurnsTable.id, reworkTurnId))
      .limit(1);
    expect(turn?.actualVacateAt).toBeTruthy();
    const asOf = new Date();
    expect(res.body.daysVacant).toBe(calendarDaysBetween(turn!.actualVacateAt!, asOf, CHICAGO));
    const vacantMs = band.filter((r) => r.stage !== "notice").reduce((s, r) => s + r.durationMs, 0);
    expect(Math.abs(vacantMs - (asOf.getTime() - turn!.actualVacateAt!.getTime()))).toBeLessThan(8_000);
  });

  it("approves scope from pending_approval and conflicts otherwise", async () => {
    const ok = await request(app)
      .post(`/api/v1/turns/${approvalTurnId}/approve-scope`)
      .set(auth())
      .set("Idempotency-Key", "seg4-approve-scope");
    expect(ok.status).toBe(200);
    expect(ok.body.to).toBe("approved");

    const conflict = await request(app)
      .post(`/api/v1/turns/${reworkTurnId}/approve-scope`)
      .set(auth())
      .set("Idempotency-Key", "seg4-approve-scope-conflict");
    expect(conflict.status).toBe(409);
  });

  it("returns 404 when propertyBoard is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "propertyBoard"));
    try {
      const res = await request(app).get(`/api/v1/properties/${propertyId}/board`).set(auth());
      expect(res.status).toBe(404);
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "propertyBoard"));
    }
  });
});

async function wipeSeg4() {
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
      await tx.execute(sql`DELETE FROM client_prediction_log WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_outbox WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_turn_metrics_mv WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_scope_lines WHERE scope_id IN (
        SELECT id FROM client_scopes WHERE turn_id IN (
          SELECT id FROM client_turns WHERE property_id IN (${inProps})))`);
      await tx.execute(sql`DELETE FROM client_scopes WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turn_stage_events WHERE turn_id IN (
        SELECT id FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_audit_log WHERE entity_id IN (
        SELECT id::text FROM client_turns WHERE property_id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (
        SELECT client_org_id FROM properties WHERE id IN (${inProps}))`);
      await tx.execute(sql`DELETE FROM client_turns WHERE property_id IN (${inProps})`);
      await tx.execute(sql`DELETE FROM client_units WHERE property_id IN (${inProps})`);
      await tx.execute(
        sql`DELETE FROM client_portfolio_properties WHERE property_id IN (${inProps})`,
      );
      await tx.delete(propertiesTable).where(eq(propertiesTable.brief, BRIEF));
    }
    if (orgIds.length > 0) {
      const inOrgs = sql.join(
        orgIds.map((id) => sql`${id}`),
        sql`, `,
      );
      await tx.execute(sql`DELETE FROM client_idempotency_keys WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_portfolios WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_org_members WHERE org_id IN (${inOrgs})`);
      await tx.execute(sql`DELETE FROM client_orgs WHERE id IN (${inOrgs})`);
    }
  });
}
