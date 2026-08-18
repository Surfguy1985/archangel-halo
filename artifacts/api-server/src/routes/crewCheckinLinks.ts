/**
 * Crew check-in links — printed QR paycard + live GPS pin.
 *
 * Office: POST/GET/DELETE /crew-checkin-links
 *         POST /crew-checkin-links/paycards  (printable URL per crew)
 * Public: GET  /checkin/:token
 *         POST /checkin/:token/checkin|checkout|location|photos
 *
 * Tokens are hashed at rest. The paycard URL is stored on the link label so
 * printed cards stay stable. Check-in requires GPS (green pin). Checkout
 * requires before + after photos — they do this to get paid.
 */

import { Router } from "express";
import { createHash } from "node:crypto";
import {
  db,
  crewCheckinLinksTable,
  crewCheckinAuditTable,
  crewsTable,
  crewCheckinsTable,
  crewTrackPointsTable,
  crewPhotosTable,
  jobsTable,
  propertiesTable,
} from "@workspace/db";
import { recordFieldProvenance } from "../lib/fieldProvenance";
import { ObjectStorageService } from "../lib/objectStorage";
import { eq, and, gte, desc, isNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";
import { limits } from "../lib/rateLimit";
import { sendSms, smsEnabled } from "../lib/sms";
import {
  classifyCrewTokenShape,
  checkoutPhotosReady,
  crewLinkHttpStatus,
  decideCheckin,
  decideCheckout,
  decideLocationPing,
  decodePaycardUrl,
  encodePaycardLabel,
  evaluateCrewLink,
  evaluateGps,
  formatTodayAssignment,
  gpsPlacesMapPin,
  hashCrewToken,
  localIsoDate,
  mapSessionView,
  matchDispatchJob,
  mintCrewToken,
  paycardUnitLabel,
  sessionFromEvents,
  todaysDispatch,
  type CrewLinkRecord,
  type DispatchJob,
  type PunchEvent,
} from "../lib/crewCheckinCore";

const router = Router();

function ipHash(req: {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : null) ??
    req.socket?.remoteAddress ??
    "unknown";
  return createHash("sha256").update(`halo-ip:${ip}`).digest("hex").slice(0, 32);
}

function publicAppOrigin(req: { get: (h: string) => string | undefined; protocol: string }): string {
  const fromEnv = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const host = req.get("x-forwarded-host") ?? req.get("host") ?? "halo.app";
  const proto = req.get("x-forwarded-proto") ?? req.protocol;
  return `${proto}://${host}`;
}

function tokenParam(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" ? v.trim() : "";
}

function asCoreRecord(row: typeof crewCheckinLinksTable.$inferSelect): CrewLinkRecord {
  return {
    id: row.id,
    tokenHash: row.tokenHash ?? hashCrewToken(row.token),
    tokenPrefix: row.tokenPrefix ?? row.token.slice(0, 14),
    crewId: row.crewId,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
  };
}

async function audit(
  linkId: string,
  action: string,
  req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } },
  detail?: Record<string, unknown>,
) {
  try {
    await db.insert(crewCheckinAuditTable).values({
      linkId,
      action,
      ipHash: ipHash(req),
      detail: detail ?? null,
    });
  } catch (err) {
    logger.warn({ err, action, linkId }, "crew-checkin: audit write failed");
  }
}

async function lookupLink(bearer: string) {
  const tokenHash = hashCrewToken(bearer);
  const hashedPlaceholder = `h:${tokenHash}`;
  const [row] = await db
    .select()
    .from(crewCheckinLinksTable)
    .where(
      or(
        eq(crewCheckinLinksTable.tokenHash, tokenHash),
        eq(crewCheckinLinksTable.token, bearer),
        eq(crewCheckinLinksTable.token, hashedPlaceholder),
      ),
    )
    .limit(1);
  return row ?? null;
}

function sendLinkError(
  res: { status: (n: number) => { json: (b: unknown) => unknown } },
  err: "malformed" | "expired" | "revoked" | "not_found" | "valid" | undefined,
) {
  const status = err && err !== "valid" ? err : "not_found";
  res.status(crewLinkHttpStatus(status)).json({ error: status });
}

async function resolveLink(bearer: string, now = new Date()) {
  if (classifyCrewTokenShape(bearer) === "malformed") return { err: "malformed" as const };
  const row = await lookupLink(bearer);
  const evaluated = evaluateCrewLink(bearer, row ? asCoreRecord(row) : null, now);
  if (evaluated.status !== "valid" || !evaluated.link || !row) {
    return { err: evaluated.status === "valid" ? ("not_found" as const) : evaluated.status };
  }
  return { row, link: evaluated.link };
}

async function touchAccess(id: string) {
  await db
    .update(crewCheckinLinksTable)
    .set({ lastAccessedAt: new Date() })
    .where(eq(crewCheckinLinksTable.id, id));
}

async function loadSession(crewId: string): Promise<{ session: ReturnType<typeof sessionFromEvents>; events: PunchEvent[] }> {
  const rows = await db
    .select()
    .from(crewCheckinsTable)
    .where(eq(crewCheckinsTable.crewId, crewId))
    .orderBy(desc(crewCheckinsTable.createdAt))
    .limit(8);
  const events: PunchEvent[] = rows
    .slice()
    .reverse()
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      createdAt: r.createdAt,
      jobId: r.jobId,
      lat: r.lat,
      lng: r.lng,
      accuracy: r.accuracy,
    }));
  return { session: sessionFromEvents(events), events };
}

async function loadDispatch(crewId: string, now: Date): Promise<DispatchJob[]> {
  const today = localIsoDate(now);
  const rows = await db
    .select({
      id: jobsTable.id,
      propertyId: jobsTable.propertyId,
      unitNo: jobsTable.unitNo,
      description: jobsTable.description,
      scheduledOn: jobsTable.scheduledOn,
      boardStatus: jobsTable.boardStatus,
      crewLeaderId: jobsTable.crewLeaderId,
      propertyName: propertiesTable.name,
    })
    .from(jobsTable)
    .leftJoin(propertiesTable, eq(propertiesTable.id, jobsTable.propertyId))
    .where(eq(jobsTable.crewLeaderId, crewId));
  return todaysDispatch(
    rows.map((r) => ({
      id: r.id,
      propertyId: r.propertyId,
      propertyName: r.propertyName,
      unitNo: r.unitNo,
      description: r.description,
      scheduledOn: r.scheduledOn,
      boardStatus: r.boardStatus,
      crewLeaderId: r.crewLeaderId,
    })),
    crewId,
    today,
  );
}

function gpsBody(body: unknown) {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    lat: b.lat,
    lng: b.lng,
    accuracy: b.accuracy,
    capturedAt: b.capturedAt,
  };
}

function gpsColumns(verdict: ReturnType<typeof evaluateGps>): {
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
} {
  if (verdict.status === "ok" || verdict.status === "low_accuracy") {
    return { lat: verdict.lat, lng: verdict.lng, accuracy: verdict.accuracy };
  }
  return { lat: null, lng: null, accuracy: null };
}

async function dropTrackPoint(input: {
  crewId: string;
  jobId: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
}) {
  const [ping] = await db
    .insert(crewTrackPointsTable)
    .values({
      crewId: input.crewId,
      jobId: input.jobId,
      lat: input.lat,
      lng: input.lng,
      accuracy: input.accuracy,
    })
    .returning({ id: crewTrackPointsTable.id });
  if (ping) {
    void recordFieldProvenance({
      eventId: ping.id,
      kind: "location",
      crewId: input.crewId,
      haloJobId: input.jobId,
      lat: input.lat,
      lng: input.lng,
    });
  }
}

async function loadPaycardPhotos(crewId: string, jobId: string | null, takenOn: string) {
  const rows = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.crewId, crewId))
    .orderBy(desc(crewPhotosTable.createdAt))
    .limit(40);
  const relevant = rows.filter((r) => (jobId ? r.jobId === jobId : r.takenOn === takenOn) || r.takenOn === takenOn);
  const before = relevant.filter((r) => r.phase === "before");
  const after = relevant.filter((r) => r.phase === "after");
  return {
    before: before.length,
    after: after.length,
    items: relevant.slice(0, 12).map((r) => ({
      id: r.id,
      phase: r.phase,
      url: `/api/storage${r.storagePath}`,
      takenOn: r.takenOn,
    })),
  };
}

async function ensurePaycardUrl(crew: { id: string; name: string }, origin: string): Promise<string> {
  const now = new Date();
  const links = await db
    .select()
    .from(crewCheckinLinksTable)
    .where(
      and(
        eq(crewCheckinLinksTable.crewId, crew.id),
        isNull(crewCheckinLinksTable.revokedAt),
        gte(crewCheckinLinksTable.expiresAt, now),
      ),
    )
    .orderBy(desc(crewCheckinLinksTable.createdAt));
  for (const row of links) {
    const url = decodePaycardUrl(row.label);
    if (url) return url;
  }
  const minted = mintCrewToken();
  const url = `${origin}/checkin/${minted.token}`;
  await db.insert(crewCheckinLinksTable).values({
    token: `h:${minted.tokenHash}`,
    tokenHash: minted.tokenHash,
    tokenPrefix: minted.tokenPrefix,
    crewId: crew.id,
    expiresAt: new Date(Date.now() + 365 * 86_400_000),
    label: encodePaycardLabel(url),
  });
  return url;
}

// ─── Office: generate a link ──────────────────────────────────────────────────

router.post("/crew-checkin-links", async (req, res): Promise<void> => {
  try {
    const { crewId, expiresInDays = 90, label } = req.body ?? {};
    if (!crewId || typeof crewId !== "string") {
      res.status(400).json({ error: "crewId required" });
      return;
    }

    const [crew] = await db
      .select({ id: crewsTable.id, name: crewsTable.name, active: crewsTable.active })
      .from(crewsTable)
      .where(eq(crewsTable.id, crewId))
      .limit(1);

    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const minted = mintCrewToken();
    const expiresAt = new Date(Date.now() + Number(expiresInDays) * 86_400_000);

    const [row] = await db
      .insert(crewCheckinLinksTable)
      .values({
        token: `h:${minted.tokenHash}`,
        tokenHash: minted.tokenHash,
        tokenPrefix: minted.tokenPrefix,
        crewId,
        expiresAt,
        label: label ?? `${crew.name} — check-in link`,
      })
      .returning();

    const url = `${publicAppOrigin(req)}/checkin/${minted.token}`;
    const firstName = crew.name.split(" ")[0] ?? crew.name;
    const smsText = `Hi ${firstName} 👋 Here's your HALO check-in link:\n${url}\n\nBookmark it and tap when you arrive or leave.`;

    await audit(row.id, "created", req, { crewId });
    res.json({
      ok: true,
      url,
      smsText,
      crewName: crew.name,
      token: minted.token,
      link: {
        id: row.id,
        tokenPrefix: minted.tokenPrefix,
        crewId: row.crewId,
        label: row.label,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      },
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: create failed");
    res.status(500).json({ error: "Failed to create link" });
  }
});

/**
 * Office: mint a check-in link and text it straight to the crew member.
 *
 * One tap from the command-center map: generates a fresh GPS check-in link
 * and delivers it by SMS so the crew never has to be told a URL out loud.
 */
router.post("/crew-checkin-links/text", async (req, res): Promise<void> => {
  try {
    const { crewId, expiresInDays = 90, phone: phoneOverride } = req.body ?? {};
    if (!crewId || typeof crewId !== "string") {
      res.status(400).json({ error: "crewId required" });
      return;
    }

    const [crew] = await db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        phone: crewsTable.phone,
        active: crewsTable.active,
      })
      .from(crewsTable)
      .where(eq(crewsTable.id, crewId))
      .limit(1);

    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const dest =
      (typeof phoneOverride === "string" && phoneOverride.trim()) || crew.phone?.trim() || "";
    if (!dest) {
      res.status(400).json({
        error: `${crew.name} has no phone number on file. Add one on their crew profile first.`,
      });
      return;
    }

    if (!(await smsEnabled())) {
      res.status(400).json({
        error: "SMS is not configured. Connect Twilio and set a from-number first.",
      });
      return;
    }

    const minted = mintCrewToken();
    const expiresAt = new Date(Date.now() + Number(expiresInDays) * 86_400_000);

    const [row] = await db
      .insert(crewCheckinLinksTable)
      .values({
        token: `h:${minted.tokenHash}`,
        tokenHash: minted.tokenHash,
        tokenPrefix: minted.tokenPrefix,
        crewId,
        expiresAt,
        label: `${crew.name} — texted check-in link`,
      })
      .returning();

    const url = `${publicAppOrigin(req)}/checkin/${minted.token}`;
    const firstName = crew.name.split(" ")[0] ?? crew.name;
    const smsText = `Hi ${firstName} 👋 Here's your HALO check-in link:\n${url}\n\nBookmark it and tap when you arrive or leave.`;

    const sent = await sendSms(dest, smsText);
    if (!sent.ok) {
      // Revoke the just-minted link so we never leave a live token that the
      // crew member was never actually given.
      await db
        .update(crewCheckinLinksTable)
        .set({ revokedAt: new Date() })
        .where(eq(crewCheckinLinksTable.id, row.id));
      await audit(row.id, "text_failed", req, { crewId, error: sent.error });
      res.status(400).json({ error: sent.error ?? "Failed to send text" });
      return;
    }

    await audit(row.id, "texted", req, { crewId });
    res.json({
      ok: true,
      crewName: crew.name,
      sentTo: dest,
      url,
      expiresAt: row.expiresAt,
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: text failed");
    res.status(500).json({ error: "Failed to text link" });
  }
});

router.get("/crew-checkin-links", async (_req, res): Promise<void> => {
  try {
    const now = new Date();
    const links = await db
      .select({
        id: crewCheckinLinksTable.id,
        tokenPrefix: crewCheckinLinksTable.tokenPrefix,
        crewId: crewCheckinLinksTable.crewId,
        label: crewCheckinLinksTable.label,
        expiresAt: crewCheckinLinksTable.expiresAt,
        createdAt: crewCheckinLinksTable.createdAt,
        lastAccessedAt: crewCheckinLinksTable.lastAccessedAt,
        crewName: crewsTable.name,
      })
      .from(crewCheckinLinksTable)
      .innerJoin(crewsTable, eq(crewsTable.id, crewCheckinLinksTable.crewId))
      .where(
        and(isNull(crewCheckinLinksTable.revokedAt), gte(crewCheckinLinksTable.expiresAt, now)),
      )
      .orderBy(desc(crewCheckinLinksTable.createdAt))
      .limit(100);

    res.json({ links });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: list failed");
    res.status(500).json({ error: "Failed to list links" });
  }
});

/**
 * Office: one printable paycard URL per active crew member.
 * Reuses an existing HALO paycard link so printed QR codes stay live.
 */
router.post("/crew-checkin-links/paycards", async (req, res): Promise<void> => {
  try {
    const origin = publicAppOrigin(req);
    const crews = await db
      .select({
        id: crewsTable.id,
        name: crewsTable.name,
        trade: crewsTable.trade,
        selfiePath: crewsTable.selfiePath,
        active: crewsTable.active,
      })
      .from(crewsTable)
      .orderBy(crewsTable.name);
    const cards = [];
    for (const crew of crews) {
      if (crew.active === false) continue;
      const url = await ensurePaycardUrl(crew, origin);
      cards.push({
        crewId: crew.id,
        name: crew.name,
        trade: crew.trade ?? null,
        selfiePath: crew.selfiePath ?? null,
        url,
      });
    }
    res.json({ cards });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: paycards failed");
    res.status(500).json({ error: "Failed to load paycards" });
  }
});

router.delete("/crew-checkin-links/:token", async (req, res): Promise<void> => {
  try {
    const raw = tokenParam(req.params.token);
    const now = new Date();
    let updated: { id: string }[] = [];
    if (/^[0-9a-f-]{36}$/i.test(raw)) {
      updated = await db
        .update(crewCheckinLinksTable)
        .set({ revokedAt: now })
        .where(eq(crewCheckinLinksTable.id, raw))
        .returning({ id: crewCheckinLinksTable.id });
    } else {
      const hash = classifyCrewTokenShape(raw) === "ok" ? hashCrewToken(raw) : null;
      updated = await db
        .update(crewCheckinLinksTable)
        .set({ revokedAt: now })
        .where(
          hash
            ? or(eq(crewCheckinLinksTable.tokenHash, hash), eq(crewCheckinLinksTable.token, raw))
            : eq(crewCheckinLinksTable.token, raw),
        )
        .returning({ id: crewCheckinLinksTable.id });
    }
    if (updated[0]) await audit(updated[0].id, "revoked", req);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: revoke failed");
    res.status(500).json({ error: "Failed to revoke link" });
  }
});

// ─── Public: crew + today's assignment + session/map ─────────────────────────

router.get("/checkin/:token", limits.checkinView, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      sendLinkError(res, resolved.err);
      return;
    }
    const { row } = resolved;
    await touchAccess(row.id);

    const [crew] = await db
      .select({ id: crewsTable.id, name: crewsTable.name, active: crewsTable.active })
      .from(crewsTable)
      .where(eq(crewsTable.id, row.crewId))
      .limit(1);

    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const now = new Date();
    const dispatch = await loadDispatch(crew.id, now);
    const assignment = formatTodayAssignment(dispatch);
    const { session } = await loadSession(crew.id);

    const [lastPing] = await db
      .select()
      .from(crewTrackPointsTable)
      .where(eq(crewTrackPointsTable.crewId, crew.id))
      .orderBy(desc(crewTrackPointsTable.createdAt))
      .limit(1);

    const map = mapSessionView({
      session,
      now,
      lastPing:
        lastPing && lastPing.lat != null && lastPing.lng != null
          ? { lat: lastPing.lat, lng: lastPing.lng, accuracy: lastPing.accuracy, at: lastPing.createdAt }
          : null,
    });

    await audit(row.id, "accessed", req);

    const photos = await loadPaycardPhotos(
      crew.id,
      map.status === "in" ? (session.openCheckin?.jobId ?? null) : null,
      localIsoDate(now),
    );

    res.json({
      crew: { id: crew.id, name: crew.name },
      todayAssignment: assignment
        ? {
            propertyName: assignment.propertyName,
            unitLabel: assignment.unitLabel,
            jobDescription: assignment.jobDescription,
            units: assignment.units,
            jobIds: assignment.jobIds,
          }
        : null,
      currentStatus: map.status,
      lastCheckin: map.checkedInAt,
      session: map,
      photos,
      pay: {
        mustCompleteToGetPaid: true,
        steps: ["unit", "checkin", "before", "after", "checkout"],
      },
      backgroundGpsSupported: false,
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin: info failed");
    res.status(500).json({ error: "Failed to load check-in info" });
  }
});

router.post("/checkin/:token/checkin", limits.checkinWrite, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      sendLinkError(res, resolved.err);
      return;
    }
    const { row } = resolved;
    await touchAccess(row.id);

    const [crew] = await db
      .select({ id: crewsTable.id, active: crewsTable.active, name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, row.crewId))
      .limit(1);
    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const now = new Date();
    const gps = evaluateGps(gpsBody(req.body), now);
    if (!gpsPlacesMapPin(gps)) {
      const code =
        gps.status === "stale" ? "gps_stale" : gps.status === "unavailable" ? "gps_required" : "gps_invalid";
      await audit(row.id, "denied", req, { code });
      res.status(400).json({
        error:
          gps.status === "stale"
            ? "Location is too old. Try again."
            : gps.status === "unavailable"
              ? "Turn on location so we can put you on the map — required to get paid."
              : "Location looks invalid.",
        code,
      });
      return;
    }

    const unit = paycardUnitLabel((req.body as { unitNo?: unknown; unitLabel?: unknown }).unitNo
      ?? (req.body as { unitLabel?: unknown }).unitLabel);
    if (!unit) {
      res.status(400).json({
        error: "Log the unit you are on before you check in — required to get paid.",
        code: "unit_required",
      });
      return;
    }

    const { session } = await loadSession(crew.id);
    const decision = decideCheckin({
      session,
      now,
      linkCrewId: row.crewId,
      requestedCrewId: (req.body as { crewId?: unknown } | undefined)?.crewId,
      crewActive: crew.active !== false,
    });
    if (!decision.ok) {
      await audit(row.id, "denied", req, { code: decision.code });
      res.status(decision.status).json({
        error: (decision as { code: string }).code === "wrong_crew" ? "This link is not for that crew." : "This crew is not active.",
        code: decision.code,
      });
      return;
    }

    const dispatch = await loadDispatch(crew.id, now);
    const matched = matchDispatchJob(dispatch, unit);
    const primaryJobId = matched?.id ?? session.openCheckin?.jobId ?? null;
    const coords = gpsColumns(gps);
    const unitLabel = `Unit ${unit}`;
    if ((decision as { action?: string }).action === "create") {
      const [punch] = await db.insert(crewCheckinsTable).values({
        crewId: crew.id,
        jobId: primaryJobId,
        kind: "checkin",
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
        label: unitLabel,
      }).returning({ id: crewCheckinsTable.id });
      if (punch) {
        void recordFieldProvenance({
          eventId: punch.id,
          kind: "checkin",
          crewId: crew.id,
          haloJobId: primaryJobId,
          lat: coords.lat,
          lng: coords.lng,
          propertyName: matched?.propertyName ?? dispatch[0]?.propertyName ?? null,
        });
      }
      if (coords.lat != null && coords.lng != null) {
        await dropTrackPoint({
          crewId: crew.id,
          jobId: primaryJobId,
          lat: coords.lat,
          lng: coords.lng,
          accuracy: coords.accuracy,
        });
      }
    }

    await audit(row.id, "checkin", req, { replay: (decision as { action?: string }).action === "replay", gps: gps.status, unit });
    res.json({
      ok: true,
      checkedIn: true,
      pin: true,
      unit,
      replayed: (decision as { action?: string }).action === "replay",
      reason: (decision as { reason?: string }).reason,
      gps: gps.status,
      assignment: formatTodayAssignment(dispatch),
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin: checkin failed");
    res.status(500).json({ error: "Failed to record check-in" });
  }
});

router.post("/checkin/:token/checkout", limits.checkinWrite, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      sendLinkError(res, resolved.err);
      return;
    }
    const { row } = resolved;
    await touchAccess(row.id);

    // ── Guard: open check-in session required ────────────────────────────────
    // Read the most-recent event for this crew. If it's already "checkout" (or
    // no event exists at all) we reject with 409 — this prevents both orphaned
    // checkouts (crew never checked in) and duplicate checkouts (already out).
    // Legitimate midnight checkout: the crew checked in yesterday and the last
    // event is still "checkin" → the guard passes without special-casing time.
    const [lastEvent] = await db
      .select({ kind: crewCheckinsTable.kind })
      .from(crewCheckinsTable)
      .where(eq(crewCheckinsTable.crewId, row.crewId))
      .orderBy(desc(crewCheckinsTable.createdAt))
      .limit(1);

    if (!lastEvent || lastEvent.kind !== "checkin") {
      res.status(409).json({
        error: "not_checked_in",
        message: "No open check-in session found. Check in before checking out.",
      });
      return;
    }

    const [crew] = await db
      .select({ id: crewsTable.id, active: crewsTable.active })
      .from(crewsTable)
      .where(eq(crewsTable.id, row.crewId))
      .limit(1);
    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const now = new Date();
    const gps = evaluateGps(gpsBody(req.body), now);
    if (gps.status === "invalid" || gps.status === "stale") {
      res.status(400).json({
        error: gps.status === "stale" ? "Location is too old. Try again." : "Location looks invalid.",
        code: gps.status === "stale" ? "gps_stale" : "gps_invalid",
      });
      return;
    }

    const { session } = await loadSession(crew.id);
    const decision = decideCheckout({
      session,
      now,
      linkCrewId: row.crewId,
      requestedCrewId: (req.body as { crewId?: unknown } | undefined)?.crewId,
      crewActive: crew.active !== false,
    });
    if (!decision.ok) {
      await audit(row.id, "denied", req, { code: decision.code });
      const message =
        decision.code === "checkout_without_checkin"
          ? "Check out needs an active check-in."
          : decision.code === "wrong_crew"
            ? "This link is not for that crew."
            : "This crew is not active.";
      res.status(decision.status).json({ error: message, code: decision.code });
      return;
    }

    const photos = await loadPaycardPhotos(
      crew.id,
      session.openCheckin?.jobId ?? null,
      localIsoDate(now),
    );
    if (!checkoutPhotosReady(photos.before, photos.after)) {
      res.status(409).json({
        error: "Add before and after photos to get paid.",
        code: "photos_required",
        before: photos.before,
        after: photos.after,
      });
      return;
    }

    const coords = gpsColumns(gps);
    if ((decision as { action?: string }).action === "create") {
      const [punch] = await db.insert(crewCheckinsTable).values({
        crewId: crew.id,
        jobId: session.openCheckin?.jobId ?? null,
        kind: "checkout",
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
        label: "Checkout via link",
      }).returning({ id: crewCheckinsTable.id });
      if (punch) {
        void recordFieldProvenance({
          eventId: punch.id,
          kind: "checkout",
          crewId: crew.id,
          haloJobId: session.openCheckin?.jobId ?? null,
          lat: coords.lat,
          lng: coords.lng,
        });
      }
    }

    await audit(row.id, "checkout", req, { replay: (decision as { action?: string }).action === "replay", trackingEnds: true });
    res.json({
      ok: true,
      checkedOut: true,
      replayed: (decision as { action?: string }).action === "replay",
      trackingActive: false,
      backgroundGpsSupported: false,
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin: checkout failed");
    res.status(500).json({ error: "Failed to record checkout" });
  }
});

router.post("/checkin/:token/location", limits.trackPoint, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      sendLinkError(res, resolved.err);
      return;
    }
    const { row } = resolved;
    await touchAccess(row.id);

    const now = new Date();
    const gps = evaluateGps(gpsBody(req.body), now);
    const { session } = await loadSession(row.crewId);
    const decision = decideLocationPing({ session, gps });
    if (!decision.ok) {
      const message =
        decision.code === "session_ended"
          ? "Location updates stop after check-out."
          : "A fresh location fix is required.";
      res.status(decision.status).json({ error: message, code: decision.code });
      return;
    }

    const coords = gpsColumns(gps);
    const jobId = session.openCheckin?.jobId ?? null;
    const [ping] = await db.insert(crewTrackPointsTable).values({
      crewId: row.crewId,
      jobId,
      lat: coords.lat!,
      lng: coords.lng!,
      accuracy: coords.accuracy,
    }).returning({ id: crewTrackPointsTable.id });
    if (ping) {
      void recordFieldProvenance({
        eventId: ping.id,
        kind: "location",
        crewId: row.crewId,
        haloJobId: jobId,
        lat: coords.lat!,
        lng: coords.lng!,
      });
    }

    await audit(row.id, "location", req, { jobId });
    res.json({
      ok: true,
      trackingActive: true,
      backgroundGpsSupported: false,
      lastKnownPosition: {
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
        at: now.toISOString(),
      },
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin: location failed");
    res.status(500).json({ error: "Failed to record location" });
  }
});

router.post("/checkin/:token/photos", limits.checkinWrite, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      sendLinkError(res, resolved.err);
      return;
    }
    const { row } = resolved;
    await touchAccess(row.id);

    const [crew] = await db
      .select({ id: crewsTable.id, name: crewsTable.name, active: crewsTable.active })
      .from(crewsTable)
      .where(eq(crewsTable.id, row.crewId))
      .limit(1);
    if (!crew || crew.active === false) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const storagePath = typeof body.storagePath === "string" ? body.storagePath.trim() : "";
    const phase = body.phase === "after" ? "after" : body.phase === "before" ? "before" : null;
    if (!storagePath || !storagePath.startsWith("/")) {
      res.status(400).json({ error: "A photo file is required.", code: "photo_required" });
      return;
    }
    if (!phase) {
      res.status(400).json({ error: "Mark the photo before or after.", code: "phase_required" });
      return;
    }

    const now = new Date();
    const { session } = await loadSession(crew.id);
    const dispatch = await loadDispatch(crew.id, now);
    const jobId =
      (typeof body.jobId === "string" && body.jobId) ||
      session.openCheckin?.jobId ||
      dispatch[0]?.id ||
      null;
    const takenOn =
      typeof body.takenOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.takenOn)
        ? body.takenOn
        : localIsoDate(now);

    let sha256: string | null = null;
    let sizeBytes: number | null = null;
    try {
      const storage = new ObjectStorageService();
      const file = await storage.getObjectEntityFile(storagePath);
      const [buf] = await file.download();
      sha256 = createHash("sha256").update(buf).digest("hex");
      sizeBytes = buf.length;
    } catch (err) {
      logger.warn({ err }, "Could not fingerprint paycard photo");
    }

    const gps = evaluateGps(gpsBody(body), now);
    const coords = gpsColumns(gps);
    const [photo] = await db
      .insert(crewPhotosTable)
      .values({
        crewId: crew.id,
        jobId,
        storagePath,
        takenOn,
        note: typeof body.note === "string" ? body.note : null,
        phase,
        sha256,
        sizeBytes,
        lat: coords.lat,
        lng: coords.lng,
        accuracy: coords.accuracy,
        capturedAt: now,
      })
      .returning();

    await audit(row.id, "photo", req, { phase, jobId });
    const photos = await loadPaycardPhotos(crew.id, jobId, takenOn);
    res.status(201).json({
      ok: true,
      photo: photo
        ? { id: photo.id, phase: photo.phase, url: `/api/storage${photo.storagePath}` }
        : null,
      photos,
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin: photo failed");
    res.status(500).json({ error: "Failed to save photo" });
  }
});

export default router;
