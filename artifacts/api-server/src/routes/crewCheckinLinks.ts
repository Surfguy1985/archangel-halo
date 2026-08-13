/**
 * Crew Check-in Links — the entire crew UX is one bookmark.
 *
 * Office endpoints (behind passcode gate):
 *   POST   /crew-checkin-links            generate a link for a crew member
 *   GET    /crew-checkin-links            list active links
 *   DELETE /crew-checkin-links/:token     revoke a link
 *
 * Public endpoints (in PUBLIC_PREFIXES):
 *   GET    /checkin/:token                crew info + today's assignment
 *   POST   /checkin/:token/checkin        record check-in with GPS
 *   POST   /checkin/:token/checkout       record check-out with GPS
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import {
  db,
  crewCheckinLinksTable,
  crewsTable,
  crewCheckinsTable,
  jobsTable,
  propertiesTable,
} from "@workspace/db";
import { eq, and, gte, desc, isNull, or } from "drizzle-orm";
import { logger } from "../lib/logger";

const router = Router();

// ─── Office: generate a link ──────────────────────────────────────────────────

router.post("/crew-checkin-links", async (req, res): Promise<void> => {
  try {
    const { crewId, expiresInDays = 90, label } = req.body ?? {};

    if (!crewId) {
      res.status(400).json({ error: "crewId required" });
      return;
    }

    const [crew] = await db
      .select({ id: crewsTable.id, name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, crewId))
      .limit(1);

    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    const token = "crew_" + randomBytes(12).toString("hex");
    const expiresAt = new Date(Date.now() + Number(expiresInDays) * 86_400_000);

    const [link] = await db
      .insert(crewCheckinLinksTable)
      .values({
        token,
        crewId,
        expiresAt,
        label: label ?? `${crew.name} — check-in link`,
      })
      .returning();

    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "halo.app";
    const proto = req.get("x-forwarded-proto") ?? req.protocol;
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${proto}://${host}`;

    const url = `${baseUrl}/checkin/${token}`;
    const firstName = crew.name.split(" ")[0] ?? crew.name;
    const smsText = `Hi ${firstName} 👋 Here's your HALO check-in link:\n${url}\n\nBookmark it and tap when you arrive or leave.`;

    res.json({ ok: true, link, url, smsText, crewName: crew.name });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: create failed");
    res.status(500).json({ error: "Failed to create link" });
  }
});

// ─── Office: list active links ────────────────────────────────────────────────

router.get("/crew-checkin-links", async (_req, res): Promise<void> => {
  try {
    const now = new Date();
    const links = await db
      .select({
        id: crewCheckinLinksTable.id,
        token: crewCheckinLinksTable.token,
        crewId: crewCheckinLinksTable.crewId,
        label: crewCheckinLinksTable.label,
        expiresAt: crewCheckinLinksTable.expiresAt,
        createdAt: crewCheckinLinksTable.createdAt,
        crewName: crewsTable.name,
      })
      .from(crewCheckinLinksTable)
      .innerJoin(crewsTable, eq(crewCheckinLinksTable.crewId, crewsTable.id))
      .where(
        and(
          isNull(crewCheckinLinksTable.revokedAt),
          gte(crewCheckinLinksTable.expiresAt, now),
        ),
      )
      .orderBy(desc(crewCheckinLinksTable.createdAt))
      .limit(100);

    res.json({ links });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: list failed");
    res.status(500).json({ error: "Failed to list links" });
  }
});

// ─── Office: revoke a link ────────────────────────────────────────────────────

router.delete("/crew-checkin-links/:token", async (req, res): Promise<void> => {
  try {
    await db
      .update(crewCheckinLinksTable)
      .set({ revokedAt: new Date() })
      .where(eq(crewCheckinLinksTable.token, req.params.token));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "crew-checkin-links: revoke failed");
    res.status(500).json({ error: "Failed to revoke link" });
  }
});

// ─── Shared: resolve token ────────────────────────────────────────────────────

async function resolveCheckinLink(token: string) {
  const [link] = await db
    .select()
    .from(crewCheckinLinksTable)
    .where(eq(crewCheckinLinksTable.token, token))
    .limit(1);

  if (!link) return { err: "not_found" as const };
  if (link.revokedAt) return { err: "revoked" as const };
  if (link.expiresAt < new Date()) return { err: "expired" as const };
  return { link };
}

// ─── Public: crew info + today's assignment ───────────────────────────────────

router.get("/checkin/:token", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveCheckinLink(req.params.token);
    if ("err" in resolved) {
      res.status(resolved.err === "not_found" ? 404 : 410).json({ error: resolved.err });
      return;
    }
    const { link } = resolved;

    const [crew] = await db
      .select({ id: crewsTable.id, name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, link.crewId))
      .limit(1);

    if (!crew) {
      res.status(404).json({ error: "Crew member not found" });
      return;
    }

    // Today's assignment — look for an active job where this crew is the lead
    const [activeJob] = await db
      .select({
        id: jobsTable.id,
        description: jobsTable.description,
        propertyId: jobsTable.propertyId,
      })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.crewLeaderId, crew.id),
          or(
            eq(jobsTable.boardStatus, "active"),
            eq(jobsTable.boardStatus, "filled"),
            eq(jobsTable.boardStatus, "assigned"),
          ),
        ),
      )
      .limit(1);

    // Get property name if there's an active job
    let propertyName: string | null = null;
    if (activeJob?.propertyId) {
      const [prop] = await db
        .select({ name: propertiesTable.name })
        .from(propertiesTable)
        .where(eq(propertiesTable.id, activeJob.propertyId))
        .limit(1);
      propertyName = prop?.name ?? null;
    }

    // Current check-in status
    const [lastCheckin] = await db
      .select({ kind: crewCheckinsTable.kind, createdAt: crewCheckinsTable.createdAt })
      .from(crewCheckinsTable)
      .where(eq(crewCheckinsTable.crewId, crew.id))
      .orderBy(desc(crewCheckinsTable.createdAt))
      .limit(1);

    const currentStatus: "in" | "out" =
      lastCheckin?.kind === "checkin" ? "in" : "out";

    res.json({
      crew: { id: crew.id, name: crew.name },
      todayAssignment: activeJob
        ? {
            propertyName,
            unitLabel: null,
            jobDescription: activeJob.description ?? null,
          }
        : null,
      currentStatus,
      lastCheckin: lastCheckin?.createdAt?.toISOString() ?? null,
    });
  } catch (err) {
    logger.error({ err }, "crew-checkin: info failed");
    res.status(500).json({ error: "Failed to load check-in info" });
  }
});

// ─── Public: check in ────────────────────────────────────────────────────────

router.post("/checkin/:token/checkin", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveCheckinLink(req.params.token);
    if ("err" in resolved) {
      res.status(resolved.err === "not_found" ? 404 : 410).json({ error: resolved.err });
      return;
    }
    const { link } = resolved;

    const { lat, lng, accuracy } = req.body ?? {};

    const [activeJob] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.crewLeaderId, link.crewId),
          or(
            eq(jobsTable.boardStatus, "active"),
            eq(jobsTable.boardStatus, "filled"),
            eq(jobsTable.boardStatus, "assigned"),
          ),
        ),
      )
      .limit(1);

    await db.insert(crewCheckinsTable).values({
      crewId: link.crewId,
      jobId: activeJob?.id ?? null,
      kind: "checkin",
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      accuracy: accuracy != null ? Number(accuracy) : null,
      label: "Check-in via link",
    });

    res.json({ ok: true, checkedIn: true });
  } catch (err) {
    logger.error({ err }, "crew-checkin: checkin failed");
    res.status(500).json({ error: "Failed to record check-in" });
  }
});

// ─── Public: check out ───────────────────────────────────────────────────────

router.post("/checkin/:token/checkout", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveCheckinLink(req.params.token);
    if ("err" in resolved) {
      res.status(resolved.err === "not_found" ? 404 : 410).json({ error: resolved.err });
      return;
    }
    const { link } = resolved;

    const { lat, lng, accuracy } = req.body ?? {};

    const [activeJob] = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.crewLeaderId, link.crewId),
          or(
            eq(jobsTable.boardStatus, "active"),
            eq(jobsTable.boardStatus, "filled"),
            eq(jobsTable.boardStatus, "assigned"),
          ),
        ),
      )
      .limit(1);

    await db.insert(crewCheckinsTable).values({
      crewId: link.crewId,
      jobId: activeJob?.id ?? null,
      kind: "checkout",
      lat: lat != null ? Number(lat) : null,
      lng: lng != null ? Number(lng) : null,
      accuracy: accuracy != null ? Number(accuracy) : null,
      label: "Checkout via link",
    });

    res.json({ ok: true, checkedOut: true });
  } catch (err) {
    logger.error({ err }, "crew-checkin: checkout failed");
    res.status(500).json({ error: "Failed to record checkout" });
  }
});

export default router;
