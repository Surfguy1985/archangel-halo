/**
 * Segment 5 — evidence ledger HTTP. 40-photo PDF <8s, verify fails on
 * mutated sha256, integrity copy, flag dark → 404.
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
  clientEvidenceItemsTable,
  clientGpsEventsTable,
  sha256Hex,
  zonedCivilToUtc,
} from "@workspace/db";
import app from "../app";
import { ensureClientBoardSchema } from "../lib/ensureClientBoardSchema";
import { createTurn, transitionTurn } from "../lib/turnEngine";
import { persistVerificationHash } from "../lib/turnEvidence";

const BRIEF = "CAF_CLIENT_BOARD_EVIDENCE_SEG5";
const SLUG = "caf-evidence-seg5";
const CHICAGO = "America/Chicago";
const UNIT_LAT = 32.7767;
const UNIT_LNG = -96.8089;

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

const ROOMS = [
  "living",
  "kitchen",
  "bed 1",
  "bed 2",
  "bed 3",
  "bath 1",
  "bath 2",
  "exterior",
  "patio",
  "other",
];
const PHASES = ["before", "during", "after", "qc"] as const;

describe("Property evidence ledger (HTTP)", () => {
  let orgId = "";
  let turnId = "";
  let livingBeforeId = "";

  beforeAll(async () => {
    await ensureClientBoardSchema();
    await wipeSeg5();

    const [org] = await db
      .insert(clientOrgsTable)
      .values({
        name: "CAF Evidence Seg5 Org",
        type: "pm_company",
        timezone: CHICAGO,
        slug: SLUG,
      })
      .onConflictDoUpdate({
        target: clientOrgsTable.slug,
        set: { name: "CAF Evidence Seg5 Org" },
      })
      .returning();
    orgId = org!.id;

    const [property] = await db
      .insert(propertiesTable)
      .values({
        name: "CAF Evidence — Paloma Creek",
        brief: BRIEF,
        timezone: CHICAGO,
        targetTurnDays: 7,
        clientOrgId: orgId,
        units: 1,
        status: "active",
        latitude: UNIT_LAT,
        longitude: UNIT_LNG,
      })
      .returning();
    const propertyId = property!.id;

    const [unit] = await db
      .insert(clientUnitsTable)
      .values({
        propertyId,
        unitNumber: "140",
        bedrooms: 2,
        bathrooms: "2.0",
        marketRentCents: 145000n,
        latitude: UNIT_LAT,
        longitude: UNIT_LNG,
      })
      .returning();

    const t0 = zonedCivilToUtc(CHICAGO, 2026, 7, 1, 8, 0, 0);
    const created = await createTurn({
      orgId,
      propertyId,
      unitId: unit!.id,
      source: "import",
      occurredAt: t0,
      actorId: "test:seg5",
      idempotencyKey: "seg5-create",
    });
    turnId = created.turnId;
    let at = t0;
    for (const to of ["vacated", "walk", "scoped"] as const) {
      at = new Date(at.getTime() + 3 * 3_600_000);
      await transitionTurn({
        orgId,
        turnId,
        to,
        source: "import",
        occurredAt: at,
        actorId: "test:seg5",
        idempotencyKey: `seg5-${to}`,
      });
    }

    const rows = [];
    for (const room of ROOMS) {
      for (const phase of PHASES) {
        const offset = room === "living" && phase === "before";
        const idSeed = `${room}:${phase}`;
        rows.push({
          turnId,
          unitId: unit!.id,
          kind: "photo",
          phase,
          room,
          storageKey: `seg5/${idSeed}.png`,
          sha256: sha256Hex(idSeed),
          mime: "image/png",
          bytes: 70n,
          deviceCapturedAt: at,
          serverReceivedAt: at,
          deviceLat: offset ? 32.778 : UNIT_LAT,
          deviceLng: UNIT_LNG,
          gpsAccuracyM: 8,
          exif: { Make: "Apple", Model: "iPhone 15" },
          capturedByUserId: "Maya Chen",
          integrityFlags: offset ? { gps_outside_geofence: true } : null,
        });
      }
    }
    const inserted = await db.insert(clientEvidenceItemsTable).values(rows).returning();
    livingBeforeId = inserted.find((r) => r.room === "living" && r.phase === "before")!.id;

    await db.insert(clientGpsEventsTable).values([
      {
        turnId,
        userId: "Maya Chen",
        type: "check_in",
        lat: UNIT_LAT,
        lng: UNIT_LNG,
        occurredAt: at,
        distanceFromUnitM: 4,
      },
      {
        turnId,
        userId: "Maya Chen",
        type: "trail",
        lat: UNIT_LAT + 0.0002,
        lng: UNIT_LNG + 0.0001,
        occurredAt: new Date(at.getTime() + 10 * 60_000),
        distanceFromUnitM: 22,
      },
      {
        turnId,
        userId: "Maya Chen",
        type: "check_out",
        lat: UNIT_LAT + 0.00005,
        lng: UNIT_LNG,
        occurredAt: new Date(at.getTime() + 40 * 60_000),
        distanceFromUnitM: 6,
      },
    ]);

    await persistVerificationHash(turnId, orgId);
  });

  afterAll(async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: true, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "evidence"));
    await wipeSeg5();
  });

  it("returns rooms in canonical order with integrity copy and a GPS trail", async () => {
    const res = await request(app).get(`/api/v1/turns/${turnId}/evidence`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.rooms.map((r: { room: string }) => r.room)).toEqual(ROOMS);
    const living = res.body.rooms[0] as {
      before: Array<{ integrityFlags: Array<{ explanation: string }>; capturedByName: string }>;
    };
    expect(living.before[0]!.capturedByName).toBe("Maya Chen");
    expect(living.before[0]!.integrityFlags[0]!.explanation).toMatch(/140m|from the unit/);
    expect(res.body.trail.checkIn).toBeTruthy();
    expect(res.body.trail.checkOut).toBeTruthy();
    expect(res.body.trail.geofence.radiusM).toBe(50);
    expect(res.body.rooms.reduce((n: number, r: { before: unknown[] }) => n + r.before.length, 0)).toBe(10);
  });

  it("renders a 40-photo unit turn record in under 8 seconds", async () => {
    const started = Date.now();
    const res = await request(app)
      .post(`/api/v1/turns/${turnId}/records`)
      .set(auth())
      .set("Idempotency-Key", "seg5-full-record")
      .send({ variant: "full" });
    const elapsed = Date.now() - started;
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.url).toMatch(/^\/api\/v1\/records\/[^/]+\/file\?/);
    expect(elapsed).toBeLessThan(8_000);

    const file = await request(app).get(res.body.url as string);
    expect(file.status).toBe(200);
    expect(String(file.headers["content-type"])).toMatch(/pdf/);

    const cut = await request(app)
      .post(`/api/v1/turns/${turnId}/records`)
      .set(auth())
      .set("Idempotency-Key", "seg5-move-out")
      .send({ variant: "move_out_condition" });
    expect(cut.status).toBe(200);
    expect(cut.body.status).toBe("ready");
    expect(cut.body.variant).toBe("move_out_condition");
  });

  it("verifies, then fails after one evidence sha256 is mutated", async () => {
    const ok = await request(app).get(`/api/v1/turns/${turnId}/verify`).set(auth());
    expect(ok.status).toBe(200);
    expect(ok.body.matches).toBe(true);
    expect(ok.body.evidenceCount).toBe(40);

    await db
      .update(clientEvidenceItemsTable)
      .set({ sha256: sha256Hex("mutated-row") })
      .where(eq(clientEvidenceItemsTable.id, livingBeforeId));

    const bad = await request(app).get(`/api/v1/turns/${turnId}/verify`).set(auth());
    expect(bad.status).toBe(200);
    expect(bad.body.matches).toBe(false);
    expect(bad.body.computedHash).not.toBe(bad.body.storedHash);
  });

  it("returns 404 when evidence is dark", async () => {
    await db
      .update(clientBoardFlagsTable)
      .set({ enabled: false, updatedAt: new Date() })
      .where(eq(clientBoardFlagsTable.segment, "evidence"));
    try {
      const res = await request(app).get(`/api/v1/turns/${turnId}/evidence`).set(auth());
      expect(res.status).toBe(404);
    } finally {
      await db
        .update(clientBoardFlagsTable)
        .set({ enabled: true, updatedAt: new Date() })
        .where(eq(clientBoardFlagsTable.segment, "evidence"));
    }
  });
});

async function wipeSeg5() {
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
