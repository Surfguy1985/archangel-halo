/**
 * Reminders endpoint contract tests.
 * Covers: create, list (active/snoozed/dismissed visibility), dismiss, snooze.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import request from "supertest";
import { createHmac, randomBytes } from "crypto";
import app from "../app";
import { db, remindersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ─── Office cookie (same scheme as lib/officeAuth.ts) ────────────────────────
function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}
const COOKIE = officeCookie();
const auth = () => ({ Cookie: COOKIE });

// Track IDs created during test for cleanup
const createdIds: string[] = [];

afterAll(async () => {
  if (createdIds.length) {
    for (const id of createdIds) {
      await db.delete(remindersTable).where(eq(remindersTable.id, id)).catch(() => {});
    }
  }
});

describe("POST /reminders", () => {
  it("rejects missing text", async () => {
    const res = await request(app).post("/api/reminders").set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it("rejects invalid remindAt", async () => {
    const res = await request(app).post("/api/reminders").set(auth()).send({ text: "Test", remindAt: "not-a-date" });
    expect(res.status).toBe(400);
  });

  it("creates a reminder without a remindAt", async () => {
    const res = await request(app).post("/api/reminders").set(auth()).send({ text: "Follow up on unit 101" });
    expect(res.status).toBe(201);
    expect(res.body.reminder.text).toBe("Follow up on unit 101");
    expect(res.body.reminder.remindAt).toBeNull();
    createdIds.push(res.body.reminder.id);
  });

  it("creates a reminder with a future remindAt", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await request(app).post("/api/reminders").set(auth()).send({ text: "Check on vendor", remindAt: future });
    expect(res.status).toBe(201);
    expect(res.body.reminder.remindAt).toBeTruthy();
    createdIds.push(res.body.reminder.id);
  });
});

describe("GET /reminders — snooze/dismiss visibility", () => {
  let activeId = "";
  let snoozedId = "";
  let dismissedId = "";

  beforeAll(async () => {
    // Insert directly so we control exact state
    const [active] = await db.insert(remindersTable).values({ text: "Active reminder", createdBy: "test" }).returning();
    activeId = active.id;
    createdIds.push(activeId);

    const snoozedUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
    const [snoozed] = await db.insert(remindersTable).values({ text: "Snoozed reminder", snoozedUntil, createdBy: "test" }).returning();
    snoozedId = snoozed.id;
    createdIds.push(snoozedId);

    const [dismissed] = await db.insert(remindersTable).values({ text: "Dismissed reminder", dismissedAt: new Date(), createdBy: "test" }).returning();
    dismissedId = dismissed.id;
    createdIds.push(dismissedId);
  });

  it("includes active reminder", async () => {
    const res = await request(app).get("/api/reminders").set(auth());
    expect(res.status).toBe(200);
    const ids = res.body.reminders.map((r: { id: string }) => r.id);
    expect(ids).toContain(activeId);
  });

  it("excludes currently-snoozed reminder", async () => {
    const res = await request(app).get("/api/reminders").set(auth());
    expect(res.status).toBe(200);
    const ids = res.body.reminders.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(snoozedId);
  });

  it("excludes dismissed reminder", async () => {
    const res = await request(app).get("/api/reminders").set(auth());
    expect(res.status).toBe(200);
    const ids = res.body.reminders.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(dismissedId);
  });

  it("re-appears after snooze expires (past snoozedUntil)", async () => {
    // Insert a reminder whose snoozedUntil is already in the past
    const pastSnooze = new Date(Date.now() - 1000);
    const [r] = await db.insert(remindersTable).values({ text: "Expired snooze", snoozedUntil: pastSnooze, createdBy: "test" }).returning();
    createdIds.push(r.id);

    const res = await request(app).get("/api/reminders").set(auth());
    expect(res.status).toBe(200);
    const ids = res.body.reminders.map((ri: { id: string }) => ri.id);
    expect(ids).toContain(r.id);
  });
});

describe("PATCH /reminders/:id", () => {
  let reminderId = "";

  beforeAll(async () => {
    const [r] = await db.insert(remindersTable).values({ text: "Patch test reminder", createdBy: "test" }).returning();
    reminderId = r.id;
    createdIds.push(reminderId);
  });

  it("rejects unknown action", async () => {
    const res = await request(app).patch(`/api/reminders/${reminderId}`).set(auth()).send({ action: "unknown" });
    expect(res.status).toBe(400);
  });

  it("snoozes a reminder — it disappears from list", async () => {
    const res = await request(app).patch(`/api/reminders/${reminderId}`).set(auth()).send({ action: "snooze", snoozeMinutes: 30 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.reminder.snoozedUntil).toBeTruthy();

    // Should no longer appear in the active list
    const list = await request(app).get("/api/reminders").set(auth());
    const ids = list.body.reminders.map((r: { id: string }) => r.id);
    expect(ids).not.toContain(reminderId);
  });

  it("dismisses a reminder — it disappears from list", async () => {
    const [r] = await db.insert(remindersTable).values({ text: "To dismiss", createdBy: "test" }).returning();
    createdIds.push(r.id);

    const res = await request(app).patch(`/api/reminders/${r.id}`).set(auth()).send({ action: "dismiss" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const list = await request(app).get("/api/reminders").set(auth());
    const ids = list.body.reminders.map((ri: { id: string }) => ri.id);
    expect(ids).not.toContain(r.id);
  });

  it("returns 404 for unknown id", async () => {
    const res = await request(app).patch("/api/reminders/00000000-0000-0000-0000-000000000000").set(auth()).send({ action: "dismiss" });
    expect(res.status).toBe(404);
  });
});
