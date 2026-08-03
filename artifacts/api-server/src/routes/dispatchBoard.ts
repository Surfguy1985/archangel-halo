import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  crewsTable,
  crewDispatchAssignmentsTable,
  jobsTable,
  jobLineItemsTable,
  propertiesTable,
  activitiesTable,
} from "@workspace/db";
import {
  GetDispatchBoardParams,
  GetDispatchBoardResponse,
  CreateDispatchAssignmentBody,
  CreateDispatchAssignmentResponse,
  DeleteDispatchAssignmentParams,
  DeleteDispatchAssignmentResponse,
  RequestDispatchMoveParams,
  RequestDispatchMoveBody,
  RequestDispatchMoveResponse,
  UpdateDispatchChecklistParams,
  UpdateDispatchChecklistBody,
  UpdateDispatchChecklistResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const FINISHED = new Set(["complete", "paid", "cancelled"]);

type ChecklistItem = { id: string; text: string; done: boolean };

function readChecklist(raw: unknown): ChecklistItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (i): i is ChecklistItem =>
      !!i && typeof i === "object" && typeof (i as ChecklistItem).text === "string",
  );
}

// Seed the scope-of-work checklist from the job: line items first, then the
// free-form description split into steps.
export async function seedChecklist(jobId: string): Promise<ChecklistItem[]> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  const lineItems = await db
    .select()
    .from(jobLineItemsTable)
    .where(eq(jobLineItemsTable.jobId, jobId));
  const texts: string[] = [];
  for (const li of lineItems) {
    if (li.service && li.service !== "Quoted price") {
      texts.push(li.qty && li.qty > 1 ? `${li.service} ×${li.qty}` : li.service);
    }
  }
  const desc = job?.description ?? "";
  for (const part of desc.split(/\r?\n|•|;/)) {
    const t = part.replace(/^[-*\u2013\u2022]\s*/, "").trim();
    if (t && !texts.some((x) => x.toLowerCase() === t.toLowerCase())) texts.push(t);
  }
  return texts.slice(0, 12).map((text) => ({ id: randomUUID(), text, done: false }));
}

export function jobShortLabel(
  job: { jobNo: string; description: string | null } | undefined | null,
): string | null {
  if (!job) return null;
  const d = (job.description ?? "").trim();
  return d ? `${job.jobNo} — ${d.slice(0, 60)}` : job.jobNo;
}

// Latest check-in signal today per crew: "in" | "out" | null.
async function checkinStatusMap(): Promise<Map<string, "in" | "out">> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (crew_id) crew_id AS "crewId", kind
    FROM crew_checkins
    WHERE created_at >= ${dayStart}
    ORDER BY crew_id, created_at DESC
  `);
  const map = new Map<string, "in" | "out">();
  for (const r of (rows.rows ?? []) as unknown as { crewId: string; kind: string }[]) {
    map.set(r.crewId, r.kind === "checkout" ? "out" : "in");
  }
  return map;
}

type AssignmentRow = typeof crewDispatchAssignmentsTable.$inferSelect;

async function serializeAssignment(a: AssignmentRow) {
  const [member] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, a.memberId));
  const leader = member?.leaderId
    ? (
        await db.select().from(crewsTable).where(eq(crewsTable.id, member.leaderId))
      )[0]
    : undefined;
  const pendingJob = a.pendingJobId
    ? (await db.select().from(jobsTable).where(eq(jobsTable.id, a.pendingJobId)))[0]
    : undefined;
  const checkins = await checkinStatusMap();
  return {
    id: a.id,
    day: a.day,
    jobId: a.jobId,
    memberId: a.memberId,
    memberName: member?.name ?? "Crew member",
    selfiePath: member?.selfiePath ?? null,
    leaderId: member?.leaderId ?? null,
    leaderName: leader?.name ?? null,
    status: a.status,
    checklist: readChecklist(a.checklist),
    pendingJobId: a.pendingJobId ?? null,
    pendingJobLabel: jobShortLabel(pendingJob),
    checkinStatus: checkins.get(a.memberId) ?? null,
  };
}

router.get("/dispatch-board/:day", async (req, res): Promise<void> => {
  const { day } = GetDispatchBoardParams.parse(req.params);
  const [crews, jobs, props, assignments, checkins] = await Promise.all([
    db.select().from(crewsTable),
    db.select().from(jobsTable),
    db.select().from(propertiesTable),
    db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(eq(crewDispatchAssignmentsTable.day, day)),
    checkinStatusMap(),
  ]);
  const crewById = new Map(crews.map((c) => [c.id, c]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const propById = new Map(props.map((p) => [p.id, p]));

  // Active jobs for the day: scheduled that day, or open/in-progress without
  // conflicting date, that have member assignments that day.
  const assignedJobIds = new Set(assignments.map((a) => a.jobId));
  const dayJobs = jobs.filter((j) => {
    if (FINISHED.has(j.status)) return false;
    if (j.scheduledOn === day) return true;
    return assignedJobIds.has(j.id);
  });

  const assignmentsByJob = new Map<string, AssignmentRow[]>();
  for (const a of assignments) {
    const arr = assignmentsByJob.get(a.jobId) ?? [];
    arr.push(a);
    assignmentsByJob.set(a.jobId, arr);
  }
  const pendingJobLabels = new Map<string, string | null>();
  for (const a of assignments) {
    if (a.pendingJobId && !pendingJobLabels.has(a.pendingJobId)) {
      pendingJobLabels.set(a.pendingJobId, jobShortLabel(jobById.get(a.pendingJobId)));
    }
  }

  const serAssign = (a: AssignmentRow) => {
    const member = crewById.get(a.memberId);
    const leader = member?.leaderId ? crewById.get(member.leaderId) : undefined;
    return {
      id: a.id,
      day: a.day,
      jobId: a.jobId,
      memberId: a.memberId,
      memberName: member?.name ?? "Crew member",
      selfiePath: member?.selfiePath ?? null,
      leaderId: member?.leaderId ?? null,
      leaderName: leader?.name ?? null,
      status: a.status,
      checklist: readChecklist(a.checklist),
      pendingJobId: a.pendingJobId ?? null,
      pendingJobLabel: a.pendingJobId
        ? (pendingJobLabels.get(a.pendingJobId) ?? null)
        : null,
      checkinStatus: checkins.get(a.memberId) ?? null,
    };
  };

  const byProperty = new Map<string, typeof dayJobs>();
  for (const j of dayJobs) {
    const arr = byProperty.get(j.propertyId) ?? [];
    arr.push(j);
    byProperty.set(j.propertyId, arr);
  }
  const properties = [...byProperty.entries()]
    .map(([propertyId, propJobs]) => ({
      propertyId,
      propertyName: propById.get(propertyId)?.name ?? "Property",
      jobs: propJobs.map((j) => ({
        jobId: j.id,
        jobNo: j.jobNo,
        description: j.description ?? null,
        unitNo: j.unitNo ?? null,
        status: j.status,
        scheduledTime: j.scheduledTime ?? null,
        crewLeaderId: j.crewLeaderId ?? null,
        crewLeaderName: j.crewLeaderId
          ? (crewById.get(j.crewLeaderId)?.name ?? null)
          : null,
        assignments: (assignmentsByJob.get(j.id) ?? []).map(serAssign),
      })),
    }))
    .sort((a, b) => a.propertyName.localeCompare(b.propertyName));

  // Roster grouped by foreman; independents (no leader, not leading anyone) last.
  const activeCrews = crews.filter((c) => c.active !== false);
  const assignCountByMember = new Map<string, number>();
  for (const a of assignments) {
    assignCountByMember.set(a.memberId, (assignCountByMember.get(a.memberId) ?? 0) + 1);
  }
  const memberOut = (c: (typeof crews)[number]) => ({
    id: c.id,
    name: c.name,
    trade: c.trade ?? null,
    selfiePath: c.selfiePath ?? null,
    checkinStatus: checkins.get(c.id) ?? null,
    assignmentCount: assignCountByMember.get(c.id) ?? 0,
  });
  const leaders = activeCrews.filter(
    (c) => c.isLeader || activeCrews.some((m) => m.leaderId === c.id),
  );
  const teams = leaders.map((l) => ({
    leaderId: l.id,
    leaderName: l.name,
    leaderSelfiePath: l.selfiePath ?? null,
    members: [
      memberOut(l),
      ...activeCrews.filter((m) => m.leaderId === l.id && m.id !== l.id).map(memberOut),
    ],
  }));
  const grouped = new Set(teams.flatMap((t) => t.members.map((m) => m.id)));
  const independents = activeCrews.filter((c) => !grouped.has(c.id));
  if (independents.length > 0) {
    teams.push({
      leaderId: null as unknown as string,
      leaderName: null as unknown as string,
      leaderSelfiePath: null,
      members: independents.map(memberOut),
    });
  }

  res.json(GetDispatchBoardResponse.parse({ day, properties, teams }));
});

router.post("/dispatch-assignments", async (req, res): Promise<void> => {
  const body = CreateDispatchAssignmentBody.parse(req.body);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, body.jobId));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (FINISHED.has(job.status)) {
    res.status(409).json({ error: "This job is finished — it can't take assignments." });
    return;
  }
  const [member] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, body.memberId));
  if (!member) {
    res.status(404).json({ error: "Crew member not found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(crewDispatchAssignmentsTable)
    .where(
      and(
        eq(crewDispatchAssignmentsTable.memberId, body.memberId),
        eq(crewDispatchAssignmentsTable.day, body.day),
        eq(crewDispatchAssignmentsTable.jobId, body.jobId),
      ),
    );
  if (existing) {
    res.status(409).json({ error: `${member.name} is already on this job that day.` });
    return;
  }
  const checklist = await seedChecklist(body.jobId);
  let row: AssignmentRow;
  try {
    [row] = await db
      .insert(crewDispatchAssignmentsTable)
      .values({ day: body.day, jobId: body.jobId, memberId: body.memberId, checklist })
      .returning();
  } catch (e) {
    // Unique index (member, day, job): concurrent double-assign lands here.
    if ((e as { code?: string })?.code === "23505") {
      res.status(409).json({ error: `${member.name} is already on this job that day.` });
      return;
    }
    throw e;
  }
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: body.jobId,
    kind: "assigned",
    body: `${member.name} dispatched to job ${job.jobNo} for ${body.day}`,
  });
  res.status(201).json(CreateDispatchAssignmentResponse.parse(await serializeAssignment(row)));
});

router.delete("/dispatch-assignments/:id", async (req, res): Promise<void> => {
  const { id } = DeleteDispatchAssignmentParams.parse(req.params);
  const [row] = await db
    .delete(crewDispatchAssignmentsTable)
    .where(eq(crewDispatchAssignmentsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  res.json(DeleteDispatchAssignmentResponse.parse({ ok: true }));
});

// Move a member to another job. If the member reports to a foreman, the move
// waits as pending_move until the foreman approves it from their portal;
// otherwise it applies immediately.
router.post("/dispatch-assignments/:id/move", async (req, res): Promise<void> => {
  const { id } = RequestDispatchMoveParams.parse(req.params);
  const body = RequestDispatchMoveBody.parse(req.body);
  const [a] = await db
    .select()
    .from(crewDispatchAssignmentsTable)
    .where(eq(crewDispatchAssignmentsTable.id, id));
  if (!a) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  if (a.jobId === body.toJobId) {
    res.status(409).json({ error: "The member is already on that job." });
    return;
  }
  if (a.status === "pending_move") {
    res.status(409).json({
      error: "A move is already waiting on the foreman. Let them decide first.",
    });
    return;
  }
  const [target] = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.id, body.toJobId));
  if (!target) {
    res.status(404).json({ error: "Target job not found" });
    return;
  }
  if (FINISHED.has(target.status)) {
    res.status(409).json({ error: "That job is finished — it can't take a member." });
    return;
  }
  const [dupe] = await db
    .select()
    .from(crewDispatchAssignmentsTable)
    .where(
      and(
        eq(crewDispatchAssignmentsTable.memberId, a.memberId),
        eq(crewDispatchAssignmentsTable.day, a.day),
        eq(crewDispatchAssignmentsTable.jobId, body.toJobId),
      ),
    );
  if (dupe) {
    res.status(409).json({ error: "The member already has an assignment on that job that day." });
    return;
  }
  const [member] = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.id, a.memberId));
  const hasForeman = !!member?.leaderId && member.leaderId !== member.id;
  let row: AssignmentRow;
  if (hasForeman) {
    // Guarded transition: only an "assigned" row can enter pending_move, so a
    // concurrent request can't silently replace an in-flight move.
    [row] = await db
      .update(crewDispatchAssignmentsTable)
      .set({
        status: "pending_move",
        pendingJobId: body.toJobId,
        moveRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(crewDispatchAssignmentsTable.id, id),
          eq(crewDispatchAssignmentsTable.status, "assigned"),
        ),
      )
      .returning();
    if (!row) {
      res.status(409).json({
        error: "A move is already waiting on the foreman. Let them decide first.",
      });
      return;
    }
    const [fromJob] = await db.select().from(jobsTable).where(eq(jobsTable.id, a.jobId));
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: body.toJobId,
      kind: "flag",
      body: `Move requested: ${member!.name} from job ${fromJob?.jobNo ?? "?"} to job ${target.jobNo} — awaiting foreman approval`,
    });
  } else {
    const checklist = await seedChecklist(body.toJobId);
    [row] = await db
      .update(crewDispatchAssignmentsTable)
      .set({
        jobId: body.toJobId,
        status: "assigned",
        checklist,
        pendingJobId: null,
        moveRequestedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(crewDispatchAssignmentsTable.id, id),
          eq(crewDispatchAssignmentsTable.status, "assigned"),
          eq(crewDispatchAssignmentsTable.jobId, a.jobId),
        ),
      )
      .returning();
    if (!row) {
      res.status(409).json({ error: "This assignment just changed — refresh and try again." });
      return;
    }
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: body.toJobId,
      kind: "assigned",
      body: `${member?.name ?? "Crew member"} moved to job ${target.jobNo} for ${a.day}`,
    });
  }
  res.json(RequestDispatchMoveResponse.parse(await serializeAssignment(row)));
});

router.patch("/dispatch-assignments/:id/checklist", async (req, res): Promise<void> => {
  const { id } = UpdateDispatchChecklistParams.parse(req.params);
  const body = UpdateDispatchChecklistBody.parse(req.body);
  const [row] = await db
    .update(crewDispatchAssignmentsTable)
    .set({ checklist: body.items, updatedAt: new Date() })
    .where(eq(crewDispatchAssignmentsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Assignment not found" });
    return;
  }
  res.json(UpdateDispatchChecklistResponse.parse(await serializeAssignment(row)));
});

export default router;
