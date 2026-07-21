import { Router, type IRouter } from "express";
import { randomBytes } from "crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewsTable,
  jobBroadcastsTable,
  schedulesTable,
  propertiesTable,
  priceItemsTable,
  activitiesTable,
} from "@workspace/db";
import {
  ListJobBoardResponse,
  BroadcastJobParams,
  BroadcastJobBody,
  BroadcastJobResponse,
  ReopenJobParams,
  ReopenJobResponse,
  UnlistJobParams,
  UnlistJobResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";

const router: IRouter = Router();

router.get("/job-board", async (_req, res): Promise<void> => {
  const [jobs, props, priceItems, broadcasts, crews, photoActs] =
    await Promise.all([
      db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)),
      db.select().from(propertiesTable),
      db.select().from(priceItemsTable),
      db.select().from(jobBroadcastsTable).orderBy(desc(jobBroadcastsTable.sentAt)),
      db.select().from(crewsTable),
      db
        .select()
        .from(activitiesTable)
        .where(eq(activitiesTable.entityType, "job"))
        .orderBy(desc(activitiesTable.createdAt)),
    ]);

  const propsById = new Map(props.map((p) => [p.id, p]));
  const crewsById = new Map(crews.map((c) => [c.id, c]));
  const priceByProp = new Map<string, typeof priceItems>();
  for (const pi of priceItems) {
    const list = priceByProp.get(pi.propertyId) ?? [];
    list.push(pi);
    priceByProp.set(pi.propertyId, list);
  }
  const photosByJob = new Map<string, { kind: string | null; storagePath: string }[]>();
  for (const a of photoActs) {
    if (!a.storagePath) continue;
    if (a.kind !== "photo_before" && a.kind !== "photo_after") continue;
    const list = photosByJob.get(a.entityId) ?? [];
    list.push({ kind: a.kind, storagePath: a.storagePath });
    photosByJob.set(a.entityId, list);
  }
  const broadcastsByJob = new Map<string, typeof broadcasts>();
  for (const b of broadcasts) {
    const list = broadcastsByJob.get(b.jobId) ?? [];
    list.push(b);
    broadcastsByJob.set(b.jobId, list);
  }

  const cards = jobs.filter((j) => j.boardStatus !== "removed").map((j) => {
    const prop = propsById.get(j.propertyId);
    const boardStatus =
      j.status === "complete" ? "completed" : (j.boardStatus ?? "active");
    return {
      job: {
        ...ser(j),
        boardStatus,
        propertyName: prop?.name ?? null,
        crewLeaderName: j.crewLeaderId
          ? (crewsById.get(j.crewLeaderId)?.name ?? null)
          : null,
      },
      priceItems: (priceByProp.get(j.propertyId) ?? []).map((pi) => ser(pi)),
      photos: photosByJob.get(j.id) ?? [],
      broadcasts: (broadcastsByJob.get(j.id) ?? [])
        .filter((b) => b.status !== "withdrawn")
        .map((b) => ({
          id: b.id,
          crewId: b.crewId,
          crewName: crewsById.get(b.crewId)?.name ?? "Unknown crew",
          trade: crewsById.get(b.crewId)?.trade ?? null,
          status: b.status,
          sentAt: b.sentAt ? b.sentAt.toISOString() : null,
          respondedAt: b.respondedAt ? b.respondedAt.toISOString() : null,
        })),
    };
  });

  res.json(ListJobBoardResponse.parse(cards));
});

router.post("/jobs/:id/broadcast", async (req, res): Promise<void> => {
  const { id } = BroadcastJobParams.parse(req.params);
  const body = BroadcastJobBody.parse(req.body);

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status === "complete" || job.boardStatus === "completed") {
    res.status(409).json({ error: "Job is already completed" });
    return;
  }

  const crews = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.active, true));

  let targets = crews;
  if (body.mode === "trade") {
    const wanted = (body.trade ?? "").trim().toLowerCase();
    if (!wanted) {
      res.status(400).json({ error: "Select a trade to broadcast to" });
      return;
    }
    targets = crews.filter((c) => (c.trade ?? "").trim().toLowerCase() === wanted);
  } else if (body.mode === "crews") {
    const ids = new Set(body.crewIds ?? []);
    if (ids.size === 0) {
      res.status(400).json({ error: "Select at least one crew" });
      return;
    }
    targets = crews.filter((c) => ids.has(c.id));
  }

  if (targets.length === 0) {
    res.status(400).json({ error: "No matching active crews to broadcast to" });
    return;
  }

  const existing = await db
    .select()
    .from(jobBroadcastsTable)
    .where(
      and(
        eq(jobBroadcastsTable.jobId, id),
        inArray(
          jobBroadcastsTable.crewId,
          targets.map((c) => c.id),
        ),
      ),
    );
  const activeExisting = new Set(
    existing
      .filter((b) => b.status === "pending" || b.status === "approved")
      .map((b) => b.crewId),
  );

  const toSend = targets.filter((c) => !activeExisting.has(c.id));
  const sentNames: string[] = [];
  // Crews with a resolved offer (declined/withdrawn) get their existing row
  // reset to pending instead of a duplicate row per (job, crew).
  const resolvedExisting = new Map(
    existing
      .filter((b) => b.status === "declined" || b.status === "withdrawn")
      .map((b) => [b.crewId, b.id]),
  );

  for (const crew of toSend) {
    // Every recipient needs a live link — mint one if the crew doesn't have it yet.
    if (!crew.portalToken) {
      const token = randomBytes(24).toString("base64url");
      await db
        .update(crewsTable)
        .set({ portalToken: token })
        .where(eq(crewsTable.id, crew.id));
    }
    const priorId = resolvedExisting.get(crew.id);
    if (priorId) {
      await db
        .update(jobBroadcastsTable)
        .set({ status: "pending", sentAt: new Date(), respondedAt: null })
        .where(eq(jobBroadcastsTable.id, priorId));
    } else {
      await db.insert(jobBroadcastsTable).values({
        jobId: id,
        crewId: crew.id,
        status: "pending",
      });
    }
    sentNames.push(crew.name);
  }

  if (
    toSend.length > 0 &&
    (job.boardStatus === "reopened" || job.boardStatus === "removed")
  ) {
    await db
      .update(jobsTable)
      .set({ boardStatus: "active" })
      .where(eq(jobsTable.id, id));
  }

  res.json(
    BroadcastJobResponse.parse({
      sent: toSend.length,
      alreadySent: targets.length - toSend.length,
      crewNames: sentNames,
    }),
  );
});

router.post("/jobs/:id/unlist", async (req, res): Promise<void> => {
  const { id } = UnlistJobParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!job) return { status: 404 as const, error: "Job not found" };
    if (job.boardStatus === "filled") {
      return {
        status: 409 as const,
        error: "This job is filled. Reopen it first, then remove the posting.",
      };
    }

    // Withdraw every live offer so the posting disappears from crew portals.
    const live = await tx
      .select()
      .from(jobBroadcastsTable)
      .where(
        and(
          eq(jobBroadcastsTable.jobId, id),
          inArray(jobBroadcastsTable.status, ["pending", "approved"]),
        ),
      );
    for (const b of live) {
      await tx
        .update(jobBroadcastsTable)
        .set({ status: "withdrawn", respondedAt: new Date() })
        .where(eq(jobBroadcastsTable.id, b.id));
      if (b.status === "approved") {
        await tx
          .delete(schedulesTable)
          .where(
            and(
              eq(schedulesTable.jobId, id),
              eq(schedulesTable.crewLeaderId, b.crewId),
            ),
          );
      }
    }

    await tx
      .update(jobsTable)
      .set({ boardStatus: "removed" })
      .where(eq(jobsTable.id, id));
    return { status: 200 as const };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(UnlistJobResponse.parse({ ok: true }));
});

router.post("/jobs/:id/reopen", async (req, res): Promise<void> => {
  const { id } = ReopenJobParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!job) return { status: 404 as const, error: "Job not found" };

    const approved = await tx
      .select()
      .from(jobBroadcastsTable)
      .where(
        and(
          eq(jobBroadcastsTable.jobId, id),
          eq(jobBroadcastsTable.status, "approved"),
        ),
      );

    // Withdraw the fill: the previously approved crew comes off the job + calendar.
    for (const b of approved) {
      await tx
        .update(jobBroadcastsTable)
        .set({ status: "withdrawn", respondedAt: new Date() })
        .where(eq(jobBroadcastsTable.id, b.id));
      await tx
        .delete(schedulesTable)
        .where(
          and(
            eq(schedulesTable.jobId, id),
            eq(schedulesTable.crewLeaderId, b.crewId),
          ),
        );
    }

    const [row] = await tx
      .update(jobsTable)
      .set({
        boardStatus: "reopened",
        crewLeaderId: approved.length > 0 ? null : job.crewLeaderId,
        status: job.status === "scheduled" ? "open" : job.status,
        completedAt: null,
      })
      .where(eq(jobsTable.id, id))
      .returning();
    return { status: 200 as const, job: row! };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  const [props, crews] = await Promise.all([
    db.select().from(propertiesTable),
    db.select().from(crewsTable),
  ]);
  const prop = props.find((p) => p.id === result.job.propertyId);
  res.json(
    ReopenJobResponse.parse({
      ...ser(result.job),
      propertyName: prop?.name ?? null,
      crewLeaderName: result.job.crewLeaderId
        ? (crews.find((c) => c.id === result.job.crewLeaderId)?.name ?? null)
        : null,
    }),
  );
});

export default router;
