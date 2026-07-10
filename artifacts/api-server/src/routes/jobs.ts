import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewsTable,
  schedulesTable,
  propertiesTable,
  activitiesTable,
  expensesTable,
} from "@workspace/db";
import {
  ListJobsResponse,
  ListJobsQueryParams,
  CreateJobBody,
  CreateJobResponse,
  GetJobParams,
  GetJobResponse,
  UpdateJobBody,
  UpdateJobParams,
  UpdateJobResponse,
  ScheduleJobBody,
  ScheduleJobParams,
  ScheduleJobResponse,
  CompleteJobParams,
  CompleteJobResponse,
  ListCrewsResponse,
  CreateCrewBody,
  CreateCrewResponse,
} from "@workspace/api-zod";
import { ser, serList } from "../lib/serialize";

const router: IRouter = Router();

async function lookups() {
  const [props, crews] = await Promise.all([
    db.select().from(propertiesTable),
    db.select().from(crewsTable),
  ]);
  return {
    propName: new Map(props.map((p) => [p.id, p.name])),
    crewName: new Map(crews.map((c) => [c.id, c.name])),
  };
}

function decorateJob(
  j: Record<string, unknown> & {
    propertyId: string;
    crewLeaderId: string | null;
  },
  propName: Map<string, string>,
  crewName: Map<string, string>,
) {
  return {
    ...ser(j),
    propertyName: propName.get(j.propertyId) ?? null,
    crewLeaderName: j.crewLeaderId
      ? (crewName.get(j.crewLeaderId) ?? null)
      : null,
  };
}

async function nextJobNo(): Promise<string> {
  const rows = await db.select().from(jobsTable);
  return `J-${String(2000 + rows.length + 1)}`;
}

router.get("/jobs", async (req, res): Promise<void> => {
  const { status, propertyId } = ListJobsQueryParams.parse(req.query);
  let rows = await db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt));
  if (status) rows = rows.filter((r) => r.status === status);
  if (propertyId) rows = rows.filter((r) => r.propertyId === propertyId);
  const { propName, crewName } = await lookups();
  res.json(
    ListJobsResponse.parse(rows.map((j) => decorateJob(j, propName, crewName))),
  );
});

router.post("/jobs", async (req, res): Promise<void> => {
  const body = CreateJobBody.parse(req.body);
  const [row] = await db
    .insert(jobsTable)
    .values({ ...body, jobNo: await nextJobNo() })
    .returning();
  const { propName, crewName } = await lookups();
  res
    .status(201)
    .json(CreateJobResponse.parse(decorateJob(row, propName, crewName)));
});

router.get("/jobs/:id", async (req, res): Promise<void> => {
  const { id } = GetJobParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { propName, crewName } = await lookups();
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.entityId, id))
    .orderBy(desc(activitiesTable.createdAt));
  const expenses = await db
    .select()
    .from(expensesTable)
    .where(eq(expensesTable.jobId, id));
  const schedules = await db
    .select()
    .from(schedulesTable)
    .where(eq(schedulesTable.jobId, id));
  res.json(
    GetJobResponse.parse({
      job: decorateJob(job, propName, crewName),
      activities: serList(activities),
      expenses: serList(expenses),
      schedules: serList(schedules),
    }),
  );
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const { id } = UpdateJobParams.parse(req.params);
  const body = UpdateJobBody.parse(req.body);
  const [row] = await db
    .update(jobsTable)
    .set(body)
    .where(eq(jobsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { propName, crewName } = await lookups();
  res.json(UpdateJobResponse.parse(decorateJob(row, propName, crewName)));
});

router.post("/jobs/:id/schedule", async (req, res): Promise<void> => {
  const { id } = ScheduleJobParams.parse(req.params);
  const body = ScheduleJobBody.parse(req.body);
  const [row] = await db
    .update(jobsTable)
    .set({
      scheduledOn: body.scheduledOn,
      crewLeaderId: body.crewLeaderId,
      status: "scheduled",
    })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  await db.insert(schedulesTable).values({
    jobId: id,
    scheduledOn: body.scheduledOn,
    windowStart: body.windowStart,
    crewLeaderId: body.crewLeaderId,
  });
  const { propName, crewName } = await lookups();
  res.json(ScheduleJobResponse.parse(decorateJob(row, propName, crewName)));
});

router.post("/jobs/:id/complete", async (req, res): Promise<void> => {
  const { id } = CompleteJobParams.parse(req.params);
  const [row] = await db
    .update(jobsTable)
    .set({ status: "complete", completedAt: new Date() })
    .where(eq(jobsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "completed",
    body: "Job marked complete",
  });
  const { propName, crewName } = await lookups();
  res.json(CompleteJobResponse.parse(decorateJob(row, propName, crewName)));
});

router.get("/crews", async (_req, res): Promise<void> => {
  const crews = await db.select().from(crewsTable);
  const today = new Date().toISOString().slice(0, 10);
  const schedules = await db.select().from(schedulesTable);
  const jobs = await db.select().from(jobsTable);
  const props = await db.select().from(propertiesTable);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  res.json(
    ListCrewsResponse.parse(
      crews.map((c) => {
        const todaySched = schedules.find(
          (s) => s.crewLeaderId === c.id && s.scheduledOn === today,
        );
        const job = todaySched ? jobById.get(todaySched.jobId) : undefined;
        return {
          ...ser(c),
          todayStatus: todaySched
            ? (todaySched.status === "done" ? "done" : "site")
            : "idle",
          todayJob: job?.jobNo ?? null,
          todayProperty: job ? (propName.get(job.propertyId) ?? null) : null,
        };
      }),
    ),
  );
});

router.post("/crews", async (req, res): Promise<void> => {
  const body = CreateCrewBody.parse(req.body);
  const [row] = await db.insert(crewsTable).values(body).returning();
  res.status(201).json(CreateCrewResponse.parse(ser(row)));
});

export default router;
