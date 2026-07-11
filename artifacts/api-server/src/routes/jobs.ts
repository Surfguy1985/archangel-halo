import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  jobsTable,
  crewsTable,
  schedulesTable,
  propertiesTable,
  contactsTable,
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
  DeleteJobParams,
  DeleteJobResponse,
  ScheduleJobBody,
  ScheduleJobParams,
  ScheduleJobResponse,
  CompleteJobParams,
  CompleteJobResponse,
  DraftJobRecapParams,
  DraftJobRecapResponse,
  SendJobRecapParams,
  SendJobRecapBody,
  SendJobRecapResponse,
  ListCrewsResponse,
  CreateCrewBody,
  CreateCrewResponse,
  UpdateCrewBody,
  UpdateCrewParams,
  UpdateCrewResponse,
  DeleteCrewParams,
  DeleteCrewResponse,
} from "@workspace/api-zod";
import { completeText } from "../lib/ai";
import { sendEmail } from "../lib/email";
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

router.delete("/jobs/:id", async (req, res): Promise<void> => {
  const { id } = DeleteJobParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.id, id));
    if (!existing) {
      return { status: 404 as const, error: "Job not found" };
    }
    await tx.delete(schedulesTable).where(eq(schedulesTable.jobId, id));
    await tx.delete(jobsTable).where(eq(jobsTable.id, id));
    return { status: 200 as const };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(DeleteJobResponse.parse({ ok: true }));
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

async function gatherRecapContext(jobId: string) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) return null;
  const [prop] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, job.propertyId));
  const activities = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.entityId, jobId))
    .orderBy(desc(activitiesTable.createdAt));
  const notes = activities
    .filter((a) => a.kind === "note" && a.body)
    .map((a) => `- ${a.body}`);
  const photos = activities.filter(
    (a) => a.kind === "photo_before" || a.kind === "photo_after",
  );
  const beforeCount = photos.filter((a) => a.kind === "photo_before").length;
  const afterCount = photos.filter((a) => a.kind === "photo_after").length;
  return { job, prop, notes, beforeCount, afterCount };
}

router.post("/jobs/:id/recap", async (req, res): Promise<void> => {
  const { id } = DraftJobRecapParams.parse(req.params);
  const ctx = await gatherRecapContext(id);
  if (!ctx) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { job, prop, notes, beforeCount, afterCount } = ctx;
  const system =
    "You are HALO's recap writer for ArchAngel Contractors, a property maintenance company. " +
    "Write a warm, professional, client-ready work recap email that a property manager would receive after a job is finished. " +
    "Be concise (3-5 short sentences), specific about the work done, and reassuring about quality. " +
    "Do not invent details that are not provided. Do not include a subject line or email headers in the body. " +
    "Sign off as 'The ArchAngel Contractors team'. " +
    'Respond with ONLY valid JSON of the form {"subject": string, "body": string}. The body may use \\n for line breaks. No markdown.';
  const user = [
    `Property: ${prop?.name ?? "the property"}${job.unitNo ? `, Unit ${job.unitNo}` : ""}`,
    `Service category: ${job.category ?? "general maintenance"}`,
    `Work description: ${job.description ?? "n/a"}`,
    notes.length ? `Field notes:\n${notes.join("\n")}` : "Field notes: none",
    `Before photos on file: ${beforeCount}. After photos on file: ${afterCount}.`,
  ].join("\n");

  let draft: { subject: string; body: string };
  try {
    const raw = await completeText(system, user, 1024);
    const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const parsed = JSON.parse(fence ? fence[1].trim() : raw.trim()) as {
      subject?: string;
      body?: string;
    };
    draft = {
      subject:
        parsed.subject ??
        `Work completed at ${prop?.name ?? "your property"}`,
      body: parsed.body ?? "",
    };
  } catch {
    draft = {
      subject: `Work completed at ${prop?.name ?? "your property"}`,
      body:
        `Hi,\n\nWe've completed the ${job.category ?? "requested"} work${
          job.unitNo ? ` in Unit ${job.unitNo}` : ""
        } at ${prop?.name ?? "your property"}. ${job.description ?? ""}\n\n` +
        `Please let us know if you have any questions.\n\nThe ArchAngel Contractors team`,
    };
  }
  res.json(DraftJobRecapResponse.parse(draft));
});

router.post("/jobs/:id/recap/send", async (req, res): Promise<void> => {
  const { id } = SendJobRecapParams.parse(req.params);
  const body = SendJobRecapBody.parse(req.body);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  let to = body.to ?? null;
  if (!to) {
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.propertyId, job.propertyId));
    to = contacts.find((c) => c.email)?.email ?? null;
  }
  if (!to) {
    res.status(422).json({
      error:
        "No recipient found. This property has no contact email on file — add one or pass an explicit 'to' address.",
    });
    return;
  }
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#17181c;line-height:1.6;white-space:pre-wrap;">${body.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")}</div>`;
  const sent = await sendEmail({
    to,
    subject: body.subject,
    html,
  });
  if (!sent.ok) {
    res.status(502).json({
      error:
        sent.error ??
        "Email provider rejected the recap. Nothing was recorded — try again.",
    });
    return;
  }
  const [row] = await db
    .update(jobsTable)
    .set({ recapSentAt: new Date() })
    .where(eq(jobsTable.id, id))
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "email",
    body: `Recap sent to ${to}: ${body.subject}`,
  });
  const { propName, crewName } = await lookups();
  res.json(SendJobRecapResponse.parse(decorateJob(row, propName, crewName)));
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

router.patch("/crews/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCrewParams.parse(req.params);
  const body = UpdateCrewBody.parse(req.body);
  const [row] = await db
    .update(crewsTable)
    .set(body)
    .where(eq(crewsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Crew member not found" });
    return;
  }
  res.json(UpdateCrewResponse.parse(ser(row)));
});

router.delete("/crews/:id", async (req, res): Promise<void> => {
  const { id } = DeleteCrewParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: crewsTable.id })
      .from(crewsTable)
      .where(eq(crewsTable.id, id));
    if (!existing) {
      return { status: 404 as const, error: "Crew member not found" };
    }
    const assignedJobs = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.crewLeaderId, id));
    if (assignedJobs.length > 0) {
      return {
        status: 409 as const,
        error: `This crew member is leading ${assignedJobs.length} job${assignedJobs.length === 1 ? "" : "s"}. Reassign those first.`,
      };
    }
    await tx.delete(crewsTable).where(eq(crewsTable.id, id));
    return { status: 200 as const };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(DeleteCrewResponse.parse({ ok: true }));
});

export default router;
