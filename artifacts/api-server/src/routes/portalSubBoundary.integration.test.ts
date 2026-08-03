/**
 * Regression: cross-crew isolation of the portal SUB-endpoints.
 *
 * The home feed (/portal/:token) and office-view already have boundary
 * suites; this one locks the remaining per-crew sub-endpoints:
 *
 *   GET /portal/:token/messages
 *   GET /portal/:token/photos
 *   GET /portal/:token/documents
 *   GET /portal/:token/invoices
 *   GET /portal/:token/earnings
 *
 * Setup mirrors portalHomeBoundary.integration.test.ts: two crews, rows
 * seeded for crew A only (a message, a photo, a document, an invoice, and an
 * emergency pay hold). Crew B's token must return NONE of crew A's rows —
 * not by id, not by content — on any of these endpoints.
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
async function portal(path: string, init?: RequestInit) {
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

function localDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!BASE || !COOKIE)("portal sub-endpoint cross-crew boundary", () => {
  const nonce = `${Date.now()}-${randomBytes(4).toString("hex")}`;
  let propertyId = "";
  let crewAId = "";
  let crewBId = "";
  let tokenA = "";
  let tokenB = "";
  const cleanupJobIds: string[] = [];
  const today = localDay(0);

  // Crew A's seeded rows (captured for id/content checks against crew B).
  let messageAId = "";
  let photoAId = "";
  let documentAId = "";
  let invoiceAId = "";
  let holdSeeded = false;
  let emergencyJobId = "";

  const MSG_BODY = `private thread A ${nonce}`;
  const DOC_NAME = `private-doc-A-${nonce}.pdf`;
  const DOC_PATH = `/objects/uploads/boundary-doc-${nonce}.pdf`;
  const PHOTO_PATH = `/objects/uploads/boundary-photo-${nonce}.jpg`;
  const INVOICE_NO = `BOUND-${nonce}`;
  const INVOICE_COMPANY = `Boundary Co A ${nonce}`;

  beforeAll(async () => {
    const props = await api("/properties");
    expect(props.status).toBe(200);
    expect(props.json.length).toBeGreaterThan(0);
    propertyId = props.json[0].id;

    async function mkCrew(tag: string) {
      const mk = await api("/crews", {
        method: "POST",
        body: JSON.stringify({ name: `Sub Boundary ${tag} ${nonce}` }),
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

    // --- Seed crew A's private rows -------------------------------------

    // A job assigned to crew A (invoice job link + emergency ping anchor).
    const mkJob = async () => {
      const r = await api("/jobs/quick", {
        method: "POST",
        body: JSON.stringify({
          propertyId,
          description: `portal sub boundary ${nonce}`,
        }),
      });
      expect(r.status).toBe(201);
      cleanupJobIds.push(r.json.id);
      return r.json as { id: string; jobNo: string };
    };
    const jobA = await mkJob();
    const d = await api(`/jobs/${jobA.id}/dispatch`, {
      method: "POST",
      body: JSON.stringify({ crewLeaderId: crewAId, scheduledOn: today }),
    });
    expect(d.status).toBe(200);

    // Message from crew A (crew A is its own leader, so this is allowed).
    const msg = await portal(`/portal/${tokenA}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: MSG_BODY }),
    });
    expect(msg.status).toBe(201);
    messageAId = msg.json.id;

    // Document from crew A.
    const doc = await portal(`/portal/${tokenA}/documents`, {
      method: "POST",
      body: JSON.stringify({ name: DOC_NAME, storagePath: DOC_PATH }),
    });
    expect(doc.status).toBe(201);
    documentAId = doc.json.id;

    // Photo from crew A (fingerprinting of the missing object fails soft).
    const photo = await portal(`/portal/${tokenA}/photos`, {
      method: "POST",
      body: JSON.stringify({
        storagePath: PHOTO_PATH,
        takenOn: today,
        jobId: jobA.id,
        note: `boundary photo ${nonce}`,
      }),
    });
    expect(photo.status).toBe(201);
    photoAId = photo.json.id;

    // Invoice from crew A, linked to crew A's job.
    const inv = await portal(`/portal/${tokenA}/invoices`, {
      method: "POST",
      body: JSON.stringify({
        fromCompany: INVOICE_COMPANY,
        invoiceNo: INVOICE_NO,
        invoiceDate: today,
        propertyAddress: `123 Boundary Way ${nonce}`,
        jobId: jobA.id,
        items: [
          { dateOfWork: today, typeOfWork: "Boundary work", qty: 1, unitPrice: 123.45 },
        ],
        signatureName: "Boundary Tester A",
      }),
    });
    expect(inv.status).toBe(201);
    invoiceAId = inv.json.id;

    // Earnings: emergency ping a second job to crew A only, then commit it
    // from A's portal — that creates a crew_pay_holds row for crew A.
    const jobE = await mkJob();
    emergencyJobId = jobE.id;
    const ping = await api(`/jobs/${jobE.id}/emergency/ping`, {
      method: "POST",
      body: JSON.stringify({ crewIds: [crewAId], bonusAmount: 50 }),
    });
    expect([200, 201]).toContain(ping.status);
    const feedA = await portal(`/portal/${tokenA}`);
    expect(feedA.status).toBe(200);
    const offer = (feedA.json.emergencyOffers as any[]).find(
      (o) => o.jobId === jobE.id && o.status === "pending",
    );
    expect(offer).toBeTruthy();
    const commit = await portal(`/portal/${tokenA}/emergency/${offer.id}/commit`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(commit.status).toBe(200);
    holdSeeded = true;
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

  it("crew A actually sees its own seeded rows (the seed is real)", async () => {
    const [msgs, photos, docs, invs, earn] = await Promise.all([
      portal(`/portal/${tokenA}/messages`),
      portal(`/portal/${tokenA}/photos`),
      portal(`/portal/${tokenA}/documents`),
      portal(`/portal/${tokenA}/invoices`),
      portal(`/portal/${tokenA}/earnings`),
    ]);
    expect(msgs.status).toBe(200);
    expect(photos.status).toBe(200);
    expect(docs.status).toBe(200);
    expect(invs.status).toBe(200);
    expect(earn.status).toBe(200);

    expect(msgs.json.some((m: any) => m.id === messageAId)).toBe(true);
    expect(photos.json.some((p: any) => p.id === photoAId)).toBe(true);
    expect(docs.json.some((d: any) => d.id === documentAId)).toBe(true);
    expect(invs.json.some((i: any) => i.id === invoiceAId)).toBe(true);
    expect(holdSeeded).toBe(true);
    expect(earn.json.holds.some((h: any) => h.jobId === emergencyJobId)).toBe(true);
  });

  it("crew B's token returns none of crew A's messages", async () => {
    const r = await portal(`/portal/${tokenB}/messages`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.json)).toBe(true);
    expect(r.json.some((m: any) => m.id === messageAId)).toBe(false);
    // Content-level check too: A's thread text must not surface anywhere.
    expect(JSON.stringify(r.json)).not.toContain(nonce);
  });

  it("crew B's token returns none of crew A's photos", async () => {
    const r = await portal(`/portal/${tokenB}/photos`);
    expect(r.status).toBe(200);
    expect(r.json.some((p: any) => p.id === photoAId)).toBe(false);
    expect(r.json.some((p: any) => p.storagePath === PHOTO_PATH)).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain(nonce);
  });

  it("crew B's token returns none of crew A's documents", async () => {
    const r = await portal(`/portal/${tokenB}/documents`);
    expect(r.status).toBe(200);
    expect(r.json.some((d: any) => d.id === documentAId)).toBe(false);
    expect(r.json.some((d: any) => d.storagePath === DOC_PATH)).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain(nonce);
  });

  it("crew B's token returns none of crew A's invoices", async () => {
    const r = await portal(`/portal/${tokenB}/invoices`);
    expect(r.status).toBe(200);
    expect(r.json.some((i: any) => i.id === invoiceAId)).toBe(false);
    expect(r.json.some((i: any) => i.invoiceNo === INVOICE_NO)).toBe(false);
    expect(JSON.stringify(r.json)).not.toContain(nonce);
  });

  it("crew B's token returns none of crew A's earnings/pay holds", async () => {
    const r = await portal(`/portal/${tokenB}/earnings`);
    expect(r.status).toBe(200);
    expect(r.json.holds.some((h: any) => h.jobId === emergencyJobId)).toBe(false);
    // A brand-new crew has no pay history at all — totals are zero, so no
    // amount from A's hold can be reflected here.
    expect(r.json.heldTotal).toBe(0);
    expect(r.json.payableTotal).toBe(0);
    expect(r.json.paidTotal).toBe(0);
    expect(r.json.holds).toEqual([]);
  });

  it("crew B can't act on crew A's invoice by id (resubmit is 404, not 403 leak)", async () => {
    const r = await portal(`/portal/${tokenB}/invoices/${invoiceAId}`, {
      method: "PATCH",
      body: JSON.stringify({
        fromCompany: "Hijack Co",
        invoiceDate: today,
        propertyAddress: "999 Nope St",
        items: [
          { dateOfWork: today, typeOfWork: "Hijack", qty: 1, unitPrice: 1 },
        ],
        signatureName: "Hijacker",
      }),
    });
    // Existence must not be revealed: same 404 as a bogus id.
    expect(r.status).toBe(404);
    expect(JSON.stringify(r.json)).not.toContain(INVOICE_NO);
  });
});
