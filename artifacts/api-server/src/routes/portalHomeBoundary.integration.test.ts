/**
 * Regression: the crew portal HOME FEED privacy boundary.
 *
 * GET /portal/:token is the main crew portal feed. Its schedule and offers
 * sections deliberately include property contact info for the crew's OWN
 * jobs (contactName/contactRole/contactPhone/contactEmail) — but nothing
 * else money- or client-shaped may ever appear there. This suite reuses the
 * recursive forbidden-key scanner from officeViewBoundary.integration.test.ts
 * with an allowlist for those deliberate contact fields, and locks:
 *
 *   - No key in schedule/offers rows may look like a money or contact field
 *     (rate/margin/invoice/amount/price/cost/payment/...) other than the
 *     allowlisted contact* fields.
 *   - No string value may contain an email address except under contactEmail.
 *   - One crew's token can never return another crew's schedule or offer
 *     rows (rows are scoped to the token's crew).
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
// be enough (and must never yield more than that crew's own data).
async function portal(path: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
}

// Same lock as the office-view suite: keys that must never appear in the
// scanned sections at any depth...
const FORBIDDEN_KEY_RE =
  /rate|margin|invoice|amount|email|phone|price|cost|payment|payout|paid|balance|revenue|expense|billing|salary|wage|earning|bank|budget|contact/i;

// ...EXCEPT the portal home feed's deliberate property-contact fields for the
// crew's own jobs. Anything else contact/money-shaped is still a failure.
const ALLOWED_KEYS = new Set([
  "contactName",
  "contactRole",
  "contactPhone",
  "contactEmail",
]);

const EMAIL_VALUE_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

function collectViolations(
  node: unknown,
  path: string,
  out: string[],
  parentKey = "",
): void {
  if (node === null || node === undefined) return;
  if (typeof node === "string") {
    // Email-looking values are only allowed inside the allowlisted
    // contactEmail field.
    if (parentKey !== "contactEmail" && EMAIL_VALUE_RE.test(node)) {
      out.push(`${path}: value looks like an email ("${node}")`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectViolations(v, `${path}[${i}]`, out, parentKey));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (FORBIDDEN_KEY_RE.test(k) && !ALLOWED_KEYS.has(k)) {
        out.push(`${path}.${k}: forbidden key`);
      }
      collectViolations(v, `${path}.${k}`, out, k);
    }
  }
}

function assertNoLeaks(body: unknown, label: string): void {
  const violations: string[] = [];
  collectViolations(body, label, violations);
  expect(violations).toEqual([]);
}

function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!BASE || !COOKIE)("portal home feed privacy boundary", () => {
  let propertyId = "";
  let crewAId = "";
  let crewBId = "";
  let tokenA = "";
  let tokenB = "";
  let jobA: { id: string; jobNo: string };
  const cleanupJobIds: string[] = [];
  const today = localDay(0);

  beforeAll(async () => {
    const props = await api("/properties");
    expect(props.status).toBe(200);
    expect(props.json.length).toBeGreaterThan(0);
    propertyId = props.json[0].id;

    async function mkCrew(tag: string) {
      const mk = await api("/crews", {
        method: "POST",
        body: JSON.stringify({ name: `Home Feed Boundary ${tag} ${Date.now()}` }),
      });
      expect(mk.status).toBe(201);
      const link = await api(`/crews/${mk.json.id}/portal-link`, { method: "POST" });
      expect(link.status).toBe(200);
      expect(link.json.token).toBeTruthy();
      return { id: mk.json.id as string, token: link.json.token as string };
    }
    const a = await mkCrew("A");
    const b = await mkCrew("B");
    crewAId = a.id;
    tokenA = a.token;
    crewBId = b.id;
    tokenB = b.token;

    // One job scheduled TODAY for crew A (so it lands in A's weekly schedule)
    // and broadcast as an offer to crew A ONLY.
    const r = await api("/jobs/quick", {
      method: "POST",
      body: JSON.stringify({
        propertyId,
        description: `portal home boundary ${Date.now()}`,
      }),
    });
    expect(r.status).toBe(201);
    jobA = r.json;
    cleanupJobIds.push(jobA.id);
    const d = await api(`/jobs/${jobA.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: crewAId, scheduledOn: today }),
    });
    expect(d.status).toBe(200);
    const bc = await api(`/jobs/${jobA.id}/broadcast`, {
      method: "POST",
      body: JSON.stringify({ mode: "crews", crewIds: [crewAId] }),
    });
    expect(bc.status).toBe(200);
  });

  afterAll(async () => {
    for (const id of cleanupJobIds) {
      await api(`/jobs/${id}/unlist`, { method: "POST", body: JSON.stringify({}) });
      await api(`/jobs/${id}/dispatch`, { method: "POST", body: JSON.stringify({}) });
      await api(`/jobs/${id}`, { method: "DELETE" });
    }
    if (crewAId) await api(`/crews/${crewAId}`, { method: "DELETE" });
    if (crewBId) await api(`/crews/${crewBId}`, { method: "DELETE" });
  });

  it("schedule and offers carry no money fields beyond the contact allowlist", async () => {
    const feed = await portal(`/portal/${tokenA}`);
    expect(feed.status).toBe(200);
    const body = feed.json;

    // The seeded rows are actually present, so the scan below covers real
    // schedule and offer shapes — not empty arrays.
    expect(body.schedule.some((s: any) => s.jobNo === jobA.jobNo)).toBe(true);
    expect(body.offers.some((o: any) => o.jobNo === jobA.jobNo)).toBe(true);

    // Boundary: no money/client fields anywhere in schedule or offers, at any
    // depth, except the deliberate contact* fields.
    assertNoLeaks(body.schedule, "$.schedule");
    assertNoLeaks(body.offers, "$.offers");
  });

  it("email values only ever appear under contactEmail", async () => {
    const feed = await portal(`/portal/${tokenA}`);
    expect(feed.status).toBe(200);
    // Re-scan with the value rule alone: any email-looking string outside a
    // contactEmail field is a leak (contact emails themselves are deliberate).
    const violations: string[] = [];
    collectViolations(feed.json.schedule, "$.schedule", violations);
    collectViolations(feed.json.offers, "$.offers", violations);
    expect(violations.filter((v) => v.includes("looks like an email"))).toEqual([]);
  });

  it("one crew's token never returns another crew's schedule or offer rows", async () => {
    const feedA = await portal(`/portal/${tokenA}`);
    const feedB = await portal(`/portal/${tokenB}`);
    expect(feedA.status).toBe(200);
    expect(feedB.status).toBe(200);

    // Crew A sees its own rows...
    expect(feedA.json.schedule.some((s: any) => s.jobNo === jobA.jobNo)).toBe(true);
    expect(feedA.json.offers.some((o: any) => o.jobNo === jobA.jobNo)).toBe(true);

    // ...crew B sees none of them: not the job, and not any row A received.
    expect(feedB.json.schedule.some((s: any) => s.jobNo === jobA.jobNo)).toBe(false);
    expect(feedB.json.offers.some((o: any) => o.jobNo === jobA.jobNo)).toBe(false);
    const aScheduleIds = new Set(feedA.json.schedule.map((s: any) => s.id));
    const aOfferIds = new Set(feedA.json.offers.map((o: any) => o.id));
    for (const s of feedB.json.schedule) expect(aScheduleIds.has(s.id)).toBe(false);
    for (const o of feedB.json.offers) expect(aOfferIds.has(o.id)).toBe(false);

    // A brand-new crew with no work: schedule/offers are simply empty, and
    // still pass the leak scan.
    assertNoLeaks(feedB.json.schedule, "$.schedule");
    assertNoLeaks(feedB.json.offers, "$.offers");
  });
});
