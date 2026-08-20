/**
 * Shared crew roster code — one QR for the whole company.
 *
 * Everybody scans the same code, sees the roster grouped by team, taps their
 * own name, and walks away with their own portal link on their phone. Someone
 * who isn't on the list adds themselves and picks the foreman they report to,
 * which is also what decides their map pin colour.
 *
 * Deliberately unverified: the office chose one shared code over per-person
 * codes, so the code alone proves nothing about who is holding it. It is a
 * capability — unguessable, rotatable, and rate-limited here so it can't be
 * used to enumerate or mass-claim the roster.
 *
 *   GET  /roster/:code           the pick-your-name list (names + colours only)
 *   POST /roster/:code/claim     hand this device a link to that person's portal
 *   POST /roster/:code/join      add me under a foreman, then do the same
 */

import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, crewsTable, crewPortalBearersTable, notificationsTable } from "@workspace/db";
import { z } from "zod";
import { logger } from "../lib/logger";
import { rateLimit } from "../lib/rateLimit";
import { isActiveRosterCode } from "../lib/rosterCode";
import { ensureCrewRosterSchema } from "../lib/ensureCrewRosterSchema";
import {
  ARCHANGEL_GOLD,
  buildCrewPinColors,
  isArchangelStaff,
  isForeman,
} from "../lib/crewPinColor";
import { hashPortalToken, mintPortalToken } from "../lib/portalToken";
import { ensurePaycardPath } from "../lib/paycardLink";
import { getBusinessSettings } from "../lib/businessSettings";

const router = Router();

/**
 * A crew scans once or twice; a script scraping names does not. Sized for a
 * whole crew arriving together: phones on one job site share a carrier NAT, so
 * they hit this as a single IP, and a limiter that trips reads to the crew as
 * a dead link.
 */
function publicAppOrigin(req: { get: (h: string) => string | undefined; protocol: string }): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "halo.app";
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

const rosterView = rateLimit({ limit: 240, windowMs: 60_000 });
const rosterWrite = rateLimit({ limit: 20, windowMs: 60_000 });

const ClaimBody = z.object({ crewId: z.string().uuid() });
const JoinBody = z.object({
  name: z.string().trim().min(2).max(80),
  leaderId: z.string().uuid().nullish(),
  phone: z.string().trim().max(40).nullish(),
});

function param(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Ask the office for a link to this person's portal.
 *
 * The bearer is minted now but starts PENDING, so the URL is dead until the
 * office approves it — the shared code says nothing about who is holding the
 * phone, and behind that portal sit the crew's pay, invoices and payment
 * details. Existing links are never touched: this is an additional key, so
 * approving a new phone can't kill the QR already on the old one.
 */
class TooManyPendingClaims extends Error {}

/** A crew has two phones, maybe three. Nobody legitimately needs five waiting. */
const MAX_PENDING_PER_CREW = 5;

async function requestDeviceBearer(
  crew: { id: string; name: string },
  requestedName: string,
  reason: "picked" | "self-added",
  note?: string | null,
): Promise<{ claimId: string; token: string }> {
  // Per-crew, server-side, and therefore the real ceiling: the IP limiter in
  // front of this route keys off a header the caller can vary, so it can't be
  // what stops someone with the code from burying the office in requests.
  const [pendingBefore] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(crewPortalBearersTable)
    .where(
      and(
        eq(crewPortalBearersTable.crewId, crew.id),
        eq(crewPortalBearersTable.status, "pending"),
      ),
    );
  const waiting = pendingBefore?.n ?? 0;
  if (waiting >= MAX_PENDING_PER_CREW) throw new TooManyPendingClaims();

  const minted = mintPortalToken();
  const [row] = await db
    .insert(crewPortalBearersTable)
    .values({
      crewId: crew.id,
      tokenHash: minted.tokenHash,
      source: "roster",
      status: "pending",
      requestedName,
    })
    .returning();
  if (!row) throw new Error("claim insert returned no row");

  // One ping per crew while something is waiting. The Crew links page lists
  // every request, so a second notification adds nothing the office can act on
  // and a repeated tap shouldn't be able to flood the bell.
  if (waiting === 0) {
    await db.insert(notificationsTable).values({
      kind: "crew_portal_claim",
      priority: "high",
      entityType: "crew",
      entityId: crew.id,
      title: `Approve crew link · ${crew.name}`,
      body: [
        reason === "self-added"
          ? `${requestedName} added themselves from the crew code and is waiting for a link. Approve it on the Crew links page — they can't see any pay until you do.`
          : `Someone scanned the crew code and picked ${crew.name}. Approve it on the Crew links page — the link stays dead until you do.`,
        note,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  return { claimId: row.id, token: minted.token };
}

async function loadActiveCrews() {
  const rows = await db.select().from(crewsTable);
  return rows.filter((c) => c.active !== false);
}

async function requireCode(code: string): Promise<boolean> {
  return isActiveRosterCode(code);
}

// ─── The list ────────────────────────────────────────────────────────────────

router.get("/roster/:code", rosterView, async (req, res): Promise<void> => {
  try {
    await ensureCrewRosterSchema();
    const code = param(req.params.code);
    if (!(await requireCode(code))) {
      res.status(404).json({ error: "This code isn't active. Ask the office for the current one." });
      return;
    }

    const [crews, companyName] = await Promise.all([
      loadActiveCrews(),
      getBusinessSettings()
        .then((s) => s.companyName ?? null)
        .catch(() => null),
    ]);
    const colors = buildCrewPinColors(crews);
    const colorOf = (id: string) => colors.get(id) ?? ARCHANGEL_GOLD;

    // Name, trade and team colour only. Trade stays because the roster carries
    // several people with the same name and it's the one hint that lets a crew
    // pick the right row; the raw role string (employee/owner/…) is org detail
    // a QR holder has no business reading, so it never leaves the server.
    const person = (c: (typeof crews)[number]) => ({
      id: c.id,
      name: c.name,
      color: colorOf(c.id),
      trade: c.trade ?? null,
      isForeman: isForeman(c),
    });
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

    const staff = crews.filter((c) => isArchangelStaff(c.role));
    const staffIds = new Set(staff.map((c) => c.id));
    const foremen = crews.filter((c) => !staffIds.has(c.id) && isForeman(c));
    const foremanIds = new Set(foremen.map((c) => c.id));

    const groups: {
      key: string;
      title: string;
      subtitle: string | null;
      color: string;
      leaderId: string | null;
      people: ReturnType<typeof person>[];
    }[] = [];

    if (staff.length) {
      groups.push({
        key: "staff",
        title: companyName ?? "Office",
        subtitle: "Owners and employees",
        color: ARCHANGEL_GOLD,
        leaderId: null,
        people: staff.map(person).sort(byName),
      });
    }

    for (const f of [...foremen].sort(byName)) {
      const team = crews.filter((c) => c.leaderId === f.id && c.id !== f.id && !staffIds.has(c.id));
      groups.push({
        key: f.id,
        title: `${f.name}'s crew`,
        subtitle: team.length ? `${team.length + 1} people` : "Foreman",
        color: colorOf(f.id),
        leaderId: f.id,
        people: [person(f), ...team.map(person).sort(byName)],
      });
    }

    const placed = new Set(groups.flatMap((g) => g.people.map((p) => p.id)));
    const rest = crews.filter((c) => !placed.has(c.id) && !foremanIds.has(c.id));
    if (rest.length) {
      groups.push({
        key: "independents",
        title: "Everyone else",
        subtitle: "Subs and crew without a foreman",
        color: "#94A3B8",
        leaderId: null,
        people: rest.map(person).sort(byName),
      });
    }

    res.json({ companyName, staffColor: ARCHANGEL_GOLD, groups });
  } catch (err) {
    logger.error({ err }, "roster view failed");
    res.status(500).json({ error: "Couldn't load the roster" });
  }
});

// ─── "That's me" ─────────────────────────────────────────────────────────────

router.post("/roster/:code/claim", rosterWrite, async (req, res): Promise<void> => {
  try {
    await ensureCrewRosterSchema();
    const code = param(req.params.code);
    if (!(await requireCode(code))) {
      res.status(404).json({ error: "This code isn't active. Ask the office for the current one." });
      return;
    }
    const parsed = ClaimBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Pick a name from the list" });
      return;
    }

    const [crew] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, parsed.data.crewId))
      .limit(1);
    if (!crew || crew.active === false) {
      res.status(404).json({ error: "That name is no longer on the roster" });
      return;
    }

    // Never hand back the crew's existing link here — that would let anyone
    // with the shared code walk straight into someone else's pay. Every claim
    // is its own pending request the office has to approve.
    const { claimId, token } = await requestDeviceBearer(crew, crew.name, "picked");
    const colors = buildCrewPinColors(await loadActiveCrews());

    // The path comes back now but the bearer behind it is inert: the portal
    // refuses it until the office approves, so handing it over early is safe
    // and saves the phone from having to be told a secret later.
    res.json({
      claimId,
      crewId: crew.id,
      name: crew.name,
      status: "pending",
      portalPath: `/portal/${token}`,
      color: colors.get(crew.id) ?? ARCHANGEL_GOLD,
    });
  } catch (err) {
    if (err instanceof TooManyPendingClaims) {
      res
        .status(429)
        .json({ error: "The office already has a request waiting for this person. Ask them to approve it." });
      return;
    }
    logger.error({ err }, "roster claim failed");
    res.status(500).json({ error: "Couldn't send that to the office" });
  }
});

// ─── "Has the office approved me yet?" ───────────────────────────────────────

router.get("/roster/:code/claim/:claimId", rosterView, async (req, res): Promise<void> => {
  try {
    await ensureCrewRosterSchema();
    const code = param(req.params.code);
    if (!(await requireCode(code))) {
      res.status(404).json({ error: "This code isn't active. Ask the office for the current one." });
      return;
    }
    const claimId = param(req.params.claimId);
    if (!z.string().uuid().safeParse(claimId).success) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const [row] = await db
      .select()
      .from(crewPortalBearersTable)
      .where(eq(crewPortalBearersTable.id, claimId))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const [crew] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, row.crewId))
      .limit(1);

    // Approved means "this phone is that person", so it also gets the work
    // surface: the paycard they check in and out on. It's the same link that's
    // printed on their card, not a second one — one person, one history.
    let paycardPath: string | null = null;
    if (row.status === "approved" && crew) {
      try {
        paycardPath = await ensurePaycardPath(crew, publicAppOrigin(req));
      } catch (err) {
        // The portal link below still works; losing the shortcut is not a
        // reason to leave a crew stuck on the waiting screen.
        logger.error({ err, crewId: crew.id }, "roster claim: paycard link failed");
      }
    }

    // Only the decision travels here. The device already holds its own bearer
    // from the claim call — it is simply dead until this says "approved", and
    // bearers are hashed at rest so the server couldn't resend it anyway.
    res.json({
      claimId: row.id,
      crewId: row.crewId,
      name: crew?.name ?? row.requestedName ?? "Crew",
      status: row.status,
      paycardPath,
    });
  } catch (err) {
    logger.error({ err }, "roster claim status failed");
    res.status(500).json({ error: "Couldn't check that request" });
  }
});

// ─── "I'm not on the list" ───────────────────────────────────────────────────

router.post("/roster/:code/join", rosterWrite, async (req, res): Promise<void> => {
  try {
    await ensureCrewRosterSchema();
    const code = param(req.params.code);
    if (!(await requireCode(code))) {
      res.status(404).json({ error: "This code isn't active. Ask the office for the current one." });
      return;
    }
    const parsed = JoinBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Type your full name" });
      return;
    }
    const { name, leaderId, phone } = parsed.data;

    // The roster is already full of near-duplicate rows, so an exact name match
    // under the same foreman claims that person instead of adding yet another.
    // Literal case-insensitive equality — never ILIKE, whose % and _ would let
    // a typed name match somebody else. Serialized on the normalized name so
    // two taps can't both miss the read and insert twins.
    //
    // Who they report to is resolved in here too, not before: the whole point
    // of the picker is that it offers every name, so the row it points at has
    // to be re-read under the same snapshot that writes the crew.
    const key = name.toLowerCase();
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-roster-join:${key}`}))`);

      // The list offers every name, because a new hire knows who runs their
      // day, not how that person is filed in HALO. Only an active foreman may
      // ever be stored as the leader, though — otherwise the pin colours stop
      // meaning anything and somebody ends up leading a team they aren't on.
      // Naming anyone else falls back to that person's own foreman (when that
      // parent is itself an active foreman) and tells the office who was
      // actually named, so they fix it on approval instead of the crew member
      // being bounced off the door.
      let leader: { id: string } | null = null;
      let note: string | null = null;
      if (leaderId) {
        const [named] = await tx
          .select()
          .from(crewsTable)
          .where(eq(crewsTable.id, leaderId))
          .limit(1);
        if (!named || named.active === false) return { rejected: true as const };
        if (isForeman(named)) {
          leader = { id: named.id };
        } else {
          let parent: { id: string; name: string } | null = null;
          if (named.leaderId && named.leaderId !== named.id) {
            const [row] = await tx
              .select()
              .from(crewsTable)
              .where(eq(crewsTable.id, named.leaderId))
              .limit(1);
            if (row && row.active !== false && isForeman(row)) parent = { id: row.id, name: row.name };
          }
          leader = parent ? { id: parent.id } : null;
          note = parent
            ? `They said they report to ${named.name}, who isn't a foreman in HALO — filed under ${parent.name}'s crew for now, so check it before you approve.`
            : `They said they report to ${named.name}, who isn't a foreman in HALO and isn't on a crew — pick their crew before you approve.`;
        }
      }

      const [existing] = await tx
        .select()
        .from(crewsTable)
        .where(
          and(
            sql`lower(btrim(${crewsTable.name})) = ${key}`,
            leader ? eq(crewsTable.leaderId, leader.id) : isNull(crewsTable.leaderId),
          ),
        )
        .limit(1);
      if (existing && existing.active !== false) return { crew: existing, note };
      const [created] = await tx
        .insert(crewsTable)
        .values({
          name,
          phone: phone ?? null,
          leaderId: leader?.id ?? null,
          active: true,
        })
        .returning();
      return { crew: created, note };
    });

    if ("rejected" in outcome) {
      res.status(400).json({ error: "Pick the person you report to" });
      return;
    }
    const crew = outcome.crew;
    if (!crew) {
      res.status(500).json({ error: "Couldn't add you to the roster" });
      return;
    }

    const { claimId, token } = await requestDeviceBearer(crew, name, "self-added", outcome.note);
    const colors = buildCrewPinColors(await loadActiveCrews());

    res.json({
      claimId,
      crewId: crew.id,
      name: crew.name,
      status: "pending",
      portalPath: `/portal/${token}`,
      color: colors.get(crew.id) ?? ARCHANGEL_GOLD,
    });
  } catch (err) {
    if (err instanceof TooManyPendingClaims) {
      res
        .status(429)
        .json({ error: "The office already has a request waiting for this person. Ask them to approve it." });
      return;
    }
    logger.error({ err }, "roster join failed");
    res.status(500).json({ error: "Couldn't add you to the roster" });
  }
});

export { hashPortalToken };
export default router;
