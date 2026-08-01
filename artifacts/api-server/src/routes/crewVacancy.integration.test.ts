/**
 * Regression: the crew-vacancy contract.
 *
 * Every server path that (re)assigns jobs.crewLeaderId must also clear
 * crewVacatedAt, or the Today feed keeps a phantom "Job X lost its crew"
 * alert for a job that is fully staffed.
 *
 * This is an integration test against a RUNNING api-server sharing the dev
 * database. It is skipped unless HALO_E2E_BASE is set, e.g.:
 *
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" pnpm --filter @workspace/api-server run test
 *
 * Flow, per assignment path (PATCH /jobs/:id, /jobs/:id/schedule,
 * /voice/confirm schedule_job, and the pull-crew target itself):
 *   create jobs A+B → assign crew to B → pull-crew B→A (B becomes vacated,
 *   Today feed shows "lost its crew") → restaff B via the path under test →
 *   assert the vacated feed item for B is gone.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE = process.env.HALO_E2E_BASE ?? "";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
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

async function vacatedFeedIds(): Promise<string[]> {
  const { json } = await api("/today");
  return (json.feed as { id: string }[])
    .map((f) => f.id)
    .filter((id) => id.startsWith("vacated-"));
}

describe.skipIf(!BASE)("crew vacancy flag clears on every assignment path", () => {
  let propertyId = "";
  let crewId = "";
  const cleanupJobIds: string[] = [];

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

  /** create A+B, staff B, pull B's crew onto A; returns ids with B vacated */
  async function setupVacated(tag: string) {
    const mk = async (suffix: string) => {
      const r = await api("/jobs/quick", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          description: `vacancy regression ${tag} ${suffix} ${Date.now()}`,
        }),
      });
      expect(r.status).toBe(201);
      cleanupJobIds.push(r.json.id);
      return r.json as { id: string; jobNo: string };
    };
    const a = await mk("target");
    const b = await mk("source");
    const assign = await api(`/jobs/${b.id}`, {
      method: "PATCH",
      body: JSON.stringify({ crewLeaderId: crewId }),
    });
    expect(assign.status).toBe(200);
    const pull = await api(`/jobs/${a.id}/pull-crew`, {
      method: "POST",
      body: JSON.stringify({ crewId, fromJobId: b.id }),
    });
    expect(pull.status).toBe(200);
    expect(await vacatedFeedIds()).toContain(`vacated-${b.id}`);
    return { a, b };
  }

  it("pull-crew target job never carries the flag", async () => {
    const { a } = await setupVacated("target");
    expect(await vacatedFeedIds()).not.toContain(`vacated-${a.id}`);
  });

  it("restaff via PATCH /jobs/:id clears the flag", async () => {
    const { b } = await setupVacated("patch");
    const r = await api(`/jobs/${b.id}`, {
      method: "PATCH",
      body: JSON.stringify({ crewLeaderId: crewId }),
    });
    expect(r.status).toBe(200);
    expect(await vacatedFeedIds()).not.toContain(`vacated-${b.id}`);
  });

  it("restaff via POST /jobs/:id/schedule clears the flag", async () => {
    const { b } = await setupVacated("schedule");
    const r = await api(`/jobs/${b.id}/schedule`, {
      method: "POST",
      body: JSON.stringify({ scheduledOn: "2026-08-03", crewLeaderId: crewId }),
    });
    expect(r.status).toBe(200);
    expect(await vacatedFeedIds()).not.toContain(`vacated-${b.id}`);
  });

  it("restaff via voice schedule_job clears the flag", async () => {
    const { b } = await setupVacated("voice");
    const crews = await api("/crews");
    const crewName = (crews.json as { id: string; name: string }[]).find(
      (c) => c.id === crewId,
    )!.name;
    const r = await api("/voice/confirm", {
      method: "POST",
      body: JSON.stringify({
        actions: [
          {
            tool: "schedule_job",
            title: "Schedule job",
            summary: "vacancy regression",
            confidence: 1,
            fields: { jobNo: b.jobNo, scheduledOn: "2026-08-04", crewName },
          },
        ],
      }),
    });
    expect(r.status).toBe(200);
    expect(r.json.applied).toBe(1);
    expect(await vacatedFeedIds()).not.toContain(`vacated-${b.id}`);
  });
});
