/**
 * Regression: crew day-route ordering & dedupe rules.
 *
 * The office day-route planner (GET/PUT /crews/:id/day-plan/:day) orders each
 * crew's stops — saved plan order first, then chronologically from free-text
 * time windows — and the crew portal schedule feed must mirror that order.
 * A regression here silently sends crews to stops in the wrong sequence.
 *
 * Covered:
 *   - default chronological order from free-text windows ("9:00 AM" vs "1:00 PM")
 *   - calendar event pointing at an already-scheduled job is deduped
 *   - saved order applied first, unplanned stops after by time
 *   - unknown/stale stop keys filtered out on save
 *   - the crew portal feed matches the office's saved order
 *
 * Seeds throwaway rows in the dev database and hits the real express app
 * (like waybillContract.test.ts). Office endpoints are passcode-gated, so the
 * test mints a valid office session cookie with SESSION_SECRET.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  crewsTable,
  jobsTable,
  propertiesTable,
  schedulesTable,
  calendarEventsTable,
  crewRoutePlansTable,
} from "@workspace/db";
import app from "../app";

// Mint a signed office session cookie (same scheme as lib/officeAuth.ts:
// "office.<expiry>.<nonce>.<hmac>" signed with SESSION_SECRET).
function officeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

// The portal schedule feed only spans the current week, so seed for local today.
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const COOKIE = officeCookie();
const day = localToday();
const portalToken = `route-test-${randomUUID()}`;

let propertyId = "";
let crewId = "";
let job1 = ""; // scheduled 1:00 PM
let job2 = ""; // scheduled 9:00 AM
let sched1 = "";
let sched2 = "";
let dupEventId = ""; // calendar event for already-scheduled job1 → deduped
let soloEventId = ""; // standalone event, 07:30 → earliest stop
let soloKey = "";

async function getDayPlan() {
  const res = await request(app)
    .get(`/api/crews/${crewId}/day-plan/${day}`)
    .set("Cookie", COOKIE);
  expect(res.status).toBe(200);
  return res.body.stops as { key: string; planned: boolean; jobId: string | null }[];
}

describe("crew day-route ordering & portal mirror", () => {
  beforeAll(async () => {
    const [prop] = await db
      .insert(propertiesTable)
      .values({ name: `Route Test Property ${Date.now()}` })
      .returning();
    propertyId = prop!.id;
    const [crew] = await db
      .insert(crewsTable)
      .values({ name: `Route Test Crew ${Date.now()}`, portalToken })
      .returning();
    crewId = crew!.id;
    const mkJob = async (suffix: string) => {
      const [j] = await db
        .insert(jobsTable)
        .values({
          jobNo: `RT-${Date.now()}-${suffix}`,
          propertyId,
          description: `route order regression ${suffix}`,
          crewLeaderId: crewId,
          scheduledOn: day,
        })
        .returning();
      return j!.id;
    };
    job1 = await mkJob("afternoon");
    job2 = await mkJob("morning");
    const [s1] = await db
      .insert(schedulesTable)
      .values({ jobId: job1, scheduledOn: day, windowStart: "1:00 PM", crewLeaderId: crewId })
      .returning();
    sched1 = s1!.id;
    const [s2] = await db
      .insert(schedulesTable)
      .values({ jobId: job2, scheduledOn: day, windowStart: "9:00 AM", crewLeaderId: crewId })
      .returning();
    sched2 = s2!.id;
    const [dup] = await db
      .insert(calendarEventsTable)
      .values({
        title: "Duplicate of scheduled job",
        eventDate: day,
        startTime: "15:00",
        jobId: job1,
        crewId,
      })
      .returning();
    dupEventId = dup!.id;
    const [solo] = await db
      .insert(calendarEventsTable)
      .values({
        title: "Supply pickup",
        eventDate: day,
        startTime: "07:30",
        crewId,
      })
      .returning();
    soloEventId = solo!.id;
    soloKey = `event-${soloEventId}`;
  });

  afterAll(async () => {
    if (crewId) {
      await db.delete(crewRoutePlansTable).where(eq(crewRoutePlansTable.crewId, crewId));
      await db
        .delete(calendarEventsTable)
        .where(inArray(calendarEventsTable.id, [dupEventId, soloEventId].filter(Boolean)));
      await db
        .delete(schedulesTable)
        .where(inArray(schedulesTable.id, [sched1, sched2].filter(Boolean)));
      await db.delete(jobsTable).where(inArray(jobsTable.id, [job1, job2].filter(Boolean)));
      await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
      await db.delete(crewsTable).where(eq(crewsTable.id, crewId));
    }
  });

  it("orders stops chronologically from free-text time windows by default", async () => {
    const stops = await getDayPlan();
    expect(stops.map((s) => s.key)).toEqual([soloKey, sched2, sched1]); // 7:30, 9:00 AM, 1:00 PM
    expect(stops.every((s) => s.planned === false)).toBe(true);
  });

  it("dedupes a calendar event that points at an already-scheduled job", async () => {
    const stops = await getDayPlan();
    expect(stops.map((s) => s.key)).not.toContain(`event-${dupEventId}`);
    expect(stops.filter((s) => s.jobId === job1)).toHaveLength(1);
  });

  it("filters unknown/stale stop keys on save and applies saved order first", async () => {
    const res = await request(app)
      .put(`/api/crews/${crewId}/day-plan/${day}`)
      .set("Cookie", COOKIE)
      .send({
        day,
        // deliberately reversed vs. chronological, plus junk/stale keys;
        // sched2 left out to become an unplanned trailing stop
        stopKeys: [sched1, "not-a-real-key", soloKey, `event-${dupEventId}`],
      });
    expect(res.status).toBe(200);
    const stops = res.body.stops as { key: string; planned: boolean }[];
    expect(stops.map((s) => s.key)).toEqual([sched1, soloKey, sched2]);
    expect(stops.map((s) => s.planned)).toEqual([true, true, false]);

    // Junk and deduped-event keys must not be stored in the plan row.
    const [plan] = await db
      .select()
      .from(crewRoutePlansTable)
      .where(eq(crewRoutePlansTable.crewId, crewId));
    expect(plan?.stopKeys).toEqual([sched1, soloKey]);

    // Re-reading the plan applies the saved order first, rest by time.
    const again = await getDayPlan();
    expect(again.map((s) => s.key)).toEqual([sched1, soloKey, sched2]);
  });

  it("crew portal schedule feed mirrors the office's saved order", async () => {
    const res = await request(app).get(`/api/portal/${portalToken}`);
    expect(res.status).toBe(200);
    const todays = (res.body.schedule as { id: string; scheduledOn: string | null }[]).filter(
      (s) => s.scheduledOn === day,
    );
    expect(todays.map((s) => s.id)).toEqual([sched1, soloKey, sched2]);
  });
});
