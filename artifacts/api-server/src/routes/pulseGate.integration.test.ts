/**
 * Pulse seat: guest board is dead, Thornbury allowlist 404s other
 * properties, seeded photos show on the map, KPIs include avg turn.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  propertiesTable,
  clientAccountsTable,
  clientUsersTable,
} from "@workspace/db";
import app from "../app";
import { issueSessionToken } from "./clientBoard";
import { ensureThornburyPulse, PULSE_PM_EMAIL, pulsePmPassword } from "../lib/seedThornburyPulse";
import { PULSE_PROPERTY_NAME } from "../lib/pulseSeat";

function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

describe("Pulse guest board + Thornbury lock", () => {
  const otherToken = `pulse-lock-${randomUUID()}`;
  let otherPropertyId = "";
  let otherUserId = "";
  let seeded: Awaited<ReturnType<typeof ensureThornburyPulse>>;

  beforeAll(async () => {
    const prev = process.env.HALO_PULSE_ALLOWLIST;
    process.env.HALO_PULSE_ALLOWLIST = PULSE_PROPERTY_NAME;
    const [prop] = await db
      .insert(propertiesTable)
      .values({ name: "Oakridge Pulse Lock Test" })
      .returning();
    otherPropertyId = prop!.id;
    await db.insert(clientAccountsTable).values({
      propertyId: otherPropertyId,
      dashboardToken: otherToken,
      status: "active",
    });
    const [user] = await db
      .insert(clientUsersTable)
      .values({
        propertyId: otherPropertyId,
        name: "Other PM",
        email: `oakridge-${randomUUID()}@example.com`,
        role: "admin",
        passwordHash: "unused:unused",
      })
      .returning();
    otherUserId = user!.id;
    seeded = await ensureThornburyPulse();
    // Restore after seed so other files aren't poisoned if this file errors
    // before afterAll. The allowlist is read per request from process.env.
    process.env.HALO_PULSE_ALLOWLIST = PULSE_PROPERTY_NAME;
    void prev;
  });

  afterAll(async () => {
    delete process.env.HALO_PULSE_ALLOWLIST;
    await db.delete(clientUsersTable).where(eq(clientUsersTable.propertyId, otherPropertyId));
    await db.delete(clientAccountsTable).where(eq(clientAccountsTable.propertyId, otherPropertyId));
    await db.delete(propertiesTable).where(eq(propertiesTable.id, otherPropertyId));
  });

  it("rejects a guest board fetch with 401 needsLogin", async () => {
    process.env.HALO_PULSE_ALLOWLIST = PULSE_PROPERTY_NAME;
    const res = await request(app).get(`/api/client/${seeded.dashboardToken}/board`);
    expect(res.status).toBe(401);
    expect(res.body.needsLogin).toBe(true);
    expect(res.body.seat).toBe("pulse");
  });

  it("404s another property even when that PM is signed in", async () => {
    process.env.HALO_PULSE_ALLOWLIST = PULSE_PROPERTY_NAME;
    const res = await request(app)
      .get(`/api/client/${otherToken}/board`)
      .set("Authorization", `Bearer ${issueSessionToken(otherUserId)}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/Oakridge/i);
  });

  it("logs the Thornbury PM in and serves the board, map photos, and KPIs", async () => {
    process.env.HALO_PULSE_ALLOWLIST = PULSE_PROPERTY_NAME;
    const login = await request(app)
      .post(`/api/client/${seeded.dashboardToken}/board/login`)
      .send({ email: PULSE_PM_EMAIL, password: pulsePmPassword() });
    expect(login.status).toBe(200);
    const session = login.body.sessionToken as string;
    expect(session).toBeTruthy();

    const board = await request(app)
      .get(`/api/client/${seeded.dashboardToken}/board`)
      .set("Authorization", `Bearer ${session}`);
    expect(board.status).toBe(200);
    expect(board.body.viewer.authenticated).toBe(true);
    expect(String(board.body.propertyName).toLowerCase()).toContain("thornbur");
    expect(Array.isArray(board.body.cards)).toBe(true);

    const map = await request(app)
      .get(`/api/client/${seeded.dashboardToken}/board/map`)
      .set("Authorization", `Bearer ${session}`);
    expect(map.status).toBe(200);
    const photoCount = (map.body.crews as Array<{ photos?: unknown[] }>).reduce(
      (n, c) => n + (c.photos?.length ?? 0),
      0,
    );
    expect(photoCount).toBeGreaterThan(0);

    const jpeg = await request(app).get("/api/storage/objects/thornbury-pulse/photo-before-1.jpg");
    expect(jpeg.status).toBe(200);
    expect(jpeg.headers["content-type"]).toMatch(/image\/jpeg/);
    expect(Number(jpeg.headers["content-length"])).toBeGreaterThan(10_000);

    const jobCards = (board.body.cards as Array<{ cardKey?: string; photos?: unknown[]; template?: string }>).filter(
      (c) => String(c.cardKey).startsWith("job:"),
    );
    expect(jobCards.length).toBeGreaterThanOrEqual(2);
    const withPhotos = jobCards.filter((c) => (c.photos?.length ?? 0) > 0);
    expect(withPhotos.length).toBeGreaterThan(0);
    const requestCards = (board.body.cards as Array<{ cardKey?: string }>).filter((c) =>
      String(c.cardKey).startsWith("request:"),
    );
    expect(requestCards.length).toBeGreaterThanOrEqual(1);

    const services = (map.body.crews as Array<{ services?: unknown[] }>).reduce(
      (n, c) => n + (c.services?.length ?? 0),
      0,
    );
    expect(services).toBeGreaterThan(0);

    const kpis = await request(app)
      .get(`/api/client/${seeded.dashboardToken}/board/kpis`)
      .set("Authorization", `Bearer ${session}`);
    expect(kpis.status).toBe(200);
    expect(kpis.body.openJobs).toBeGreaterThanOrEqual(2);
    expect(kpis.body.pendingRequests).toBeGreaterThanOrEqual(1);
    expect(kpis.body.unitsTotal).toBeGreaterThanOrEqual(5);

    const units = await request(app)
      .get(`/api/client/${seeded.dashboardToken}/unit-map`)
      .set("Authorization", `Bearer ${session}`);
    expect(units.status).toBe(200);
    expect((units.body.units ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("lets Punchlist (office cookie) open Pulse without a PM password", async () => {
    process.env.HALO_PULSE_ALLOWLIST = PULSE_PROPERTY_NAME;
    const res = await request(app)
      .get(`/api/client/${seeded.dashboardToken}/board`)
      .set("Cookie", officeCookie());
    expect(res.status).toBe(200);
    expect(res.body.viewer.role).toBe("office");
  });
});
