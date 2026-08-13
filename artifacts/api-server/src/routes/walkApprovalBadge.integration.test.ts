/**
 * Regression: walk-approval badge increments after a client approves, and
 * resets to zero once the crew opens the Schedule tab (marks "approvals" seen).
 *
 * Task 227 wires walk-approval activity rows (kind = "walk_approved") into
 * computeUnseen under the `approvals` key.  The badge clears when the crew
 * POSTs /portal/:token/seen with { section: "approvals" }.  This test
 * exercises both halves of that contract end-to-end:
 *
 *   (a) portal bundle unseen.approvals > 0 after a walk is approved, and
 *   (b) unseen.approvals === 0 after the crew marks the section seen.
 *
 * Integration test against a RUNNING api-server sharing the dev database.
 * Skipped unless HALO_E2E_BASE is set.  Example:
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

describe.skipIf(!BASE)(
  "walk-approval badge: increments on approval, clears on mark-seen",
  () => {
    let propertyId = "";
    let crewId = "";
    let portalToken = "";
    const cleanupJobIds: string[] = [];

    beforeAll(async () => {
      // Resolve fixtures in parallel.
      const [propsRes, crewsRes] = await Promise.all([
        api("/properties"),
        api("/crews"),
      ]);
      expect(propsRes.status).toBe(200);
      expect(crewsRes.status).toBe(200);

      // Pick a crew leader that has a portal token.
      type CrewStub = { id: string; portalToken: string | null; isLeader?: boolean };
      const crews = crewsRes.json as CrewStub[];
      const leader =
        crews.find((c) => c.portalToken && c.isLeader !== false) ??
        crews.find((c) => c.portalToken);
      expect(leader, "No crew with a portal token found — seed at least one crew").toBeTruthy();
      crewId = leader!.id;
      portalToken = leader!.portalToken!;

      // Find the first property that has a client account (required for
      // the /admin/accounts/:propertyId/board/actions dispatch endpoint).
      const properties = propsRes.json as { id: string }[];
      for (const p of properties) {
        const boardRes = await api(`/admin/accounts/${p.id}/board`);
        if (boardRes.status === 200) {
          propertyId = p.id;
          break;
        }
      }
      expect(propertyId, "No property with a client account found").not.toBe("");
    });

    afterAll(async () => {
      // Best-effort cleanup — don't let a failing delete break the suite.
      for (const id of cleanupJobIds) {
        await api(`/jobs/${id}`, { method: "DELETE" }).catch(() => {});
      }
    });

    it("badge > 0 after walk approval; 0 after mark-seen for 'approvals'", async () => {
      // ── Baseline reset ─────────────────────────────────────────────────────
      // Stamp the crew's portalSeen.approvals to NOW so any pre-existing
      // walk_approved activities are already "seen" before the test begins.
      const resetRes = await api(`/portal/${portalToken}/seen`, {
        method: "POST",
        body: JSON.stringify({ section: "approvals" }),
      });
      expect(resetRes.status).toBe(200);

      // ── Step 1: create a walk ──────────────────────────────────────────────
      const walkRes = await api("/walks", {
        method: "POST",
        body: JSON.stringify({ propertyId }),
      });
      expect(walkRes.status, `POST /walks → ${JSON.stringify(walkRes.json)}`).toBe(201);
      const walkId: string = walkRes.json.id;

      // ── Step 2: add a capture (required before completion) ─────────────────
      const capRes = await api(`/walks/${walkId}/captures`, {
        method: "POST",
        body: JSON.stringify({
          unitNo: "101",
          service: "Cleaning",
          note: "walk-badge regression",
        }),
      });
      expect(capRes.status, `POST /walks/${walkId}/captures → ${JSON.stringify(capRes.json)}`).toBe(201);

      // ── Step 3: complete the walk → creates jobs ───────────────────────────
      const completeRes = await api(`/walks/${walkId}/complete`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      expect(
        completeRes.status,
        `POST /walks/${walkId}/complete → ${JSON.stringify(completeRes.json)}`,
      ).toBe(200);

      const createdJobs = completeRes.json.jobs as { id: string }[];
      expect(createdJobs.length, "Walk completion must produce at least one job").toBeGreaterThan(0);
      const jobId = createdJobs[0]!.id;
      cleanupJobIds.push(jobId);

      // ── Step 4: assign the crew to the job ────────────────────────────────
      // The walk_approved activity is only written for jobs that have a
      // crewLeaderId, so the crew assignment must come before the approval.
      const assignRes = await api(`/jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ crewLeaderId: crewId }),
      });
      expect(assignRes.status, `PATCH /jobs/${jobId} → ${JSON.stringify(assignRes.json)}`).toBe(200);

      // ── Step 5: office approves the walk → pushes card to client board ─────
      const walkApproveRes = await api(`/walks/${walkId}/approve`, {
        method: "POST",
      });
      expect(
        walkApproveRes.status,
        `POST /walks/${walkId}/approve → ${JSON.stringify(walkApproveRes.json)}`,
      ).toBe(200);
      expect(
        walkApproveRes.json.cards,
        "Walk approve must push at least one card to the client board",
      ).toBeGreaterThan(0);

      // ── Step 6: locate the pushed card ────────────────────────────────────
      const boardRes = await api(`/admin/accounts/${propertyId}/board`);
      expect(boardRes.status).toBe(200);
      const boardCards = boardRes.json.cards as { id: string; jobId: string | null }[];
      const pushCard = boardCards.find((c) => c.jobId === jobId);
      expect(pushCard, `No card with jobId=${jobId} found on the board`).toBeTruthy();

      // The dispatch action requires "push:<cardId>" as the cardKey.
      const cardKey = `push:${pushCard!.id}`;

      // ── Step 7: client approves walk findings via office dispatcher ─────────
      // Using the /admin/accounts/:propertyId/board/actions endpoint because
      // it carries a synthetic office viewer (no client session required).
      const dispatchRes = await api(`/admin/accounts/${propertyId}/board/actions`, {
        method: "POST",
        body: JSON.stringify({
          action: "walk.approve",
          cardKey,
          payload: { jobId },
        }),
      });
      expect(
        dispatchRes.status,
        `POST /admin/accounts/${propertyId}/board/actions → ${JSON.stringify(dispatchRes.json)}`,
      ).toBe(200);
      expect(dispatchRes.json.ok, dispatchRes.json.reason ?? "action rejected").toBe(true);

      // ── Step 8: portal bundle must show unseen.approvals > 0 ──────────────
      // The walk_approved activity was just written for this crew; the
      // timestamp is after the baseline reset, so computeUnseen must count it.
      const portalRes = await api(`/portal/${portalToken}`);
      expect(portalRes.status).toBe(200);
      const unreadBefore: number = portalRes.json.unseen?.approvals ?? 0;
      expect(
        unreadBefore,
        "unseen.approvals must be > 0 after walk approval — computeUnseen is not counting walk_approved activities",
      ).toBeGreaterThan(0);

      // ── Step 9: crew marks approvals seen ─────────────────────────────────
      const seenRes = await api(`/portal/${portalToken}/seen`, {
        method: "POST",
        body: JSON.stringify({ section: "approvals" }),
      });
      expect(seenRes.status).toBe(200);

      // ── Step 10: badge must now be zero ───────────────────────────────────
      // The mark-seen handler re-runs computeUnseen and returns the new
      // totals; the same value is what GET /portal/:token would return.
      const unreadAfter: number = seenRes.json.approvals ?? -1;
      expect(
        unreadAfter,
        "unseen.approvals must be 0 after marking 'approvals' seen — the portalSeen timestamp is not being used in the walk_approved query",
      ).toBe(0);
    });
  },
);
