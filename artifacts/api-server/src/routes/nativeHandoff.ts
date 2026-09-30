import { Router, type IRouter, type Request } from "express";
import { eq } from "drizzle-orm";
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

export default router;
