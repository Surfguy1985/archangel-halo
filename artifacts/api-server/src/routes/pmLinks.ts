/**
 * PM Live Links — office API + public token-validated view endpoints.
 *
 * Office endpoints (behind passcode gate):
 *   POST   /pm-links            create a 24-hour live link for a property
 *   GET    /pm-links            list active (non-revoked, non-expired) links
 *   DELETE /pm-links/:token     revoke a link immediately
 *
 * Public endpoints (in PUBLIC_PREFIXES):
 *   GET    /live/:token         fetch the property view data bundle
 *   POST   /live/:token/chat    property-scoped chat (for the PM)
 */

import { Router } from "express";
import { randomBytes } from "crypto";
import {
  db,
  pmLiveLinksTable,
  propertiesTable,
  crewsTable,
  crewCheckinsTable,
  crewPhotosTable,
  jobSummariesTable,
  jobsTable,
} from "@workspace/db";
import { eq, and, gte, desc, isNull, or } from "drizzle-orm";
import { buildSnapshot, runCommandBrain } from "../lib/commandBrain";
import { logger } from "../lib/logger";

const router = Router();

// ─── Office: create a PM live link ───────────────────────────────────────────

router.post("/pm-links", async (req, res): Promise<void> => {
  try {
    const { propertyId, permissions, expiresInHours = 24, label } = req.body ?? {};

    if (!propertyId) {
      res.status(400).json({ error: "propertyId required" });
      return;
    }

    const [prop] = await db
      .select({ id: propertiesTable.id, name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId))
      .limit(1);

    if (!prop) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const token = "pmlink_" + randomBytes(12).toString("hex");
    const expiresAt = new Date(Date.now() + Number(expiresInHours) * 3_600_000);
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const [link] = await db
      .insert(pmLiveLinksTable)
      .values({
        token,
        propertyId,
        permissions: permissions ?? { map: true, kanban: true, money: false },
        expiresAt,
        label: label ?? `sent ${today}`,
      })
      .returning();

    const host = req.get("x-forwarded-host") ?? req.get("host") ?? "halo.app";
    const proto = req.get("x-forwarded-proto") ?? req.protocol;
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : `${proto}://${host}`;

    const url = `${baseUrl}/live/${token}`;
    const expTime = expiresAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

    const smsText =
      `Hi 👋 Here's your daily update for ${prop.name}:\n\n` +
      `Crew status, field photos & work notes:\n${url}\n\n` +
      `(Link expires today at ${expTime})`;

    res.json({ ok: true, link, url, smsText });
  } catch (err) {
    logger.error({ err }, "pm-links: create failed");
    res.status(500).json({ error: "Failed to create link" });
  }
});

// ─── Office: list active links ────────────────────────────────────────────────

router.get("/pm-links", async (_req, res): Promise<void> => {
  try {
    const now = new Date();
    const links = await db
      .select()
      .from(pmLiveLinksTable)
      .where(
        and(
          isNull(pmLiveLinksTable.revokedAt),
          gte(pmLiveLinksTable.expiresAt, now),
        ),
      )
      .orderBy(desc(pmLiveLinksTable.createdAt))
      .limit(50);

    res.json({ links });
  } catch (err) {
    logger.error({ err }, "pm-links: list failed");
    res.status(500).json({ error: "Failed to list links" });
  }
});

// ─── Office: revoke a link ────────────────────────────────────────────────────

router.delete("/pm-links/:token", async (req, res): Promise<void> => {
  try {
    await db
      .update(pmLiveLinksTable)
      .set({ revokedAt: new Date() })
      .where(eq(pmLiveLinksTable.token, req.params.token));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "pm-links: revoke failed");
    res.status(500).json({ error: "Failed to revoke link" });
  }
});

// ─── Shared: validate token ───────────────────────────────────────────────────

async function resolveLink(token: string) {
  const [link] = await db
    .select()
    .from(pmLiveLinksTable)
    .where(eq(pmLiveLinksTable.token, token))
    .limit(1);

  if (!link) return { err: "not_found" as const };
  if (link.revokedAt) return { err: "revoked" as const };
  if (link.expiresAt < new Date()) return { err: "expired" as const };
  return { link };
}

// ─── Public: view data bundle ─────────────────────────────────────────────────

router.get("/live/:token", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(req.params.token);
    if ("err" in resolved) {
      res.status(resolved.err === "not_found" ? 404 : 410).json({ error: resolved.err });
      return;
    }
    const { link } = resolved;

    // Property
    const [property] = await db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        city: propertiesTable.city,
        units: propertiesTable.units,
        address: propertiesTable.address,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, link.propertyId))
      .limit(1);

    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    // Today's date range
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Active jobs at this property
    const activeJobs = await db
      .select({ id: jobsTable.id, boardStatus: jobsTable.boardStatus })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.propertyId, link.propertyId),
          or(
            eq(jobsTable.boardStatus, "active"),
            eq(jobsTable.boardStatus, "filled"),
            eq(jobsTable.boardStatus, "assigned"),
          ),
        ),
      )
      .limit(50);

    const completedJobs = await db
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.propertyId, link.propertyId),
          or(
            eq(jobsTable.boardStatus, "completed"),
            eq(jobsTable.boardStatus, "done"),
          ),
        ),
      )
      .limit(50);

    const activeJobIds = activeJobs.map((j) => j.id);

    // Today's crew check-ins for this property (via jobs)
    type CrewRow = {
      crewId: string;
      crewName: string;
      lat: number | null;
      lng: number | null;
      checkinAt: Date;
      jobId: string | null;
      kind: string;
    };

    let crews: CrewRow[] = [];
    if (activeJobIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      const rows = await db
        .select({
          crewId: crewCheckinsTable.crewId,
          crewName: crewsTable.name,
          lat: crewCheckinsTable.lat,
          lng: crewCheckinsTable.lng,
          checkinAt: crewCheckinsTable.createdAt,
          jobId: crewCheckinsTable.jobId,
          kind: crewCheckinsTable.kind,
        })
        .from(crewCheckinsTable)
        .innerJoin(crewsTable, eq(crewCheckinsTable.crewId, crewsTable.id))
        .where(
          and(
            gte(crewCheckinsTable.createdAt, todayStart),
            inArray(crewCheckinsTable.jobId, activeJobIds),
          ),
        )
        .orderBy(desc(crewCheckinsTable.createdAt));

      // Dedupe: keep the most recent record per crew; include only if last is checkin
      const byCrewId = new Map<string, CrewRow>();
      for (const row of rows) {
        if (!byCrewId.has(row.crewId)) byCrewId.set(row.crewId, row);
      }
      crews = [...byCrewId.values()].filter((c) => c.kind === "checkin");
    }

    // Latest photos (via active jobs, most recent 8)
    type PhotoRow = {
      id: string;
      storagePath: string;
      phase: string | null;
      createdAt: Date;
    };
    let photos: PhotoRow[] = [];
    if (activeJobIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      photos = await db
        .select({
          id: crewPhotosTable.id,
          storagePath: crewPhotosTable.storagePath,
          phase: crewPhotosTable.phase,
          createdAt: crewPhotosTable.createdAt,
        })
        .from(crewPhotosTable)
        .where(inArray(crewPhotosTable.jobId, activeJobIds))
        .orderBy(desc(crewPhotosTable.createdAt))
        .limit(8);
    }

    // Work notes (job summaries for this property, recent)
    const workNotesRaw = await db
      .select({
        id: jobSummariesTable.id,
        unitNumber: jobSummariesTable.unitNumber,
        observations: jobSummariesTable.observations,
        crewLead: jobSummariesTable.crewLead,
        createdAt: jobSummariesTable.createdAt,
      })
      .from(jobSummariesTable)
      .where(eq(jobSummariesTable.propertyId, link.propertyId))
      .orderBy(desc(jobSummariesTable.createdAt))
      .limit(5);

    res.json({
      property,
      summary: {
        date: todayStart.toISOString().slice(0, 10),
        crewsOnSite: crews.length,
        unitsActive: activeJobs.length,
        unitsCompleted: completedJobs.length,
        totalJobs: activeJobs.length + completedJobs.length,
      },
      crews: crews.map((c) => ({
        id: c.crewId,
        name: c.crewName,
        status: "on_site" as const,
        lastSeenAt: c.checkinAt.toISOString(),
        unitLabel: null,
        lat: c.lat,
        lng: c.lng,
      })),
      photos: photos.map((p) => ({
        id: p.id,
        path: p.storagePath,
        kind: p.phase ?? "photo",
        unitLabel: null,
        crewName: null,
        createdAt: p.createdAt.toISOString(),
      })),
      workNotes: workNotesRaw
        .filter((n) => n.observations)
        .map((n) => ({
          id: n.id,
          unitLabel: n.unitNumber ?? null,
          summary: n.observations as string,
          crewName: n.crewLead ?? null,
          createdAt: n.createdAt.toISOString(),
        })),
      permissions: link.permissions,
      expiresAt: link.expiresAt.toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "pm-links: view failed");
    res.status(500).json({ error: "Failed to load property data" });
  }
});

// ─── Public: property-scoped chat ─────────────────────────────────────────────

router.post("/live/:token/chat", async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(req.params.token);
    if ("err" in resolved) {
      res.status(resolved.err === "not_found" ? 404 : 410).json({ error: resolved.err });
      return;
    }
    const { link } = resolved;

    const { message } = req.body ?? {};
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message required" });
      return;
    }

    const [property] = await db
      .select({ id: propertiesTable.id, name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, link.propertyId))
      .limit(1);

    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    // Run the brain scoped to this property with a PM role
    const snapshot = await buildSnapshot();
    const response = await runCommandBrain(
      message,
      "pm",
      [],
      snapshot,
      { entityType: "property", entityId: property.id },
    );

    res.json({ text: response.text });
  } catch (err) {
    logger.error({ err }, "pm-links: chat failed");
    res.status(500).json({ error: "Unable to answer right now" });
  }
});

export default router;
