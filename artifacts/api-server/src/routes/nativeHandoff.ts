import { Router, type IRouter, type Request } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  jobsTable,
  jobLineItemsTable,
  activitiesTable,
} from "@workspace/db";
import { findCrewByPortalBearer } from "../lib/portalToken";
import { isUuid, jobBelongsToCrew } from "../lib/crewJobAccess";
import { localToday } from "../lib/localDate";

const router: IRouter = Router();

function canPickUpTurns(crew: {
  trade?: string | null;
  services?: unknown;
}): boolean {
  const serviceNames = Array.isArray(crew.services)
    ? (crew.services as Array<{ name?: unknown }>)
        .map((item) => (typeof item?.name === "string" ? item.name : ""))
    : [];
  const haystack = [crew.trade ?? "", ...serviceNames].join(" ").toLowerCase();
  return [
    "turn",
    "make ready",
    "paint",
    "clean",
    "drywall",
    "floor",
  ].some((needle) => haystack.includes(needle));
}

function bearer(req: Request): string | null {
  const header = typeof req.headers.authorization === "string"
    ? req.headers.authorization.trim()
    : "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || null;
}

router.post("/native/v1/handoffs", async (req, res): Promise<void> => {
  const token = bearer(req);
  const crew = token ? await findCrewByPortalBearer(token) : null;
  if (!crew || crew.active === false) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const sourceJobId = typeof body.jobId === "string" ? body.jobId.trim() : "";
  const handoffId = typeof body.handoffId === "string" ? body.handoffId.trim() : "";
  const summary = typeof body.summary === "string" ? body.summary.trim().slice(0, 180) : "";
  const detail = typeof body.detail === "string" ? body.detail.trim().slice(0, 1200) : "";
  const urgency = body.urgency === "urgent" ? "urgent" : "standard";
  const materialEstimate = typeof body.materialEstimate === "string"
    ? body.materialEstimate.trim().slice(0, 300)
    : "";

  if (!isUuid(sourceJobId) || !isUuid(handoffId) || !summary) {
    res.status(400).json({ error: "A valid source job, handoff ID, and summary are required." });
    return;
  }

  if (!(await jobBelongsToCrew(sourceJobId, crew.id))) {
    res.status(403).json({ error: "That job is not assigned to this crew." });
    return;
  }

  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, handoffId)).limit(1);
  if (existing) {
    res.json({ ok: true, replayed: true, handoffId, turnJobId: existing.id, jobNo: existing.jobNo });
    return;
  }

  const [sourceJob] = await db.select().from(jobsTable).where(eq(jobsTable.id, sourceJobId)).limit(1);
  if (!sourceJob) {
    res.status(404).json({ error: "Source job not found." });
    return;
  }

  const suffix = handoffId.replace(/-/g, "").slice(-6).toUpperCase();

  const turnJob = await db.transaction(async (tx) => {
    const [created] = await tx.insert(jobsTable).values({
      id: handoffId,
      propertyId: sourceJob.propertyId,
      unitNo: sourceJob.unitNo,
      category: "Turn Handoff",
      description: summary,
      status: "open",
      boardStatus: "active",
      scheduleType: "flex",
      flexDueBy: sourceJob.flexDueBy ?? sourceJob.scheduledOn ?? localToday(),
      jobNo: `H-${suffix}`,
      crewLeaderId: null,
    }).returning();

    await tx.insert(jobLineItemsTable).values({
      jobId: created.id,
      priceItemId: null,
      service: summary,
      unit: "EA",
      rate: 0,
      qty: 1,
    });

    await tx.insert(activitiesTable).values({
      entityType: "job",
      entityId: sourceJobId,
      kind: "maintenance_handoff",
      body: JSON.stringify({
        handoffId,
        turnJobId: created.id,
        summary,
        detail,
        urgency,
        materialEstimate,
        createdByCrewId: crew.id,
        createdByCrewName: crew.name,
      }),
    });

    return created;
  });

  res.status(201).json({
    ok: true,
    replayed: false,
    handoffId,
    turnJobId: turnJob.id,
    jobNo: turnJob.jobNo,
  });
});


router.get("/native/v1/handoffs/open", async (req, res): Promise<void> => {
  const token = bearer(req);
  const crew = token ? await findCrewByPortalBearer(token) : null;
  if (!crew || crew.active === false) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }
  if (!canPickUpTurns(crew)) {
    res.json({ ok: true, handoffs: [] });
    return;
  }

  const rows = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        eq(jobsTable.category, "Turn Handoff"),
        eq(jobsTable.status, "open"),
        isNull(jobsTable.crewLeaderId),
      ),
    );

  res.json({
    ok: true,
    handoffs: rows.map((job) => ({
      id: job.id,
      jobNo: job.jobNo,
      propertyId: job.propertyId,
      unitNo: job.unitNo,
      category: job.category,
      description: job.description,
      status: job.status,
      boardStatus: job.boardStatus,
      flexDueBy: job.flexDueBy,
      priority: job.priority,
      createdAt: job.createdAt?.toISOString?.() ?? null,
    })),
  });
});

router.post("/native/v1/handoffs/:id/claim", async (req, res): Promise<void> => {
  const token = bearer(req);
  const crew = token ? await findCrewByPortalBearer(token) : null;
  if (!crew || crew.active === false) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }
  if (!canPickUpTurns(crew)) {
    res.status(403).json({ error: "This crew is not configured for Turn pickup." });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const jobId = typeof rawId === "string" ? rawId.trim() : "";
  if (!isUuid(jobId)) {
    res.status(400).json({ error: "Invalid handoff job." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, jobId))
      .for("update");

    if (!job || job.category !== "Turn Handoff") {
      return { status: 404 as const, error: "Handoff not found." };
    }
    if (job.crewLeaderId && job.crewLeaderId !== crew.id) {
      return { status: 409 as const, error: "Another crew already picked up this handoff." };
    }
    if (job.status !== "open") {
      return { status: 409 as const, error: "This handoff is no longer available." };
    }

    if (!job.crewLeaderId) {
      await tx
        .update(jobsTable)
        .set({
          crewLeaderId: crew.id,
          crewsFilled: 1,
          boardStatus: "filled",
        })
        .where(eq(jobsTable.id, jobId));

      await tx.insert(activitiesTable).values({
        entityType: "job",
        entityId: jobId,
        kind: "handoff_claimed",
        body: JSON.stringify({
          crewId: crew.id,
          crewName: crew.name,
          at: new Date().toISOString(),
        }),
      });
    }

    return { status: 200 as const };
  });

  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json({ ok: true, jobId, crewId: crew.id, crewName: crew.name });
});

export default router;
