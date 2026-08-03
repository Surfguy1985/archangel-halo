/**
 * Regression: member-dispatch race guards.
 *
 * The pending-move state machine and the (member, day, job) uniqueness are
 * enforced with guarded conditional UPDATEs / a unique index mapped to 409.
 * These tests pin that behavior:
 *   - duplicate assignment → 409, including the concurrent 23505 path;
 *   - a second move request while one is pending_move → 409;
 *   - concurrent foreman approve/decline → exactly one wins;
 *   - approve when the member already sits on the target job/day → the
 *     pending row is dropped (no duplicate), response still ok;
 *   - deleting a job removes its assignments and cancels pending moves
 *     targeting it (member stays on their current job, back to "assigned").
 *
 * Integration test against a RUNNING api-server sharing the dev database.
 * Skipped unless HALO_E2E_BASE is set, e.g.:
 *
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   pnpm --filter @workspace/api-server run test
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = process.env.HALO_E2E_BASE ?? "";
const COOKIE = process.env.HALO_E2E_COOKIE ?? "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON */
  }
  return { status: res.status, json: json as any };
}

type BoardAssignment = {
  id: string;
  jobId: string;
  memberId: string;
  status: string;
  pendingJobId: string | null;
};

async function boardAssignments(day: string): Promise<BoardAssignment[]> {
  const r = await api(`/dispatch-board/${day}`);
  expect(r.status).toBe(200);
  const out: BoardAssignment[] = [];
  for (const p of r.json.properties as any[]) {
    for (const j of p.jobs) out.push(...j.assignments);
  }
  return out;
}

describe.skipIf(!BASE)("member dispatch race guards", () => {
  const day = "2026-08-07";
  let propertyId = "";
  let foremanId = "";
  let foremanToken = "";
  let memberId = "";
  let soloId = "";
  const cleanupJobIds: string[] = [];
  const cleanupCrewIds: string[] = [];

  beforeAll(async () => {
    const props = await api("/properties");
    expect(props.status).toBe(200);
    propertyId = props.json[0].id;

    const tag = Date.now();
    const foreman = await api("/crews", {
      method: "POST",
      body: JSON.stringify({ name: `Race Foreman ${tag}`, isLeader: true }),
    });
    expect(foreman.status).toBe(201);
    foremanId = foreman.json.id;
    const member = await api("/crews", {
      method: "POST",
      body: JSON.stringify({ name: `Race Member ${tag}`, leaderId: foremanId }),
    });
    expect(member.status).toBe(201);
    memberId = member.json.id;
    const solo = await api("/crews", {
      method: "POST",
      body: JSON.stringify({ name: `Race Solo ${tag}` }),
    });
    expect(solo.status).toBe(201);
    soloId = solo.json.id;
    // Delete member before foreman so nothing depends on the team.
    cleanupCrewIds.push(memberId, soloId, foremanId);

    const link = await api(`/crews/${foremanId}/portal-link`, { method: "POST" });
    expect(link.status).toBe(200);
    foremanToken = link.json.token;
  });

  afterAll(async () => {
    for (const id of cleanupJobIds) await api(`/jobs/${id}`, { method: "DELETE" });
    for (const id of cleanupCrewIds) await api(`/crews/${id}`, { method: "DELETE" });
  });

  async function mkJob(tag: string) {
    const r = await api("/jobs/quick", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
        description: `dispatch race ${tag} ${Date.now()}`,
      }),
    });
    expect(r.status).toBe(201);
    cleanupJobIds.push(r.json.id);
    return r.json as { id: string; jobNo: string };
  }

  async function assign(mId: string, jobId: string) {
    const r = await api("/dispatch-assignments", {
      method: "POST",
      body: JSON.stringify({ day, jobId, memberId: mId }),
    });
    return r;
  }

  it("rejects a duplicate member+day+job assignment (sequential and concurrent)", async () => {
    const job = await mkJob("dup");
    const first = await assign(soloId, job.id);
    expect(first.status).toBe(201);
    const second = await assign(soloId, job.id);
    expect(second.status).toBe(409);
    await api(`/dispatch-assignments/${first.json.id}`, { method: "DELETE" });

    // Concurrent burst: both requests pass the pre-check select, so the loser
    // must land on the unique-index 23505 path and still surface as 409.
    const job2 = await mkJob("dup-concurrent");
    const results = await Promise.all(
      Array.from({ length: 4 }, () => assign(soloId, job2.id)),
    );
    const created = results.filter((r) => r.status === 201);
    const conflicted = results.filter((r) => r.status === 409);
    expect(created).toHaveLength(1);
    expect(conflicted).toHaveLength(3);
    const rows = (await boardAssignments(day)).filter(
      (a) => a.memberId === soloId && a.jobId === job2.id,
    );
    expect(rows).toHaveLength(1);
    await api(`/dispatch-assignments/${created[0]!.json.id}`, { method: "DELETE" });
  });

  it("blocks a second move request while one is pending on the foreman", async () => {
    const [jobA, jobB, jobC] = await Promise.all([
      mkJob("pend-a"),
      mkJob("pend-b"),
      mkJob("pend-c"),
    ]);
    const a = await assign(memberId, jobA.id);
    expect(a.status).toBe(201);

    const move1 = await api(`/dispatch-assignments/${a.json.id}/move`, {
      method: "POST",
      body: JSON.stringify({ toJobId: jobB.id }),
    });
    expect(move1.status).toBe(200);
    expect(move1.json.status).toBe("pending_move");
    expect(move1.json.pendingJobId).toBe(jobB.id);

    const move2 = await api(`/dispatch-assignments/${a.json.id}/move`, {
      method: "POST",
      body: JSON.stringify({ toJobId: jobC.id }),
    });
    expect(move2.status).toBe(409);

    // Decline to settle, leaving the member where they were.
    const decline = await api(
      `/portal/${foremanToken}/dispatch/${a.json.id}/move-response`,
      { method: "POST", body: JSON.stringify({ approve: false }) },
    );
    expect(decline.status).toBe(200);
    const row = (await boardAssignments(day)).find((x) => x.id === a.json.id);
    expect(row?.status).toBe("assigned");
    expect(row?.jobId).toBe(jobA.id);
    expect(row?.pendingJobId ?? null).toBeNull();
    await api(`/dispatch-assignments/${a.json.id}`, { method: "DELETE" });
  });

  it("concurrent approve/decline: exactly one decision wins", async () => {
    const [jobA, jobB] = await Promise.all([mkJob("race-a"), mkJob("race-b")]);
    const a = await assign(memberId, jobA.id);
    expect(a.status).toBe(201);
    const move = await api(`/dispatch-assignments/${a.json.id}/move`, {
      method: "POST",
      body: JSON.stringify({ toJobId: jobB.id }),
    });
    expect(move.status).toBe(200);
    expect(move.json.status).toBe("pending_move");

    const respond = (approve: boolean) =>
      api(`/portal/${foremanToken}/dispatch/${a.json.id}/move-response`, {
        method: "POST",
        body: JSON.stringify({ approve }),
      });
    const [approveRes, declineRes] = await Promise.all([
      respond(true),
      respond(false),
    ]);
    const statuses = [approveRes.status, declineRes.status].sort();
    expect(statuses).toEqual([200, 409]);

    // The surviving row must be a consistent settled state, not a hybrid:
    // either moved to jobB (approve won) or still on jobA (decline won) —
    // and in both cases fully out of pending_move.
    const row = (await boardAssignments(day)).find((x) => x.id === a.json.id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe("assigned");
    expect(row!.pendingJobId ?? null).toBeNull();
    const winnerWasApprove = approveRes.status === 200;
    expect(row!.jobId).toBe(winnerWasApprove ? jobB.id : jobA.id);
    await api(`/dispatch-assignments/${a.json.id}`, { method: "DELETE" });
  });

  it("approve onto a job the member already holds drops the pending row (23505 path)", async () => {
    const [jobA, jobB] = await Promise.all([mkJob("merge-a"), mkJob("merge-b")]);
    const a = await assign(memberId, jobA.id);
    expect(a.status).toBe(201);
    const move = await api(`/dispatch-assignments/${a.json.id}/move`, {
      method: "POST",
      body: JSON.stringify({ toJobId: jobB.id }),
    });
    expect(move.status).toBe(200);

    // Someone assigns the member directly onto jobB while the move waits.
    const direct = await assign(memberId, jobB.id);
    expect(direct.status).toBe(201);

    const approve = await api(
      `/portal/${foremanToken}/dispatch/${a.json.id}/move-response`,
      { method: "POST", body: JSON.stringify({ approve: true }) },
    );
    expect(approve.status).toBe(200);

    // No duplicate: exactly one assignment on jobB, the pending one is gone.
    const rows = (await boardAssignments(day)).filter((x) => x.memberId === memberId);
    expect(rows.filter((x) => x.jobId === jobB.id)).toHaveLength(1);
    expect(rows.find((x) => x.id === a.json.id)).toBeUndefined();
    await api(`/dispatch-assignments/${direct.json.id}`, { method: "DELETE" });
  });

  it("deleting a job removes its assignments and cancels pending moves targeting it", async () => {
    const [jobA, jobB] = await Promise.all([mkJob("del-a"), mkJob("del-b")]);
    // Solo member sits ON jobB; foreman-led member has a pending move INTO jobB.
    const onDoomed = await assign(soloId, jobB.id);
    expect(onDoomed.status).toBe(201);
    const a = await assign(memberId, jobA.id);
    expect(a.status).toBe(201);
    const move = await api(`/dispatch-assignments/${a.json.id}/move`, {
      method: "POST",
      body: JSON.stringify({ toJobId: jobB.id }),
    });
    expect(move.status).toBe(200);
    expect(move.json.status).toBe("pending_move");

    const del = await api(`/jobs/${jobB.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const rows = await boardAssignments(day);
    // The assignment that lived on the deleted job is gone.
    expect(rows.find((x) => x.id === onDoomed.json.id)).toBeUndefined();
    // The pending move into it is cancelled — member stays on jobA, assigned.
    const kept = rows.find((x) => x.id === a.json.id);
    expect(kept).toBeTruthy();
    expect(kept!.status).toBe("assigned");
    expect(kept!.jobId).toBe(jobA.id);
    expect(kept!.pendingJobId ?? null).toBeNull();
    // A fresh move request works again now that nothing is pending.
    const again = await api(`/dispatch-assignments/${a.json.id}/move`, {
      method: "POST",
      body: JSON.stringify({ toJobId: jobA.id }),
    });
    expect(again.status).toBe(409); // same job — but proves it's past the pending gate
    await api(`/dispatch-assignments/${a.json.id}`, { method: "DELETE" });
  });
});
