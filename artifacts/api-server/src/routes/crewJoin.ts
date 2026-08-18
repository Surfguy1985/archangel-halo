/**
 * Foreman-minted crew QR invites.
 *
 * A crew member flagged as a foreman (crews.role = 'foreman' or isLeader) can
 * mint single-use QR codes from their own paycard. Whoever scans one types
 * their name at /join/:token and immediately becomes a crew member reporting
 * to that foreman, with their own paycard link.
 *
 * Foreman endpoints authenticate with the foreman's own paycard token — there
 * is no office passcode in the field. Both prefixes (/checkin/, /join/) are in
 * PUBLIC_PREFIXES; every route still validates its own token.
 *
 *   POST /checkin/:token/team/invites            mint a QR invite
 *   POST /checkin/:token/team/invites/:id/revoke kill an unclaimed invite
 *   GET  /join/:joinToken                        who am I joining?
 *   POST /join/:joinToken                        claim it with my name
 */

import { Router } from "express";
import { createHash, randomBytes } from "node:crypto";
import {
  db,
  crewsTable,
  crewJoinLinksTable,
  crewCheckinLinksTable,
  crewCheckinAuditTable,
} from "@workspace/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { limits } from "../lib/rateLimit";
import { crewJoinSchemaReady } from "../lib/ensureCrewJoinSchema";
import {
  classifyCrewTokenShape,
  crewLinkHttpStatus,
  evaluateCrewLink,
  hashCrewToken,
  mintCrewToken,
} from "../lib/crewCheckinCore";

const router = Router();

const JOIN_TOKEN_PREFIX = "join_";
const JOIN_LINK_DAYS = 14;
const PAYCARD_DAYS = 365;
/** A foreman only ever hands out a handful of codes at a time. */
const MAX_OPEN_INVITES = 24;

export function mintJoinToken(): { token: string; tokenHash: string; tokenPrefix: string } {
  const token = JOIN_TOKEN_PREFIX + randomBytes(24).toString("hex");
  return { token, tokenHash: hashJoinToken(token), tokenPrefix: token.slice(0, 14) };
}

export function hashJoinToken(token: string): string {
  return createHash("sha256").update(`halo-crew-join:${token}`).digest("hex");
}

export function joinTokenShape(token: unknown): "ok" | "malformed" {
  if (typeof token !== "string") return "malformed";
  const t = token.trim();
  if (!t || t.length > 128) return "malformed";
  if (t.includes("/") || t.includes("..") || t.includes("\0")) return "malformed";
  return /^join_[0-9a-f]{32,}$/i.test(t) ? "ok" : "malformed";
}

/** Foreman authority: the explicit Wings role, or the structural team-leader flag. */
export function isForemanCrew(crew: { role?: string | null; isLeader?: boolean | null }): boolean {
  return crew.role === "foreman" || crew.role === "superintendent" || crew.isLeader === true;
}

function param(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v.trim() : "";
}

function publicAppOrigin(req: { get: (h: string) => string | undefined; protocol: string }): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "halo.app";
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

/** Resolve a foreman's paycard token to their crew row. */
async function resolveForeman(bearer: string) {
  if (classifyCrewTokenShape(bearer) === "malformed") return { err: "malformed" as const };
  const tokenHash = hashCrewToken(bearer);
  const [row] = await db
    .select()
    .from(crewCheckinLinksTable)
    .where(eq(crewCheckinLinksTable.tokenHash, tokenHash))
    .limit(1);
  const evaluated = evaluateCrewLink(
    bearer,
    row
      ? {
          id: row.id,
          tokenHash: row.tokenHash ?? hashCrewToken(row.token),
          tokenPrefix: row.tokenPrefix ?? row.token.slice(0, 14),
          crewId: row.crewId,
          expiresAt: row.expiresAt.toISOString(),
          revokedAt: row.revokedAt?.toISOString() ?? null,
          lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
        }
      : null,
    new Date(),
  );
  if (evaluated.status !== "valid" || !row) {
    return { err: evaluated.status === "valid" ? ("not_found" as const) : evaluated.status };
  }
  const [crew] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, row.crewId))
    .limit(1);
  if (!crew || crew.active === false) return { err: "not_found" as const };
  if (!isForemanCrew(crew)) return { err: "not_foreman" as const };
  return { crew, linkId: row.id };
}

/** Invites + team roster for a foreman's paycard. */
export async function loadTeamView(foremanId: string, origin: string) {
  await crewJoinSchemaReady();
  const [members, invites] = await Promise.all([
    db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        trade: crewsTable.trade,
        active: crewsTable.active,
      })
      .from(crewsTable)
      .where(eq(crewsTable.leaderId, foremanId))
      .orderBy(crewsTable.name),
    db
      .select()
      .from(crewJoinLinksTable)
      .where(eq(crewJoinLinksTable.foremanCrewId, foremanId))
      .orderBy(desc(crewJoinLinksTable.createdAt))
      .limit(30),
  ]);
  const now = Date.now();
  return {
    members: members
      .filter((m) => m.active !== false)
      .map((m) => ({ id: m.id, name: m.name, trade: m.trade })),
    invites: invites
      .filter((i) => !i.revokedAt)
      .map((i) => ({
        id: i.id,
        // The bearer is only ever returned once, at mint time. Older codes are
        // listed by prefix so the foreman can tell printed cards apart.
        prefix: i.tokenPrefix,
        // Never re-derivable: the bearer is not stored.
        url: null as string | null,
        claimedAt: i.claimedAt?.toISOString() ?? null,
        claimedName: i.claimedName,
        expiresAt: i.expiresAt.toISOString(),
        expired: !i.claimedAt && i.expiresAt.getTime() < now,
        createdAt: i.createdAt.toISOString(),
      })),
    origin,
  };
}

// ─── Foreman: mint a QR invite ───────────────────────────────────────────────

router.post("/checkin/:token/team/invites", limits.checkinWrite, async (req, res): Promise<void> => {
  try {
    await crewJoinSchemaReady();
    const resolved = await resolveForeman(param(req.params.token));
    if ("err" in resolved) {
      if (resolved.err === "not_foreman") {
        res.status(403).json({ error: "Only a foreman can add crew.", code: "not_foreman" });
        return;
      }
      res.status(crewLinkHttpStatus(resolved.err ?? "not_found")).json({ error: resolved.err });
      return;
    }
    const { crew } = resolved;

    const minted = mintJoinToken();
    // Count + insert in one transaction behind a per-foreman advisory lock so
    // two taps can't both slip under the cap. Expired codes don't count —
    // otherwise a foreman is permanently locked out after 24 stale ones.
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-join:${crew.id}`}))`);
      // Lock + re-read the foreman inside the transaction. revokeForemanInvites
      // takes the same lock, so a demote that lands mid-mint either runs first
      // (and this read rejects) or waits (and kills the row we just inserted).
      // Otherwise a code minted a millisecond after demotion would lie dormant
      // and re-arm the moment he's promoted again.
      const [live] = await tx
        .select({ id: crewsTable.id, active: crewsTable.active, role: crewsTable.role, isLeader: crewsTable.isLeader })
        .from(crewsTable)
        .where(eq(crewsTable.id, crew.id))
        .for("update")
        .limit(1);
      if (!live || live.active === false || !isForemanCrew(live)) {
        return { demoted: true as const };
      }
      const open = await tx
        .select({ id: crewJoinLinksTable.id })
        .from(crewJoinLinksTable)
        .where(
          and(
            eq(crewJoinLinksTable.foremanCrewId, crew.id),
            isNull(crewJoinLinksTable.claimedAt),
            isNull(crewJoinLinksTable.revokedAt),
            gt(crewJoinLinksTable.expiresAt, new Date()),
          ),
        );
      if (open.length >= MAX_OPEN_INVITES) return { capped: true as const, open: open.length };
      const [inserted] = await tx
        .insert(crewJoinLinksTable)
        .values({
          tokenHash: minted.tokenHash,
          tokenPrefix: minted.tokenPrefix,
          foremanCrewId: crew.id,
          label: `${crew.name} — crew QR`,
          expiresAt: new Date(Date.now() + JOIN_LINK_DAYS * 86_400_000),
        })
        .returning();
      return { capped: false as const, row: inserted };
    });

    if ("demoted" in outcome) {
      res.status(403).json({ error: "Only a foreman can add crew.", code: "not_foreman" });
      return;
    }
    if (outcome.capped) {
      res.status(429).json({
        error: `You already have ${outcome.open} unused codes. Use or remove some first.`,
        code: "too_many_invites",
      });
      return;
    }
    const row = outcome.row;

    const url = `${publicAppOrigin(req)}/join/${minted.token}`;
    res.status(201).json({
      ok: true,
      invite: {
        id: row.id,
        prefix: minted.tokenPrefix,
        url,
        token: minted.token,
        claimedAt: null,
        claimedName: null,
        expiresAt: row.expiresAt.toISOString(),
        expired: false,
        createdAt: row.createdAt.toISOString(),
      },
      team: await loadTeamView(crew.id, publicAppOrigin(req)),
    });
  } catch (err) {
    logger.error({ err }, "crew-join: mint failed");
    res.status(500).json({ error: "Could not create the code." });
  }
});

// ─── Foreman: revoke an unclaimed invite ─────────────────────────────────────

router.post(
  "/checkin/:token/team/invites/:id/revoke",
  limits.checkinWrite,
  async (req, res): Promise<void> => {
    try {
      await crewJoinSchemaReady();
      const resolved = await resolveForeman(param(req.params.token));
      if ("err" in resolved) {
        if (resolved.err === "not_foreman") {
          res.status(403).json({ error: "Only a foreman can manage crew codes.", code: "not_foreman" });
          return;
        }
        res.status(crewLinkHttpStatus(resolved.err ?? "not_found")).json({ error: resolved.err });
        return;
      }
      const { crew } = resolved;
      // Ownership is part of the WHERE clause: a foreman can only revoke
      // codes he minted, never another team's.
      const revoked = await db
        .update(crewJoinLinksTable)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(crewJoinLinksTable.id, param(req.params.id)),
            eq(crewJoinLinksTable.foremanCrewId, crew.id),
            isNull(crewJoinLinksTable.claimedAt),
            isNull(crewJoinLinksTable.revokedAt),
          ),
        )
        .returning({ id: crewJoinLinksTable.id });
      if (!revoked.length) {
        res.status(409).json({ error: "That code was already used or removed.", code: "not_open" });
        return;
      }
      res.json({ ok: true, team: await loadTeamView(crew.id, publicAppOrigin(req)) });
    } catch (err) {
      logger.error({ err }, "crew-join: revoke failed");
      res.status(500).json({ error: "Could not remove the code." });
    }
  },
);

// ─── Scanner: what am I joining? ─────────────────────────────────────────────

async function loadJoinLink(token: string) {
  if (joinTokenShape(token) === "malformed") return { err: "malformed" as const };
  const [row] = await db
    .select()
    .from(crewJoinLinksTable)
    .where(eq(crewJoinLinksTable.tokenHash, hashJoinToken(token)))
    .limit(1);
  if (!row) return { err: "not_found" as const };
  if (row.revokedAt) return { err: "revoked" as const, row };
  if (row.claimedAt) return { err: "claimed" as const, row };
  if (row.expiresAt.getTime() < Date.now()) return { err: "expired" as const, row };
  return { row };
}

router.get("/join/:token", limits.checkinView, async (req, res): Promise<void> => {
  try {
    await crewJoinSchemaReady();
    const found = await loadJoinLink(param(req.params.token));
    if ("err" in found) {
      const status = found.err === "claimed" ? 409 : found.err === "malformed" ? 400 : 410;
      res.status(found.err === "not_found" ? 404 : status).json({ error: found.err, code: found.err });
      return;
    }
    const [foreman] = await db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        trade: crewsTable.trade,
        active: crewsTable.active,
        role: crewsTable.role,
        isLeader: crewsTable.isLeader,
      })
      .from(crewsTable)
      .where(eq(crewsTable.id, found.row.foremanCrewId))
      .limit(1);
    if (!foreman || foreman.active === false || !isForemanCrew(foreman)) {
      res.status(410).json({ error: "revoked", code: "foreman_inactive" });
      return;
    }
    res.json({
      ok: true,
      foreman: { name: foreman.name, trade: foreman.trade },
      expiresAt: found.row.expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "crew-join: lookup failed");
    res.status(500).json({ error: "Could not open this code." });
  }
});

// ─── Scanner: claim it with my name ──────────────────────────────────────────

router.post("/join/:token", limits.checkinWrite, async (req, res): Promise<void> => {
  try {
    await crewJoinSchemaReady();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (name.length < 2 || name.length > 80) {
      res.status(400).json({ error: "Enter your full name.", code: "name_required" });
      return;
    }

    const found = await loadJoinLink(param(req.params.token));
    if ("err" in found) {
      const status = found.err === "claimed" ? 409 : found.err === "malformed" ? 400 : 410;
      res.status(found.err === "not_found" ? 404 : status).json({ error: found.err, code: found.err });
      return;
    }

    const [foreman] = await db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        trade: crewsTable.trade,
        active: crewsTable.active,
        role: crewsTable.role,
        isLeader: crewsTable.isLeader,
        paymentTerms: crewsTable.paymentTerms,
      })
      .from(crewsTable)
      .where(eq(crewsTable.id, found.row.foremanCrewId))
      .limit(1);
    if (!foreman || foreman.active === false || !isForemanCrew(foreman)) {
      res.status(410).json({ error: "revoked", code: "foreman_inactive" });
      return;
    }

    const minted = mintCrewToken();
    const result = await db.transaction(async (tx) => {
      // Guarded claim first — two people scanning the same printed code race
      // here and exactly one wins.
      const claimed = await tx
        .update(crewJoinLinksTable)
        .set({ claimedAt: new Date(), claimedName: name })
        .where(
          and(
            eq(crewJoinLinksTable.id, found.row.id),
            isNull(crewJoinLinksTable.claimedAt),
            isNull(crewJoinLinksTable.revokedAt),
            // Expiry is re-checked here, not only in the pre-read: a request
            // that started one second before the deadline must not land after it.
            gt(crewJoinLinksTable.expiresAt, new Date()),
          ),
        )
        .returning({ id: crewJoinLinksTable.id });
      if (!claimed.length) return { raced: true as const };

      // Re-read the foreman under the same transaction, locked: he can be
      // demoted or deactivated between the pre-read and this write, and a
      // demoted foreman must not be able to enroll anyone.
      const [live] = await tx
        .select({
          id: crewsTable.id,
          active: crewsTable.active,
          role: crewsTable.role,
          isLeader: crewsTable.isLeader,
          trade: crewsTable.trade,
          paymentTerms: crewsTable.paymentTerms,
        })
        .from(crewsTable)
        .where(eq(crewsTable.id, foreman.id))
        .for("update")
        .limit(1);
      if (!live || live.active === false || !isForemanCrew(live)) {
        return { revoked: true as const };
      }

      const [crew] = await tx
        .insert(crewsTable)
        .values({
          name,
          phone: phone || null,
          trade: live.trade ?? null,
          leaderId: live.id,
          paymentTerms: live.paymentTerms ?? null,
          active: true,
        })
        .returning({ id: crewsTable.id, name: crewsTable.name });

      await tx
        .update(crewJoinLinksTable)
        .set({ claimedCrewId: crew.id })
        .where(eq(crewJoinLinksTable.id, found.row.id));

      const [link] = await tx
        .insert(crewCheckinLinksTable)
        .values({
          token: `h:${minted.tokenHash}`,
          tokenHash: minted.tokenHash,
          tokenPrefix: minted.tokenPrefix,
          crewId: crew.id,
          expiresAt: new Date(Date.now() + PAYCARD_DAYS * 86_400_000),
          label: `${crew.name} — paycard (joined ${foreman.name}'s crew)`,
        })
        .returning({ id: crewCheckinLinksTable.id });

      return { raced: false as const, revoked: false as const, crew, linkId: link.id };
    });

    if (result.raced) {
      res.status(409).json({ error: "claimed", code: "claimed" });
      return;
    }
    if (result.revoked) {
      res.status(410).json({ error: "revoked", code: "foreman_inactive" });
      return;
    }

    try {
      await db.insert(crewCheckinAuditTable).values({
        linkId: result.linkId,
        action: "created",
        detail: { via: "join", foremanCrewId: foreman.id, crewId: result.crew.id },
      });
    } catch (err) {
      logger.warn({ err }, "crew-join: audit write failed");
    }

    res.status(201).json({
      ok: true,
      crew: { id: result.crew.id, name: result.crew.name },
      foreman: { name: foreman.name },
      paycardUrl: `${publicAppOrigin(req)}/checkin/${minted.token}`,
      token: minted.token,
    });
  } catch (err) {
    logger.error({ err }, "crew-join: claim failed");
    res.status(500).json({ error: "Could not add you to the crew." });
  }
});

/**
 * Called when a crew member loses foreman authority (or is deactivated):
 * every unclaimed code he handed out dies with the promotion. Without this,
 * re-promoting him later would silently re-arm QR codes already in the wild —
 * and the office toggle promises the opposite.
 */
export async function revokeForemanInvites(foremanCrewId: string): Promise<number> {
  await crewJoinSchemaReady();
  return db.transaction(async (tx) => {
    // Same lock the mint path takes, so an in-flight mint can't slip a live
    // code in behind this sweep.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-join:${foremanCrewId}`}))`);
    const killed = await tx
      .update(crewJoinLinksTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(crewJoinLinksTable.foremanCrewId, foremanCrewId),
          isNull(crewJoinLinksTable.claimedAt),
          isNull(crewJoinLinksTable.revokedAt),
        ),
      )
      .returning({ id: crewJoinLinksTable.id });
    return killed.length;
  });
}

export default router;
