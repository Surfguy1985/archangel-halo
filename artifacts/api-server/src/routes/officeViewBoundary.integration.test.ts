/**
 * Regression: the crew office-view privacy boundary.
 *
 * GET /portal/:token/office-view exposes granted, read-only office data to a
 * crew portal link. This suite locks the boundary so future schema growth can
 * never leak money or client-contact data into it:
 *
 *   - No key anywhere in the response may look like a money or contact field
 *     (rate/margin/invoice/amount/email/phone/price/cost/payment/...).
 *   - No string value anywhere may contain an email address.
 *   - Schedule and dispatch rows must always be a subset of the granted job
 *     scope (never a job outside the grant).
 *   - PUT /crews/:id/access rejects "selected" scopes with empty id lists.
 *   - Revoking the grant returns the disabled/empty view.
 *
 * Integration test against a RUNNING api-server sharing the dev database.
 * Skipped unless HALO_E2E_BASE is set, e.g.:
 *
 *   HALO_E2E_BASE="https://$REPLIT_DEV_DOMAIN/api" \
 *   HALO_E2E_COOKIE="halo_office_session=..." \
 *   pnpm --filter @workspace/api-server run test
 *
 * If HALO_E2E_COOKIE is not provided but SESSION_SECRET is available, a valid
 * office session cookie is minted directly (same HMAC scheme as officeAuth).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.HALO_E2E_BASE ?? "";

function mintOfficeCookie(): string {
  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret) return "";
  const payload = `office.${Math.floor(Date.now() / 1000) + 3600}.${randomBytes(9).toString("base64url")}`;
  const mac = createHmac("sha256", secret).update(payload).digest("base64url");
  return `halo_office_session=${payload}.${mac}`;
}

const COOKIE = process.env.HALO_E2E_COOKIE || mintOfficeCookie();

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

// Portal calls deliberately go WITHOUT the office cookie: the link alone must
// be enough (and must never yield more than the grant allows).
async function portal(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
}

// Keys that must NEVER appear anywhere in an office-view response, at any
// depth. This is the lock: if a future change adds e.g. `rate`, `marginPct`,
// `invoiceTotal`, `contactEmail` or `phone` to any row, this test fails.
const FORBIDDEN_KEY_RE =
  /rate|margin|invoice|amount|email|phone|price|cost|payment|payout|paid|balance|revenue|expense|billing|salary|wage|earning|bank|budget|contact/i;

const EMAIL_VALUE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function collectViolations(node: unknown, path: string, out: string[]): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    if (EMAIL_VALUE_RE.test(node)) out.push(`${path}: value looks like an email ("${node}")`);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectViolations(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_RE.test(k)) out.push(`${path}.${k}: forbidden key`);
      collectViolations(v, `${path}.${k}`, out);
    }
  }
}

function assertNoLeaks(body: unknown): void {
  const violations: string[] = [];
  collectViolations(body, "$", violations);
  expect(violations).toEqual([]);
}

function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!BASE || !COOKIE)("office-view privacy boundary", () => {
  let propertyId = "";
  let crewId = "";
  let portalToken = "";
  let grantedJob: { id: string; jobNo: string };
  let otherJob: { id: string; jobNo: string };
  const cleanupJobIds: string[] = [];
  const today = localDay(0);

  beforeAll(async () => {
    const props = await api("/properties");
    expect(props.status).toBe(200);
    expect(props.json.length).toBeGreaterThan(0);
    propertyId = props.json[0].id;

    const mk = await api("/crews", {
      method: "POST",
      body: JSON.stringify({ name: `Boundary Test Crew ${Date.now()}` }),
    });
    expect(mk.status).toBe(201);
    crewId = mk.json.id;
    const link = await api(`/crews/${crewId}/portal-link`, { method: "POST" });
    expect(link.status).toBe(200);
    portalToken = link.json.token;
    expect(portalToken).toBeTruthy();

    // One job inside the grant, one outside it — both scheduled + dispatched
    // today so schedule and dispatch feeds have candidate rows for both.
    async function mkJob(tag: string) {
      const r = await api("/jobs/quick", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          description: `office-view boundary ${tag} ${Date.now()}`,
        }),
      });
      expect(r.status).toBe(201);
      cleanupJobIds.push(r.json.id);
      const d = await api(`/jobs/${r.json.id}/dispatch`, {
        method: "POST",
        body: JSON.stringify({ crewLeaderId: crewId, scheduledOn: today }),
      });
      expect(d.status).toBe(200);
      const a = await api("/dispatch-assignments", {
        method: "POST",
        body: JSON.stringify({ day: today, jobId: r.json.id, memberId: crewId }),
      });
      expect(a.status).toBe(201);
      return r.json as { id: string; jobNo: string };
    }
    grantedJob = await mkJob("granted");
    otherJob = await mkJob("outside");
  });

  afterAll(async () => {
    // Unassign the crew so it can be deleted, then remove test data.
    for (const id of cleanupJobIds) {
      await api(`/jobs/${id}/dispatch`, { method: "POST", body: JSON.stringify({}) });
      await api(`/jobs/${id}`, { method: "DELETE" });
    }
    if (crewId) await api(`/crews/${crewId}`, { method: "DELETE" });
  });

  it("rejects a 'selected' scope with empty id lists", async () => {
    const emptyProps = await api(`/crews/${crewId}/access`, {
      method: "PUT",
      body: JSON.stringify({
        features: ["jobs"],
        propertyScope: "selected",
        propertyIds: [],
        jobScope: "all",
      }),
    });
    expect(emptyProps.status).toBe(400);

    const emptyJobs = await api(`/crews/${crewId}/access`, {
      method: "PUT",
      body: JSON.stringify({
        features: ["jobs"],
        propertyScope: "all",
        jobScope: "selected",
        jobIds: [],
      }),
    });
    expect(emptyJobs.status).toBe(400);

    // Neither rejected attempt may have enabled anything.
    const view = await portal(`/portal/${portalToken}/office-view`);
    expect(view.status).toBe(200);
    expect(view.json.enabled).toBe(false);
  });

  it("granted view leaks no money/contact fields and scopes every row", async () => {
    const put = await api(`/crews/${crewId}/access`, {
      method: "PUT",
      body: JSON.stringify({
        features: ["schedule", "dispatch", "jobs", "properties"],
        propertyScope: "all",
        jobScope: "selected",
        jobIds: [grantedJob.id],
      }),
    });
    expect(put.status).toBe(200);

    const view = await portal(`/portal/${portalToken}/office-view`);
    expect(view.status).toBe(200);
    const body = view.json;
    expect(body.enabled).toBe(true);

    // Boundary: no money or client-contact fields anywhere, at any depth.
    assertNoLeaks(body);

    // Job list respects the grant.
    const jobNos = body.jobs.map((j: any) => j.jobNo);
    expect(jobNos).toContain(grantedJob.jobNo);
    expect(jobNos).not.toContain(otherJob.jobNo);

    // Schedule rows are a subset of the granted job scope: our granted job
    // shows up, the out-of-scope job never does.
    const schedTitles = body.schedule.map((s: any) => String(s.title));
    expect(schedTitles.some((t: string) => t.includes(grantedJob.jobNo))).toBe(true);
    expect(schedTitles.some((t: string) => t.includes(otherJob.jobNo))).toBe(false);
    for (const s of body.schedule) {
      const jobNo = String(s.title).split(" — ")[0];
      expect(jobNo).not.toBe(otherJob.jobNo);
    }

    // Dispatch rows are a subset of the granted job scope too.
    const dispatchJobNos = body.dispatch.map((d: any) => d.jobNo);
    expect(dispatchJobNos).toContain(grantedJob.jobNo);
    expect(dispatchJobNos).not.toContain(otherJob.jobNo);
    for (const d of body.dispatch) {
      expect(d.jobNo).not.toBe(otherJob.jobNo);
    }
  });

  it("with 'all' scopes over real data the response still leaks nothing", async () => {
    const put = await api(`/crews/${crewId}/access`, {
      method: "PUT",
      body: JSON.stringify({
        features: ["schedule", "dispatch", "jobs", "properties"],
        propertyScope: "all",
        jobScope: "all",
      }),
    });
    expect(put.status).toBe(200);
    const view = await portal(`/portal/${portalToken}/office-view`);
    expect(view.status).toBe(200);
    expect(view.json.enabled).toBe(true);
    // Widest possible grant across whatever real data exists — the privacy
    // scan must still find zero money/contact fields and zero email values.
    assertNoLeaks(view.json);
    // Both test jobs are in scope now.
    const dispatchJobNos = view.json.dispatch.map((d: any) => d.jobNo);
    expect(dispatchJobNos).toContain(grantedJob.jobNo);
    expect(dispatchJobNos).toContain(otherJob.jobNo);
  });

  it("revoking the grant returns the disabled, empty view", async () => {
    const put = await api(`/crews/${crewId}/access`, {
      method: "PUT",
      body: JSON.stringify({ features: [], propertyScope: "all", jobScope: "all" }),
    });
    expect(put.status).toBe(200);
    const view = await portal(`/portal/${portalToken}/office-view`);
    expect(view.status).toBe(200);
    expect(view.json).toMatchObject({
      enabled: false,
      features: [],
      properties: [],
      jobs: [],
      schedule: [],
      dispatch: [],
    });
    assertNoLeaks(view.json);
  });
});
