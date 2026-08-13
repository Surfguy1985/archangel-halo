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

// ---------------------------------------------------------------------------
// Foreman team-view isolation
// ---------------------------------------------------------------------------
// Two foremen (A and B), each leading one member.  Foreman A's member has a
// pending_move assignment; foreman B's member has a normal assigned one.
//
// Invariants under test:
//   1. Each foreman sees only their OWN team (members + assignments).
//   2. Foreman B gets 403 when calling move-response on foreman A's member's
//      assignment (member.leaderId !== foremanB).
// ---------------------------------------------------------------------------
describe("foreman team-view cross-foreman boundary", () => {
  const fNonce = `${Date.now()}-${randomBytes(4).toString("hex")}-foreman`;
  const day = localToday();
  const tokenForemanA = `foreman-boundary-a-${randomUUID()}`;
  const tokenForemanB = `foreman-boundary-b-${randomUUID()}`;

  let fPropertyId = "";
  let foremanAId = "";
  let foremanBId = "";
  let memberAId = "";
  let memberBId = "";
  let jobAId = "";   // memberA's current job
  let jobA2Id = "";  // memberA's pending target job (for the move)
  let jobBId = "";   // memberB's job
  let assignmentAId = ""; // pending_move
  let assignmentBId = ""; // assigned

  const MEMBER_A_NOTE = `private-member-a-item ${fNonce}`;
  const MEMBER_B_NOTE = `private-member-b-item ${fNonce}`;

  beforeAll(async () => {
    const [prop] = await db
      .insert(propertiesTable)
      .values({ name: `Foreman Boundary Property ${fNonce}` })
      .returning();
    fPropertyId = prop!.id;

    const mkJob = async (suffix: string) => {
      const [j] = await db
        .insert(jobsTable)
        .values({
          jobNo: `FB-${Date.now()}-${suffix}`,
          propertyId: fPropertyId,
          description: `foreman boundary ${suffix} ${fNonce}`,
        })
        .returning();
      return j!.id;
    };
    jobAId = await mkJob("aMain");
    jobA2Id = await mkJob("aPending");
    jobBId = await mkJob("b");

    // Insert the four crew rows.
    const [fa] = await db
      .insert(crewsTable)
      .values({
        name: `Foreman A ${fNonce}`,
        portalToken: tokenForemanA,
        isLeader: true,
      })
      .returning();
    foremanAId = fa!.id;

    const [fb] = await db
      .insert(crewsTable)
      .values({
        name: `Foreman B ${fNonce}`,
        portalToken: tokenForemanB,
        isLeader: true,
      })
      .returning();
    foremanBId = fb!.id;

    const [ma] = await db
      .insert(crewsTable)
      .values({ name: `Member A ${fNonce}`, leaderId: foremanAId })
      .returning();
    memberAId = ma!.id;

    const [mb] = await db
      .insert(crewsTable)
      .values({ name: `Member B ${fNonce}`, leaderId: foremanBId })
      .returning();
    memberBId = mb!.id;

    // Foreman A's own leaderId must point to themselves so the members query
    // (WHERE leaderId = foremanAId) picks up only their real members.
    await db
      .update(crewsTable)
      .set({ leaderId: foremanAId })
      .where(eq(crewsTable.id, foremanAId));
    await db
      .update(crewsTable)
      .set({ leaderId: foremanBId })
      .where(eq(crewsTable.id, foremanBId));

    // Assignment for memberA: pending_move so pendingMoves list is populated.
    const [asgA] = await db
      .insert(crewDispatchAssignmentsTable)
      .values({
        day,
        jobId: jobAId,
        memberId: memberAId,
        status: "pending_move",
        pendingJobId: jobA2Id,
        moveRequestedAt: new Date(),
        checklist: [{ id: randomUUID(), text: MEMBER_A_NOTE, done: false }],
      })
      .returning();
    assignmentAId = asgA!.id;

    // Assignment for memberB: regular assigned.
    const [asgB] = await db
      .insert(crewDispatchAssignmentsTable)
      .values({
        day,
        jobId: jobBId,
        memberId: memberBId,
        status: "assigned",
        checklist: [{ id: randomUUID(), text: MEMBER_B_NOTE, done: false }],
      })
      .returning();
    assignmentBId = asgB!.id;
  });

  afterAll(async () => {
    if (assignmentAId)
      await db
        .delete(crewDispatchAssignmentsTable)
        .where(eq(crewDispatchAssignmentsTable.id, assignmentAId));
    if (assignmentBId)
      await db
        .delete(crewDispatchAssignmentsTable)
        .where(eq(crewDispatchAssignmentsTable.id, assignmentBId));
    await db
      .delete(crewsTable)
      .where(
        inArray(crewsTable.id, [foremanAId, foremanBId, memberAId, memberBId].filter(Boolean)),
      );
    await db
      .delete(jobsTable)
      .where(inArray(jobsTable.id, [jobAId, jobA2Id, jobBId].filter(Boolean)));
    if (fPropertyId)
      await db.delete(propertiesTable).where(eq(propertiesTable.id, fPropertyId));
  });

  it("foreman A sees their own team member and the pending move (control)", async () => {
    const r = await portal(`${tokenForemanA}/dispatch`);
    expect(r.status).toBe(200);
    expect(r.json.team).not.toBeNull();
    const memberIds = (r.json.team.members as any[]).map((m: any) => m.id);
    expect(memberIds).toContain(memberAId);
    expect(memberIds).not.toContain(memberBId);
    expect(r.json.team.pendingMoves.some((pm: any) => pm.assignmentId === assignmentAId)).toBe(true);
  });

  it("foreman B sees only their own team — none of foreman A's members or assignments", async () => {
    const r = await portal(`${tokenForemanB}/dispatch`);
    expect(r.status).toBe(200);
    expect(r.json.team).not.toBeNull();

    const memberIds = (r.json.team.members as any[]).map((m: any) => m.id);
    expect(memberIds).toContain(memberBId);
    expect(memberIds).not.toContain(memberAId);
    expect(memberIds).not.toContain(foremanAId);

    // Assignment A must not appear anywhere in the response body.
    const body = JSON.stringify(r.json);
    expect(body).not.toContain(assignmentAId);
    expect(body).not.toContain(MEMBER_A_NOTE);
    expect(body).not.toContain(`Member A`);
  });

  it("foreman B does not see foreman A's pending move in their pendingMoves list", async () => {
    const r = await portal(`${tokenForemanB}/dispatch`);
    expect(r.status).toBe(200);
    const pendingIds = (r.json.team?.pendingMoves ?? []).map((pm: any) => pm.assignmentId);
    expect(pendingIds).not.toContain(assignmentAId);
  });

  it("foreman B gets 403 trying to approve foreman A's member's pending move", async () => {
    const res = await request(app)
      .post(`/api/portal/${tokenForemanB}/dispatch/${assignmentAId}/move-response`)
      .send({ approve: true });
    expect(res.status).toBe(403);
    // Response must not leak the assignment's content.
    expect(JSON.stringify(res.body)).not.toContain(MEMBER_A_NOTE);
    expect(JSON.stringify(res.body)).not.toContain(fNonce);
  });

  it("foreman B gets 403 trying to decline foreman A's member's pending move", async () => {
    const res = await request(app)
      .post(`/api/portal/${tokenForemanB}/dispatch/${assignmentAId}/move-response`)
      .send({ approve: false });
    expect(res.status).toBe(403);
  });

  it("foreman A can still act on their own member's pending move (not blocked)", async () => {
    // Decline (approve:false) — safe because it resets the assignment back to
    // "assigned" rather than deleting or touching foreman B's data.
    const res = await request(app)
      .post(`/api/portal/${tokenForemanA}/dispatch/${assignmentAId}/move-response`)
      .send({ approve: false });
    // 200 = declined cleanly; 409 = already decided by a previous run — both
    // mean the ownership gate passed and foreman A was not refused.
    expect([200, 409]).toContain(res.status);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(404);
  });
});
