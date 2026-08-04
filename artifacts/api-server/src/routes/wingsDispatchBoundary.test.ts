/**
 * Regression: cross-crew isolation of the Founding Wings and member-dispatch
 * portal feeds.
 *
 * The home feed, office-view, and the messages/photos/documents/invoices/
 * earnings sub-endpoints already have boundary suites; this one locks:
 *
 *   GET /portal/:token/wings     (pay overrides w/ dollar amounts, reserve
 *                                 balances, recruit roster)
 *   GET /portal/:token/dispatch  (per-member day assignments + team view)
 *
 * Setup mirrors portalSubBoundary.integration.test.ts: two crews, rows seeded
 * for crew A only — a wing override with real dollar amounts (sponsor A,
 * recruit R), a reserve account with balances, a recruit membership, and a
 * member-dispatch assignment for today. Crew B's token must return NONE of
 * crew A's rows — not by id, not by content, not as reflected totals.
 *
 * Wing overrides/reserve rows have no office write endpoints (they're created
 * by the settlement engine), so this suite seeds throwaway rows directly in
 * the dev database and hits the real express app via supertest (same pattern
 * as crewRoutePlan.test.ts).
 */
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  crewsTable,
  jobsTable,
  propertiesTable,
  wingMembersTable,
  wingOverridesTable,
  wingReserveAccountsTable,
  crewDispatchAssignmentsTable,
} from "@workspace/db";
import app from "../app";

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const nonce = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const day = localToday();
const tokenA = `wings-boundary-a-${randomUUID()}`;
const tokenB = `wings-boundary-b-${randomUUID()}`;

// Distinctive seeded values: none of these may surface on crew B's token.
const OVERRIDE_GROSS = 777.77;
const OVERRIDE_IMMEDIATE = 388.88;
const OVERRIDE_RESERVE = 155.55;
const RESERVE_HELD = 421.42;
const RESERVE_RELEASED = 88.25;
const RESERVE_DEBITED = 13.5;
const CHECKLIST_TEXT = `private scope item ${nonce}`;

let propertyId = "";
let crewAId = "";
let crewBId = "";
let recruitId = ""; // crew sponsored by A — appears in A's recruit roster
let jobId = "";
let dispatchJobId = "";
let overrideId = "";
let memberIdsToClean: string[] = [];
let reserveAccountId = "";
let assignmentId = "";

async function portal(path: string) {
  const res = await request(app).get(`/api/portal/${path}`);
  return { status: res.status, json: res.body };
}

describe("wings & member-dispatch cross-crew boundary", () => {
  beforeAll(async () => {
    const [prop] = await db
      .insert(propertiesTable)
      .values({ name: `Wings Boundary Property ${nonce}` })
      .returning();
    propertyId = prop!.id;

    const mkCrew = async (tag: string, token?: string) => {
      const [c] = await db
        .insert(crewsTable)
        .values({ name: `Wings Boundary ${tag} ${nonce}`, portalToken: token })
        .returning();
      return c!.id;
    };
    crewAId = await mkCrew("A", tokenA);
    crewBId = await mkCrew("B", tokenB);
    recruitId = await mkCrew("Recruit");

    const mkJob = async (suffix: string) => {
      const [j] = await db
        .insert(jobsTable)
        .values({
          jobNo: `WB-${Date.now()}-${suffix}`,
          propertyId,
          description: `wings boundary ${suffix} ${nonce}`,
        })
        .returning();
      return j!.id;
    };
    jobId = await mkJob("override");
    dispatchJobId = await mkJob("dispatch");

    // Wing memberships: A is a member; Recruit is sponsored by A.
    const members = await db
      .insert(wingMembersTable)
      .values([
        { crewId: crewAId, haloScore: 91, tier: "CERTIFIED" },
        { crewId: recruitId, sponsorCrewId: crewAId, haloScore: 87, tier: "TRAINING" },
      ])
      .returning();
    memberIdsToClean = members.map((m) => m.id);

    // Crew A's pay override (sponsor A ← recruit R) with dollar amounts.
    const [ov] = await db
      .insert(wingOverridesTable)
      .values({
        jobId,
        sponsorCrewId: crewAId,
        recruitCrewId: recruitId,
        allocatedGrossProfit: 3111.08,
        baseRate: 0.25,
        qualityMultiplier: 1,
        grossOverride: OVERRIDE_GROSS,
        immediateAmount: OVERRIDE_IMMEDIATE,
        reserveAmount: OVERRIDE_RESERVE,
        status: "HELD",
        immediateStatus: "READY",
      })
      .returning();
    overrideId = ov!.id;

    // Crew A's reserve account with non-zero balances.
    const [acct] = await db
      .insert(wingReserveAccountsTable)
      .values({
        crewId: crewAId,
        heldBalance: RESERVE_HELD,
        releasedBalance: RESERVE_RELEASED,
        debitedBalance: RESERVE_DEBITED,
      })
      .returning();
    reserveAccountId = acct!.id;

    // Crew A's member-dispatch assignment for today.
    const [asg] = await db
      .insert(crewDispatchAssignmentsTable)
      .values({
        day,
        jobId: dispatchJobId,
        memberId: crewAId,
        status: "assigned",
        checklist: [{ id: randomUUID(), text: CHECKLIST_TEXT, done: false }],
      })
      .returning();
    assignmentId = asg!.id;
  });

  afterAll(async () => {
    if (assignmentId)
      await db
        .delete(crewDispatchAssignmentsTable)
        .where(eq(crewDispatchAssignmentsTable.id, assignmentId));
    if (reserveAccountId)
      await db
        .delete(wingReserveAccountsTable)
        .where(eq(wingReserveAccountsTable.id, reserveAccountId));
    if (overrideId)
      await db.delete(wingOverridesTable).where(eq(wingOverridesTable.id, overrideId));
    if (memberIdsToClean.length)
      await db
        .delete(wingMembersTable)
        .where(inArray(wingMembersTable.id, memberIdsToClean));
    await db
      .delete(jobsTable)
      .where(inArray(jobsTable.id, [jobId, dispatchJobId].filter(Boolean)));
    await db
      .delete(crewsTable)
      .where(
        inArray(crewsTable.id, [crewAId, crewBId, recruitId].filter(Boolean)),
      );
    if (propertyId)
      await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  });

  it("crew A actually sees its own wings data (the seed is real)", async () => {
    const r = await portal(`${tokenA}/wings`);
    expect(r.status).toBe(200);
    expect(r.json.overrides.some((o: any) => o.id === overrideId)).toBe(true);
    const ov = r.json.overrides.find((o: any) => o.id === overrideId);
    expect(ov.grossOverride).toBe(OVERRIDE_GROSS);
    expect(ov.immediateAmount).toBe(OVERRIDE_IMMEDIATE);
    expect(ov.reserveAmount).toBe(OVERRIDE_RESERVE);
    expect(r.json.recruits.length).toBeGreaterThan(0);
    expect(
      r.json.recruits.some((rc: any) => rc.crewName.includes(nonce)),
    ).toBe(true);
    expect(r.json.reserve).toEqual({
      held: RESERVE_HELD,
      released: RESERVE_RELEASED,
      debited: RESERVE_DEBITED,
    });
  });

  it("crew B's token returns none of crew A's wing overrides", async () => {
    const r = await portal(`${tokenB}/wings`);
    expect(r.status).toBe(200);
    expect(r.json.overrides.some((o: any) => o.id === overrideId)).toBe(false);
    expect(
      r.json.overrides.some(
        (o: any) =>
          o.sponsorCrewId === crewAId ||
          o.recruitCrewId === recruitId ||
          o.grossOverride === OVERRIDE_GROSS,
      ),
    ).toBe(false);
    // Amount-level check: A's dollar figures must not surface anywhere.
    const body = JSON.stringify(r.json);
    expect(body).not.toContain(String(OVERRIDE_GROSS));
    expect(body).not.toContain(String(OVERRIDE_IMMEDIATE));
    expect(body).not.toContain(String(OVERRIDE_RESERVE));
  });

  it("crew B's token returns none of crew A's reserve balances", async () => {
    const r = await portal(`${tokenB}/wings`);
    expect(r.status).toBe(200);
    // Crew B has no reserve account — all balances must be exactly zero, so
    // no amount from A's account can be reflected here.
    expect(r.json.reserve).toEqual({ held: 0, released: 0, debited: 0 });
  });

  it("crew B's token returns none of crew A's recruit roster", async () => {
    const r = await portal(`${tokenB}/wings`);
    expect(r.status).toBe(200);
    expect(r.json.recruits).toEqual([]);
    // A's recruit's name (nonce-tagged) must not surface anywhere, including
    // as a sponsorName on B's own membership.
    expect(JSON.stringify(r.json)).not.toContain(nonce);
  });

  it("crew B's token returns none of crew A's member-dispatch assignments", async () => {
    const r = await portal(`${tokenB}/dispatch`);
    expect(r.status).toBe(200);
    expect(r.json.assignments).toEqual([]);
    expect(r.json.team).toBeNull();
    // Content-level: neither the assignment id nor A's private checklist text
    // may surface.
    const body = JSON.stringify(r.json);
    expect(body).not.toContain(assignmentId);
    expect(body).not.toContain(nonce);
  });

  it("crew A's dispatch feed does contain the seeded assignment (control)", async () => {
    const r = await portal(`${tokenA}/dispatch`);
    expect(r.status).toBe(200);
    expect(r.json.assignments.some((a: any) => a.id === assignmentId)).toBe(true);
    const a = r.json.assignments.find((x: any) => x.id === assignmentId);
    expect(a.checklist.some((i: any) => i.text === CHECKLIST_TEXT)).toBe(true);
  });

  it("crew B can't check items on crew A's assignment by id (404, no leak)", async () => {
    const res = await request(app)
      .post(`/api/portal/${tokenB}/dispatch/${assignmentId}/check`)
      .send({ itemId: "whatever", done: true });
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain(nonce);
  });
});
