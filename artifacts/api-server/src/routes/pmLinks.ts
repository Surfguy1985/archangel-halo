/**
 * PM Live Links — office API + public token-validated view endpoints.
 *
 * Tokens are shown once at create time and stored as SHA-256 hashes.
 * Chat is property-scoped at query time: the model never receives other properties.
 */

import { Router } from "express";
import { createHash } from "node:crypto";
import {
  db,
  pmLiveLinksTable,
  pmLinkAuditTable,
  propertiesTable,
  crewsTable,
  crewCheckinsTable,
  crewPhotosTable,
  jobSummariesTable,
  jobsTable,
  invoicesTable,
} from "@workspace/db";
import { eq, and, gte, desc, isNull, or, inArray } from "drizzle-orm";
import { runCommandBrain, type BusinessSnapshot } from "../lib/commandBrain";
import { logger } from "../lib/logger";
import { limits } from "../lib/rateLimit";
import { authorizeAction, authorizePropertyAccess } from "../lib/enforcerCore";
import {
  buildIsolatedSnapshot,
  classifyPmTokenShape,
  evaluatePmLink,
  hashPmToken,
  mintPmToken,
  parsePmChatMessage,
  pmSystemPrompt,
  type PmLinkRecord,
} from "../lib/pmLiveCore";

const router = Router();

function ipHash(req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
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

function asCoreRecord(row: typeof pmLiveLinksTable.$inferSelect): PmLinkRecord {
  return {
    id: row.id,
    tokenHash: row.tokenHash ?? hashPmToken(row.token),
    tokenPrefix: row.tokenPrefix ?? row.token.slice(0, 14),
    propertyId: row.propertyId,
    permissions: row.permissions,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
  };
}

async function audit(linkId: string, action: string, req: { headers: Record<string, unknown>; socket?: { remoteAddress?: string } }, detail?: Record<string, unknown>) {
  try {
    await db.insert(pmLinkAuditTable).values({
      linkId,
      action,
      ipHash: ipHash(req),
      detail: detail ?? null,
    });
  } catch (err) {
    logger.warn({ err, action, linkId }, "pm-links: audit write failed");
  }
}

async function lookupLink(bearer: string) {
  const tokenHash = hashPmToken(bearer);
  const hashedPlaceholder = `h:${tokenHash}`;
  const [row] = await db
    .select()
    .from(pmLiveLinksTable)
    .where(
      or(
        eq(pmLiveLinksTable.tokenHash, tokenHash),
        eq(pmLiveLinksTable.token, hashedPlaceholder),
        eq(pmLiveLinksTable.token, bearer),
      ),
    )
    .limit(1);
  return row ?? null;
}

function tokenParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

async function resolveLink(token: string, now = new Date()): Promise<
  | { err: "malformed" | "not_found" | "expired" | "revoked" }
  | { link: typeof pmLiveLinksTable.$inferSelect; identity: NonNullable<ReturnType<typeof evaluatePmLink>["identity"]> }
> {
  if (classifyPmTokenShape(token) === "malformed") return { err: "malformed" as const };
  const row = await lookupLink(token);
  const evaluated = evaluatePmLink(token, row ? asCoreRecord(row) : null, now);
  if (evaluated.status !== "valid" || !row || !evaluated.identity) {
    const err =
      evaluated.status === "valid" ? ("not_found" as const) : evaluated.status;
    return { err };
  }
  return { link: row, identity: evaluated.identity };
}

function statusCode(err: string): number {
  if (err === "malformed") return 400;
  if (err === "not_found") return 404;
  return 410;
}

router.post("/pm-links", async (req, res): Promise<void> => {
  try {
    const { propertyId, permissions, expiresInHours = 24, label } = req.body ?? {};

    if (!propertyId || typeof propertyId !== "string") {
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

    const hours = Number(expiresInHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 30) {
      res.status(400).json({ error: "expiresInHours must be between 1 and 720" });
      return;
    }

    const minted = mintPmToken();
    const expiresAt = new Date(Date.now() + hours * 3_600_000);
    const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });

    const [link] = await db
      .insert(pmLiveLinksTable)
      .values({
        token: `h:${minted.tokenHash}`,
        tokenHash: minted.tokenHash,
        tokenPrefix: minted.tokenPrefix,
        propertyId,
        permissions: permissions ?? { map: true, kanban: true, money: false },
        expiresAt,
        label: label ?? `sent ${today}`,
      })
      .returning();

    const url = `${publicAppOrigin(req)}/live/${minted.token}`;
    const expTime = expiresAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const smsText =
      `Hi 👋 Here's your daily update for ${prop.name}:\n\n` +
      `Crew status, field photos & work notes:\n${url}\n\n` +
      `(Link expires today at ${expTime})`;

    await audit(link!.id, "created", req, { propertyId });

    res.json({
      ok: true,
      token: minted.token,
      url,
      smsText,
      link: {
        id: link!.id,
        token: minted.token,
        tokenPrefix: minted.tokenPrefix,
        propertyId: link!.propertyId,
        permissions: link!.permissions,
        expiresAt: link!.expiresAt,
        label: link!.label,
        createdAt: link!.createdAt,
      },
    });
  } catch (err) {
    logger.error({ err }, "pm-links: create failed");
    res.status(500).json({ error: "Failed to create link" });
  }
});

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

    res.json({
      links: links.map((l) => ({
        id: l.id,
        tokenPrefix: l.tokenPrefix,
        propertyId: l.propertyId,
        permissions: l.permissions,
        expiresAt: l.expiresAt,
        lastAccessedAt: l.lastAccessedAt,
        label: l.label,
        createdAt: l.createdAt,
      })),
    });
  } catch (err) {
    logger.error({ err }, "pm-links: list failed");
    res.status(500).json({ error: "Failed to list links" });
  }
});

router.delete("/pm-links/:token", async (req, res): Promise<void> => {
  try {
    const raw = tokenParam(req.params.token);
    const now = new Date();
    let updated: { id: string }[] = [];
    if (/^[0-9a-f-]{36}$/i.test(raw)) {
      updated = await db
        .update(pmLiveLinksTable)
        .set({ revokedAt: now })
        .where(eq(pmLiveLinksTable.id, raw))
        .returning({ id: pmLiveLinksTable.id });
    } else {
      const resolved = await resolveLink(raw, now);
      if ("err" in resolved && resolved.err !== "expired" && resolved.err !== "revoked") {
        res.status(statusCode(resolved.err)).json({ error: resolved.err });
        return;
      }
      const hash = classifyPmTokenShape(raw) === "ok" ? hashPmToken(raw) : null;
      updated = await db
        .update(pmLiveLinksTable)
        .set({ revokedAt: now })
        .where(
          hash
            ? or(eq(pmLiveLinksTable.tokenHash, hash), eq(pmLiveLinksTable.token, raw))
            : eq(pmLiveLinksTable.token, raw),
        )
        .returning({ id: pmLiveLinksTable.id });
    }
    if (updated[0]) await audit(updated[0].id, "revoked", req);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "pm-links: revoke failed");
    res.status(500).json({ error: "Failed to revoke link" });
  }
});

router.get("/live/:token", limits.pmView, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      res.status(statusCode(resolved.err)).json({ error: resolved.err });
      return;
    }
    const { link } = resolved;

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

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

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

      const byCrewId = new Map<string, CrewRow>();
      for (const row of rows) {
        if (!byCrewId.has(row.crewId)) byCrewId.set(row.crewId, row);
      }
      crews = [...byCrewId.values()].filter((c) => c.kind === "checkin");
    }

    type PhotoRow = {
      id: string;
      storagePath: string;
      phase: string | null;
      createdAt: Date;
    };
    let photos: PhotoRow[] = [];
    if (activeJobIds.length > 0) {
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

    await db
      .update(pmLiveLinksTable)
      .set({ lastAccessedAt: new Date() })
      .where(eq(pmLiveLinksTable.id, link.id));
    await audit(link.id, "accessed", req);

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

router.post("/live/:token/chat", limits.pmChat, async (req, res): Promise<void> => {
  try {
    const resolved = await resolveLink(tokenParam(req.params.token));
    if ("err" in resolved) {
      res.status(statusCode(resolved.err)).json({ error: resolved.err });
      return;
    }
    const { link, identity } = resolved;

    const parsed = parsePmChatMessage(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const requestedPropertyId =
      typeof req.body?.propertyId === "string" ? req.body.propertyId : link.propertyId;
    if (!authorizePropertyAccess(identity, requestedPropertyId)) {
      await audit(link.id, "denied", req, { reason: "cross_property", requestedPropertyId });
      res.status(403).json({ error: "Property not in scope" });
      return;
    }

    if (typeof req.body?.action === "string") {
      const authz = authorizeAction(identity, req.body.action);
      if (!authz.ok) {
        await audit(link.id, "denied", req, { reason: "write", action: req.body.action });
        res.status(403).json({ error: "Read-only session", code: "insufficient_role" });
        return;
      }
    }

    const [property] = await db
      .select({
        id: propertiesTable.id,
        name: propertiesTable.name,
        city: propertiesTable.city,
        units: propertiesTable.units,
        status: propertiesTable.status,
      })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, link.propertyId))
      .limit(1);

    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const [jobs, invoices] = await Promise.all([
      db
        .select({
          id: jobsTable.id,
          unitNo: jobsTable.unitNo,
          propertyId: jobsTable.propertyId,
          status: jobsTable.status,
          boardStatus: jobsTable.boardStatus,
          crewLeaderId: jobsTable.crewLeaderId,
          scheduledOn: jobsTable.scheduledOn,
          marginPct: jobsTable.marginPct,
        })
        .from(jobsTable)
        .where(eq(jobsTable.propertyId, link.propertyId)),
      db
        .select({
          id: invoicesTable.id,
          propertyId: invoicesTable.propertyId,
          amount: invoicesTable.amount,
          status: invoicesTable.status,
        })
        .from(invoicesTable)
        .where(eq(invoicesTable.propertyId, link.propertyId)),
    ]);

    const isolated = buildIsolatedSnapshot({
      now: new Date(),
      property: {
        id: property.id,
        name: property.name,
        city: property.city ?? "",
        units: property.units ?? 0,
        status: property.status ?? "active",
      },
      jobs,
      invoices,
      crewsOnSite: 0,
      permissions: link.permissions,
    });

    const snapshot: BusinessSnapshot = {
      date: isolated.date,
      hour: isolated.hour,
      todayItems: isolated.todayItems,
      properties: isolated.properties,
      jobs: isolated.jobs,
      invoices: isolated.invoices,
      crews: isolated.crews,
      margin: isolated.margin,
      falkonMode: isolated.falkonMode,
      snapshotScope: { mode: "property", propertyIds: [isolated.propertyId] },
    };

    const response = await runCommandBrain(
      parsed.message,
      "pm",
      [],
      snapshot,
      { entityType: "property", entityId: property.id },
      { systemPromptOverride: pmSystemPrompt(isolated), readOnly: true },
    );

    if (response.actionPlan) {
      const authz = authorizeAction(identity, response.actionPlan.capability);
      if (!authz.ok) {
        response.type = "answer";
        response.actionPlan = undefined;
        response.shadowLabel = undefined;
        if (!response.text) {
          response.text = "This live link is read-only. I can answer questions about this property only.";
        }
      }
    }

    await db
      .update(pmLiveLinksTable)
      .set({ lastAccessedAt: new Date() })
      .where(eq(pmLiveLinksTable.id, link.id));
    await audit(link.id, "chat", req);

    res.json({ text: response.text });
  } catch (err) {
    logger.error({ err }, "pm-links: chat failed");
    res.status(500).json({ error: "Unable to answer right now" });
  }
});

export default router;
