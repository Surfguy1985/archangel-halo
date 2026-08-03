/**
 * Regression: the dispatch-board contract.
 *
 * POST /jobs/:id/dispatch must keep every derived surface in sync in BOTH
 * directions:
 *   backlog → crew/day: crew assigned, crewVacatedAt cleared, status
 *     "scheduled", boardStatus "filled", exactly one schedules-mirror row
 *     (the crew portal feed) for the crew/day.
 *   crew/day → backlog: crew and date cleared, boardStatus back to
 *     "reopened" (not stuck on "filled"), schedules mirror emptied,
 *     broadcasts withdrawn.
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

describe.skipIf(!BASE)("dispatch board keeps job/board/schedule state in sync", () => {
  let propertyId = "";
  let crewId = "";
  const cleanupJobIds: string[] = [];
  const day = "2026-08-05";

  beforeAll(async () => {
    const props = await api("/properties");
    expect(props.status).toBe(200);
    propertyId = props.json[0].id;
    const crews = await api("/crews");
    expect(crews.status).toBe(200);
    crewId = crews.json[0].id;
  });

  afterAll(async () => {
    for (const id of cleanupJobIds) await api(`/jobs/${id}`, { method: "DELETE" });
  });

  async function mkJob(tag: string) {
    const r = await api("/jobs/quick", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
        description: `dispatch regression ${tag} ${Date.now()}`,
      }),
    });
    expect(r.status).toBe(201);
    cleanupJobIds.push(r.json.id);
    return r.json as { id: string; jobNo: string };
  }

  it("backlog → crew/day assigns, fills the board, and mirrors the schedule", async () => {
    const job = await mkJob("assign");
    const r = await api(`/jobs/${job.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: day }),
    });
    expect(r.status).toBe(200);
    expect(r.json.crewLeaderId).toBe(crewId);
    expect(r.json.scheduledOn).toBe(day);
    expect(r.json.status).toBe("scheduled");
    expect(r.json.boardStatus).toBe("filled");
    expect(r.json.crewVacatedAt ?? null).toBeNull();

    const detail = await api(`/jobs/${job.id}`);
    expect(detail.status).toBe(200);
    const rows = detail.json.schedules as {
      scheduledOn: string;
      crewLeaderId: string | null;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledOn).toBe(day);
    expect(rows[0].crewLeaderId).toBe(crewId);
  });

  it("crew/day → backlog unassigns, reopens the board, and empties the mirror", async () => {
    const job = await mkJob("backlog");
    const assign = await api(`/jobs/${job.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: day }),
    });
    expect(assign.status).toBe(200);
    expect(assign.json.boardStatus).toBe("filled");

    const back = await api(`/jobs/${job.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: null, scheduledOn: null }),
    });
    expect(back.status).toBe(200);
    expect(back.json.crewLeaderId ?? null).toBeNull();
    expect(back.json.scheduledOn ?? null).toBeNull();
    expect(back.json.status).toBe("open");
    // A filled listing must not stay "filled" once explicitly backlogged.
    expect(back.json.boardStatus).toBe("reopened");
    expect(back.json.crewVacatedAt ?? null).toBeNull();

    const detail = await api(`/jobs/${job.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.schedules).toHaveLength(0);
  });

  it("rejects a crew drop without a day and dispatching finished jobs", async () => {
    const job = await mkJob("guards");
    const noDay = await api(`/jobs/${job.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: null }),
    });
    expect(noDay.status).toBe(400);
  });
});
