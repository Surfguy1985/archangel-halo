import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { emitFalkonEvent } from "../lib/falkonEmit";
import { stampJobClientPo } from "../lib/clientPoStamp";
import { mintPortalToken, portalTokenColumns } from "../lib/portalToken";
import { assertFalkonBoundary, handleBoundaryError } from "../lib/falkonBoundary";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import {
  db,
  jobsTable,
  recapSharesTable,
  crewsTable,
  jobBroadcastsTable,
  schedulesTable,
  crewMessagesTable,
  crewCheckinsTable,
  crewTrackPointsTable,
  crewRoutePlansTable,
  crewDispatchAssignmentsTable,
  crewDocumentsTable,
  crewPacketsTable,
  crewPaymentsTable,
  crewPhotosTable,
  walkCapturesTable,
  photoSharesTable,
  propertiesTable,
  contactsTable,
  activitiesTable,
  expensesTable,
  priceItemsTable,
  jobLineItemsTable,
  businessSettingsTable,
  invoicesTable,
  jobSummariesTable,
  crewPayHoldsTable,
  notificationsTable,
  wingMembersTable,
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
  DispatchJobBody,
  DispatchJobParams,
  DispatchJobResponse,
  CompleteJobParams,
  CompleteJobResponse,
  ReopenJobChangeOrderParams,
  ReopenJobChangeOrderResponse,
  ListJobEventsParams,
  ListJobEventsResponse,
  DraftJobRecapParams,
  DraftJobRecapResponse,
  SendJobRecapParams,
  SendJobRecapBody,
  SendJobRecapResponse,
  CreateRecapShareParams,
  CreateRecapShareBody,
  CreateRecapShareResponse,
  GetRecapShareParams,
  GetRecapShareResponse,
  CreateJobTrackerShareParams,
  CreateJobTrackerShareResponse,
  GetJobReportPdfParams,
  ListCrewsResponse,
  CreateCrewBody,
  CreateCrewResponse,
  UpdateCrewBody,
  UpdateCrewParams,
  UpdateCrewAccessParams,
  UpdateCrewAccessBody,
  UpdateCrewAccessResponse,
  UpdateCrewResponse,
  DeleteCrewParams,
  DeleteCrewResponse,
  AddJobLineItemParams,
  AddJobLineItemBody,
  AddJobLineItemResponse,
  UpdateJobLineItemParams,
  UpdateJobLineItemBody,
  SwapJobLineItemParams,
  SwapJobLineItemBody,
  SwapJobLineItemResponse,
  UpdateJobLineItemResponse,
  DeleteJobLineItemParams,
  DeleteJobLineItemResponse,
  QuickCreateJobBody,
  QuickCreateJobResponse,
  GetStaffingContextResponse,
  PullCrewToJobParams,
  PullCrewToJobBody,
  PullCrewToJobResponse,
} from "@workspace/api-zod";
import {
  ClearJobParams,
  ClearJobResponse,
  RestartJobParams,
  RestartJobResponse,
  CloseOutJobParams,
  CloseOutJobResponse,
} from "@workspace/api-zod";
import { completeText } from "../lib/ai";
import { sendEmail, sendCrewThankYouEmail } from "../lib/email";
import { getAutoEmails } from "../lib/emailPolicy";
import { logger } from "../lib/logger";
import { ser, serList } from "../lib/serialize";
import { crewPhotosForJobs, type CrewJobPhoto } from "../lib/jobPhotos";
import { gatherJobReport, buildJobReportPdf } from "../lib/jobReportPdf";
import { recomputeJobFinancials } from "../lib/jobFinance";
import { syncJobLaborLedger, removeEntriesForRef } from "../lib/ledger";
import { EMERGENCY_PAY_NOTE_PREFIX } from "../lib/emergencySettlement";
import { raiseClientCard } from "../lib/clientBoard";
import { emitBoardEvent } from "../lib/boardEvents";
import { localToday } from "../lib/localDate";

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
  const [{ propName, crewName }, lineItems] = await Promise.all([
    lookups(),
    db.select().from(jobLineItemsTable),
  ]);
  // Distinct service names per job so dispatch/calendar tiles can show the
  // exact work sold instead of a generic category.
  const servicesByJob = new Map<string, string[]>();
  for (const li of lineItems) {
    if (!li.service || li.service === "Quoted price") continue;
    const list = servicesByJob.get(li.jobId) ?? [];
    if (!list.includes(li.service)) list.push(li.service);
    servicesByJob.set(li.jobId, list);
  }
  res.json(
    ListJobsResponse.parse(
      rows.map((j) => ({
        ...decorateJob(j, propName, crewName),
        services: servicesByJob.get(j.id) ?? null,
      })),
    ),
  );
});

router.post("/jobs", async (req, res): Promise<void> => {
  const body = CreateJobBody.parse(req.body);
  if (body.isRecurring && !body.recurrence) {
    res.status(400).json({ error: "Pick how often the recurring job repeats." });
    return;
  }
  if (!body.isRecurring) body.recurrence = undefined;
  const { flexDays, ...rest } = body;
  const scheduleType = body.scheduleType === "flex" ? "flex" : "scheduled";
  let flexDueBy: string | null = null;
  let scheduledOn = rest.scheduledOn ?? undefined;
  let scheduledTime = rest.scheduledTime ?? undefined;
  if (scheduleType === "flex") {
    // Flex: crew works on their own time before a deadline computed from
    // "days from today" using LOCAL date parts (never UTC).
    const days = Math.max(1, Math.round(flexDays ?? 7));
    const d = new Date();
    d.setDate(d.getDate() + days);
    flexDueBy = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    scheduledOn = undefined;
    scheduledTime = undefined;
  }
  const [row] = await db
    .insert(jobsTable)
    .values({
      ...rest,
      scheduleType,
      scheduledOn,
      scheduledTime,
      flexDueBy,
      jobNo: await nextJobNo(),
    })
    .returning();
  const { propName, crewName } = await lookups();
  // Emit Falkon event (fire-and-forget — never blocks the response)
  void emitFalkonEvent("job.created", "job", row!.id, {
    jobId: row!.id,
    jobNo: row!.jobNo,
    propertyId: row!.propertyId,
    unitNo: row!.unitNo,
    description: row!.description,
    scheduledOn: row!.scheduledOn,
    scheduleType: row!.scheduleType,
  });
  res
    .status(201)
    .json(CreateJobResponse.parse(decorateJob(row, propName, crewName)));
});

// One-shot on-site job creation: property + unit + work + price-book line
// items + quoted price + due date in a single call, so the operator can
// build a job mid-walkthrough and staff it immediately from the same sheet.
router.post("/jobs/quick", async (req, res): Promise<void> => {
  const body = QuickCreateJobBody.parse(req.body);
  const [property] = await db
    .select({ id: propertiesTable.id })
    .from(propertiesTable)
    .where(eq(propertiesTable.id, body.propertyId));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  let pickedItems: (typeof priceItemsTable.$inferSelect)[] = [];
  if (body.priceItemIds && body.priceItemIds.length > 0) {
    const rows = await db
      .select()
      .from(priceItemsTable)
      .where(inArray(priceItemsTable.id, body.priceItemIds));
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const pid of body.priceItemIds) {
      const item = byId.get(pid);
      if (!item) {
        res.status(400).json({ error: "Price item not found" });
        return;
      }
      if (item.propertyId !== body.propertyId) {
        res
          .status(400)
          .json({ error: "Price item belongs to a different property" });
        return;
      }
      pickedItems.push(item);
    }
  }
  const jobNo = await nextJobNo();
  const row = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(jobsTable)
      .values({
        propertyId: body.propertyId,
        description: body.description.trim(),
        unitNo: body.unitNo?.trim() || null,
        scheduleType: "scheduled",
        scheduledOn: body.dueOn || null,
        jobNo,
      })
      .returning();
    // Tapped price-book pills become line items; duplicates bump qty.
    const qtyByItem = new Map<string, { item: (typeof pickedItems)[number]; qty: number }>();
    for (const item of pickedItems) {
      const cur = qtyByItem.get(item.id);
      if (cur) cur.qty += 1;
      else qtyByItem.set(item.id, { item, qty: 1 });
    }
    for (const { item, qty } of qtyByItem.values()) {
      await tx.insert(jobLineItemsTable).values({
        jobId: job.id,
        priceItemId: item.id,
        service: item.service,
        unit: item.unit,
        rate: item.rate,
        qty,
      });
    }
    // A free-form quoted price becomes a custom line item so it flows into
    // invoicing like any other priced work.
    if (body.price != null && body.price > 0) {
      await tx.insert(jobLineItemsTable).values({
        jobId: job.id,
        priceItemId: null,
        service: "Quoted price",
        rate: body.price,
        qty: 1,
      });
    }
    await tx.insert(activitiesTable).values({
      entityType: "job",
      entityId: job.id,
      kind: "created",
      body: `Job ${job.jobNo} created on-site via quick job sheet`,
    });
    return job;
  });
  const { propName, crewName } = await lookups();
  // Return the created line items too, so the quick-job sheet can staff each
  // service (specialty dropdowns + staggered start times) without a refetch.
  const createdItems = await db
    .select()
    .from(jobLineItemsTable)
    .where(eq(jobLineItemsTable.jobId, row.id));
  res.status(201).json(
    QuickCreateJobResponse.parse({
      ...decorateJob(row, propName, crewName),
      lineItems: createdItems.map((li) => ({ ...serLineItem(li), assignedCrewName: null })),
    }),
  );
});

// Staffing context for the quick job sheet: every active crew with their
// current active job (if any), so the operator can assign or pull-off.
router.get("/staffing", async (_req, res): Promise<void> => {
  const today = localToday();
  const [crews, jobs, props, schedules] = await Promise.all([
    db.select().from(crewsTable),
    db.select().from(jobsTable).orderBy(desc(jobsTable.createdAt)),
    db.select().from(propertiesTable),
    db
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.scheduledOn, today)),
  ]);
  const propName = new Map(props.map((p) => [p.id, p.name]));
  const activeJobByCrew = new Map<string, (typeof jobs)[number]>();
  for (const j of jobs) {
    if (!j.crewLeaderId) continue;
    if (j.status === "complete" || j.status === "paid" || j.status === "cancelled") continue;
    if (!activeJobByCrew.has(j.crewLeaderId)) activeJobByCrew.set(j.crewLeaderId, j);
  }
  res.json(
    GetStaffingContextResponse.parse(
      crews
        .filter((c) => c.active !== false)
        .map((c) => {
          const sched = schedules.find((s) => s.crewLeaderId === c.id);
          const job = activeJobByCrew.get(c.id);
          return {
            id: c.id,
            name: c.name,
            trade: c.trade ?? null,
            selfiePath: c.selfiePath ?? null,
            services: Array.isArray(c.services)
              ? (c.services as { name?: unknown }[])
                  .map((s) => (typeof s?.name === "string" ? s.name : null))
                  .filter((n): n is string => Boolean(n))
              : [],
            todayStatus: sched ? (sched.status === "done" ? "done" : "site") : "idle",
            currentJob: job
              ? {
                  id: job.id,
                  jobNo: job.jobNo,
                  description: job.description ?? null,
                  propertyName: propName.get(job.propertyId) ?? null,
                  scheduledOn: job.scheduledOn ?? null,
                  status: job.status,
                }
              : null,
          };
        }),
    ),
  );
});

// Pull a crew off their current job onto this one. Transactional: the
// vacated job is flagged (crewVacatedAt) so Today shows "lost its crew"
// until someone restaffs it — nothing goes uncrewed silently.
router.post("/jobs/:id/pull-crew", async (req, res): Promise<void> => {
  const { id } = PullCrewToJobParams.parse(req.params);
  const body = PullCrewToJobBody.parse(req.body);
  if (body.fromJobId === id) {
    res.status(409).json({ error: "The crew is already on this job." });
    return;
  }
  try {
    await assertFalkonBoundary("reassign_crew");
  } catch (err) {
    if (handleBoundaryError(err, res)) return;
    throw err;
  }
  const result = await db.transaction(async (tx) => {
    const [target] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .for("update");
    if (!target) return { status: 404 as const, error: "Job not found" };
    if (target.status === "complete" || target.status === "paid" || target.status === "cancelled") {
      return { status: 409 as const, error: "This job is already finished — it can't take a crew." };
    }
    const [crew] = await tx
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, body.crewId));
    if (!crew) return { status: 404 as const, error: "Crew not found" };
    // Guarded vacate: only succeeds if the crew is still on the source job,
    // so two concurrent pulls can't both claim the same crew.
    const [vacated] = await tx
      .update(jobsTable)
      .set({ crewLeaderId: null, crewVacatedAt: new Date() })
      .where(
        and(
          eq(jobsTable.id, body.fromJobId),
          eq(jobsTable.crewLeaderId, body.crewId),
        ),
      )
      .returning();
    if (!vacated) {
      return {
        status: 409 as const,
        error: "That crew is no longer on the job you're pulling from.",
      };
    }
    // Take the crew off the vacated job's calendar and portal.
    await tx
      .delete(schedulesTable)
      .where(
        and(
          eq(schedulesTable.jobId, body.fromJobId),
          eq(schedulesTable.crewLeaderId, body.crewId),
        ),
      );
    await tx
      .update(jobBroadcastsTable)
      .set({ status: "withdrawn", respondedAt: new Date() })
      .where(
        and(
          eq(jobBroadcastsTable.jobId, body.fromJobId),
          eq(jobBroadcastsTable.crewId, body.crewId),
          inArray(jobBroadcastsTable.status, ["pending", "approved"]),
        ),
      );
    // Assign here — with the same board-sync mirrors as a manual assignment.
    const [assigned] = await tx
      .update(jobsTable)
      .set({
        crewLeaderId: body.crewId,
        crewVacatedAt: null,
        boardStatus:
          target.boardStatus === "removed" || target.boardStatus === "completed"
            ? target.boardStatus
            : "filled",
        status: target.status === "open" && target.scheduledOn ? "scheduled" : target.status,
      })
      .where(eq(jobsTable.id, id))
      .returning();
    await tx
      .update(jobBroadcastsTable)
      .set({ status: "withdrawn", respondedAt: new Date() })
      .where(
        and(
          eq(jobBroadcastsTable.jobId, id),
          eq(jobBroadcastsTable.status, "pending"),
        ),
      );
    await tx
      .update(schedulesTable)
      .set({ crewLeaderId: body.crewId })
      .where(
        and(
          eq(schedulesTable.jobId, id),
          ne(schedulesTable.crewLeaderId, body.crewId),
        ),
      );
    // Mirror onto the calendar so the crew's portal schedule shows it.
    if (assigned!.scheduledOn) {
      const existing = await tx
        .select({ id: schedulesTable.id })
        .from(schedulesTable)
        .where(
          and(
            eq(schedulesTable.jobId, id),
            eq(schedulesTable.crewLeaderId, body.crewId),
          ),
        );
      if (existing.length === 0) {
        await tx.insert(schedulesTable).values({
          jobId: id,
          scheduledOn: assigned!.scheduledOn,
          crewLeaderId: body.crewId,
        });
      }
    }
    await tx.insert(activitiesTable).values([
      {
        entityType: "job",
        entityId: id,
        kind: "assigned",
        body: `${crew.name} pulled onto job ${assigned!.jobNo} from job ${vacated.jobNo}`,
      },
      {
        entityType: "job",
        entityId: body.fromJobId,
        kind: "flag",
        body: `Job ${vacated.jobNo} lost its crew — ${crew.name} was pulled onto job ${assigned!.jobNo}`,
      },
    ]);
    return { status: 200 as const, job: assigned!, vacatedJob: vacated };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  // Live sync: both properties' client boards mirror the vendor board move.
  emitBoardEvent(result.job.propertyId);
  if (result.vacatedJob.propertyId !== result.job.propertyId)
    emitBoardEvent(result.vacatedJob.propertyId);
  const { propName, crewName } = await lookups();
  res.json(
    PullCrewToJobResponse.parse({
      job: decorateJob(result.job, propName, crewName),
      vacatedJob: decorateJob(result.vacatedJob, propName, crewName),
    }),
  );
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
  const crewPhotos = await crewPhotosForJobs([job]);
  res.json(
    GetJobResponse.parse({
      job: decorateJob(job, propName, crewName),
      activities: serList(activities),
      expenses: serList(expenses),
      schedules: serList(schedules),
      crewPhotos,
    }),
  );
});

router.patch("/jobs/:id", async (req, res): Promise<void> => {
  const { id } = UpdateJobParams.parse(req.params);
  const body = UpdateJobBody.parse(req.body);
  if (body.isRecurring === true && body.recurrence == null) {
    res.status(400).json({ error: "Pick how often the recurring job repeats." });
    return;
  }
  if (body.isRecurring === false) body.recurrence = null;
  // Same Done→Billing gate as /jobs/:id/complete: setting status "complete"
  // via PATCH must not bypass the required client PO.
  if (body.status === "complete") {
    const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const po = (typeof body.poNumber === "string" ? body.poNumber : existing.poNumber) ?? "";
    if (!po.trim()) {
      res.status(409).json({
        error: "This job doesn't look finished yet.",
        missing: ["A client PO number is required before this job can move to Billing."],
        missingCodes: ["po"],
      });
      return;
    }
  }
  const row = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(jobsTable).where(eq(jobsTable.id, id));
    if (!before) return undefined;
    // Any crew assignment clears the "lost its crew" flag.
    const patch: Record<string, unknown> = { ...body };
    if (typeof body.crewLeaderId === "string" && body.crewLeaderId) patch.crewVacatedAt = null;
    // completedAt must ride the status change. /jobs/:id/complete stamps it,
    // and reporting (average turn time, close-out reads) keys off it — so a job
    // finished through this generic PATCH has to be stamped the same way, and
    // un-stamped when it is moved back to unfinished work.
    if (typeof body.status === "string") {
      if (body.status === "complete") patch.completedAt = before.completedAt ?? new Date();
      else if (!["paid", "cancelled"].includes(body.status)) patch.completedAt = null;
    }
    const [updated] = await tx
      .update(jobsTable)
      .set(patch)
      .where(eq(jobsTable.id, id))
      .returning();
    if (!updated) return undefined;
    if (typeof body.crewLeaderId !== "string" || !body.crewLeaderId) {
      return updated;
    }
    // Manual crew assignment — keep the job board in sync atomically: mark
    // the job filled (unless removed) and withdraw any still-pending offers.
    let fresh = updated;
    if (updated.boardStatus !== "removed" && updated.boardStatus !== "filled") {
      const [synced] = await tx
        .update(jobsTable)
        .set({ boardStatus: "filled" })
        .where(
          and(
            eq(jobsTable.id, id),
            ne(jobsTable.boardStatus, "removed"),
            ne(jobsTable.boardStatus, "filled"),
          ),
        )
        .returning();
      if (synced) fresh = synced;
    }
    await tx
      .update(jobBroadcastsTable)
      .set({ status: "withdrawn", respondedAt: new Date() })
      .where(
        and(
          eq(jobBroadcastsTable.jobId, id),
          eq(jobBroadcastsTable.status, "pending"),
        ),
      );
    // Revoke the previous crew's access artifacts so the old crew's portal
    // no longer shows (or can act on) this job after a manual reassignment.
    await tx
      .update(jobBroadcastsTable)
      .set({ status: "withdrawn", respondedAt: new Date() })
      .where(
        and(
          eq(jobBroadcastsTable.jobId, id),
          eq(jobBroadcastsTable.status, "approved"),
          ne(jobBroadcastsTable.crewId, body.crewLeaderId),
        ),
      );
    await tx
      .update(schedulesTable)
      .set({ crewLeaderId: body.crewLeaderId })
      .where(
        and(
          eq(schedulesTable.jobId, id),
          ne(schedulesTable.crewLeaderId, body.crewLeaderId),
        ),
      );
    return fresh;
  });
  if (!row) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  let fresh = row;
  if ("crewRate" in body) {
    await recomputeJobFinancials(id);
    const [reloaded] = await db
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id));
    if (reloaded) fresh = reloaded;
  }
  if ("crewRate" in body || "status" in body) await syncJobLaborLedger(id);
  // Live sync: schedule/crew/status edits move the card on the client board.
  if ("crewLeaderId" in body || "scheduledOn" in body || "status" in body || "boardStatus" in body)
    emitBoardEvent(fresh.propertyId);
  const { propName, crewName } = await lookups();
  res.json(UpdateJobResponse.parse(decorateJob(fresh, propName, crewName)));
});

router.post("/jobs/:id/client-po", async (req, res): Promise<void> => {
  const id = typeof req.params.id === "string" ? req.params.id : "";
  if (!id) {
    res.status(400).json({ error: "Job required" });
    return;
  }
  const body = (req.body ?? {}) as { poNumber?: unknown };
  const result = await stampJobClientPo({
    jobId: id,
    poNumber: body.poNumber,
    source: "pulse desk",
  });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, code: result.code });
    return;
  }
  res.json({
    ok: true,
    already: result.already,
    poNumber: result.poNumber,
    jobId: result.jobId,
    jobNo: result.jobNo,
    unitNo: result.unitNo,
    propertyName: result.propertyName,
    notify: result.notify,
    base44: result.base44,
  });
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
    // Member dispatch: drop assignments on this job, and cancel any pending
    // moves targeting it (member stays on their current job).
    await tx
      .delete(crewDispatchAssignmentsTable)
      .where(eq(crewDispatchAssignmentsTable.jobId, id));
    await tx
      .update(crewDispatchAssignmentsTable)
      .set({
        status: "assigned",
        pendingJobId: null,
        moveRequestedAt: null,
        moveReminderSentAt: null,
      })
      .where(eq(crewDispatchAssignmentsTable.pendingJobId, id));
    await tx.delete(crewCheckinsTable).where(eq(crewCheckinsTable.jobId, id));
    await tx.delete(crewTrackPointsTable).where(eq(crewTrackPointsTable.jobId, id));
    await tx
      .delete(jobBroadcastsTable)
      .where(eq(jobBroadcastsTable.jobId, id));
    await tx
      .delete(jobLineItemsTable)
      .where(eq(jobLineItemsTable.jobId, id));
    await tx
      .delete(recapSharesTable)
      .where(eq(recapSharesTable.jobId, id));
    await tx.delete(jobsTable).where(eq(jobsTable.id, id));
    return { status: 200 as const };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  await removeEntriesForRef(["job_labor"], id);
  res.json(DeleteJobResponse.parse({ ok: true }));
});

function serLineItem(row: typeof jobLineItemsTable.$inferSelect) {
  return {
    ...ser(row),
    amount: Math.round(row.rate * row.qty * 100) / 100,
  };
}

router.post("/jobs/:id/line-items", async (req, res): Promise<void> => {
  const { id } = AddJobLineItemParams.parse(req.params);
  const body = AddJobLineItemBody.parse(req.body);
  const [job] = await db
    .select({ id: jobsTable.id, propertyId: jobsTable.propertyId })
    .from(jobsTable)
    .where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const [priceItem] = await db
    .select()
    .from(priceItemsTable)
    .where(eq(priceItemsTable.id, body.priceItemId));
  if (!priceItem) {
    res.status(404).json({ error: "Price item not found" });
    return;
  }
  if (priceItem.propertyId !== job.propertyId) {
    res
      .status(400)
      .json({ error: "Price item belongs to a different property" });
    return;
  }
  const [row] = await db
    .insert(jobLineItemsTable)
    .values({
      jobId: id,
      priceItemId: priceItem.id,
      service: priceItem.service,
      unit: priceItem.unit,
      rate: priceItem.rate,
      qty: body.qty && body.qty > 0 ? body.qty : 1,
    })
    .returning();
  res.status(201).json(AddJobLineItemResponse.parse(serLineItem(row)));
});

router.patch("/job-line-items/:id", async (req, res): Promise<void> => {
  const { id } = UpdateJobLineItemParams.parse(req.params);
  const body = UpdateJobLineItemBody.parse(req.body);
  const patch: Partial<typeof jobLineItemsTable.$inferInsert> = {};
  if (body.qty != null) {
    if (body.qty <= 0) {
      res.status(400).json({ error: "Quantity must be greater than zero." });
      return;
    }
    patch.qty = body.qty;
  }
  if (body.assignedCrewId !== undefined) {
    if (body.assignedCrewId) {
      const [crew] = await db
        .select({ id: crewsTable.id })
        .from(crewsTable)
        .where(eq(crewsTable.id, body.assignedCrewId));
      if (!crew) {
        res.status(400).json({ error: "Crew not found" });
        return;
      }
    }
    patch.assignedCrewId = body.assignedCrewId ?? null;
  }
  if (body.startTime !== undefined) {
    patch.startTime = body.startTime?.trim() || null;
  }
  if (body.completed !== undefined) {
    // Office override — mark done/undone without a crew attribution.
    patch.completedAt = body.completed ? new Date() : null;
    if (!body.completed) patch.completedByCrewId = null;
  }
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db
    .update(jobLineItemsTable)
    .set(patch)
    .where(eq(jobLineItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Line item not found" });
    return;
  }
  // Same rule as the crew portal: when the office override checks off the
  // last open item, the job auto-moves to Done (guarded — live cards only).
  if (body.completed === true) {
    const items = await db
      .select({ completedAt: jobLineItemsTable.completedAt })
      .from(jobLineItemsTable)
      .where(eq(jobLineItemsTable.jobId, row.jobId));
    if (items.length > 0 && items.every((i) => i.completedAt !== null)) {
      await db
        .update(jobsTable)
        .set({ boardStatus: "completed" })
        .where(
          and(
            eq(jobsTable.id, row.jobId),
            inArray(jobsTable.boardStatus, ["active", "filled", "reopened"]),
          ),
        );
    }
  }
  res.json(UpdateJobLineItemResponse.parse(await serLineItemWithCrew(row)));
});

async function serLineItemWithCrew(row: typeof jobLineItemsTable.$inferSelect) {
  let assignedCrewName: string | null = null;
  if (row.assignedCrewId) {
    const [crew] = await db
      .select({ name: crewsTable.name })
      .from(crewsTable)
      .where(eq(crewsTable.id, row.assignedCrewId));
    assignedCrewName = crew?.name ?? null;
  }
  return { ...serLineItem(row), assignedCrewName };
}

router.delete("/job-line-items/:id", async (req, res): Promise<void> => {
  const { id } = DeleteJobLineItemParams.parse(req.params);
  const [row] = await db
    .delete(jobLineItemsTable)
    .where(eq(jobLineItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Line item not found" });
    return;
  }
  res.json(DeleteJobLineItemResponse.parse({ ok: true }));
});

router.post("/job-line-items/:id/swap", async (req, res): Promise<void> => {
  const { id } = SwapJobLineItemParams.parse(req.params);
  const body = SwapJobLineItemBody.parse(req.body);
  // Atomic bedroom-size swap: retarget the row in place (or fold its qty into
  // an existing row for the target price item) inside ONE transaction, so a
  // partial failure can never leave both sizes on the job or inflate totals.
  const result = await db.transaction(async (tx) => {
    const [li] = await tx
      .select()
      .from(jobLineItemsTable)
      .where(eq(jobLineItemsTable.id, id))
      .for("update");
    if (!li) return { status: 404 as const, error: "Line item not found" };
    const [job] = await tx
      .select({ propertyId: jobsTable.propertyId })
      .from(jobsTable)
      .where(eq(jobsTable.id, li.jobId));
    const [priceItem] = await tx
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.id, body.priceItemId));
    if (!priceItem) return { status: 404 as const, error: "Price item not found" };
    if (!job || priceItem.propertyId !== job.propertyId)
      return { status: 400 as const, error: "Price item belongs to a different property" };
    const [sibling] = await tx
      .select()
      .from(jobLineItemsTable)
      .where(
        and(
          eq(jobLineItemsTable.jobId, li.jobId),
          eq(jobLineItemsTable.priceItemId, priceItem.id),
          ne(jobLineItemsTable.id, li.id),
        ),
      )
      .for("update");
    if (sibling) {
      const [merged] = await tx
        .update(jobLineItemsTable)
        .set({ qty: sibling.qty + li.qty })
        .where(eq(jobLineItemsTable.id, sibling.id))
        .returning();
      await tx.delete(jobLineItemsTable).where(eq(jobLineItemsTable.id, li.id));
      return { status: 200 as const, row: merged };
    }
    const [updated] = await tx
      .update(jobLineItemsTable)
      .set({
        priceItemId: priceItem.id,
        service: priceItem.service,
        unit: priceItem.unit,
        rate: priceItem.rate,
      })
      .where(eq(jobLineItemsTable.id, li.id))
      .returning();
    return { status: 200 as const, row: updated };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(SwapJobLineItemResponse.parse(await serLineItemWithCrew(result.row)));
});

router.post("/jobs/:id/schedule", async (req, res): Promise<void> => {
  const { id } = ScheduleJobParams.parse(req.params);
  const body = ScheduleJobBody.parse(req.body);
  try {
    await assertFalkonBoundary("dispatch_crew");
  } catch (err) {
    if (handleBoundaryError(err, res)) return;
    throw err;
  }
  const [row] = await db
    .update(jobsTable)
    .set({
      scheduledOn: body.scheduledOn,
      crewLeaderId: body.crewLeaderId,
      status: "scheduled",
      ...(body.crewLeaderId ? { crewVacatedAt: null } : {}),
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
  await autoSendLiveLink(id, "scheduled");
  const { propName, crewName } = await lookups();
  res.json(ScheduleJobResponse.parse(decorateJob(row, propName, crewName)));
});

// Drag-and-drop dispatch board: one transactional move that assigns (or
// unassigns) a crew and reschedules a job, keeping the job board, broadcast
// offers, and the crew portal schedule mirror in sync — the same rules a
// manual assignment applies, including clearing crewVacatedAt.
router.post("/jobs/:id/dispatch", async (req, res): Promise<void> => {
  const { id } = DispatchJobParams.parse(req.params);
  const body = DispatchJobBody.parse(req.body);
  const crewLeaderId = body.crewLeaderId ?? null;
  const scheduledOn = body.scheduledOn ?? null;
  // Optional start time: undefined = leave unchanged, null = clear, "HH:MM" = set.
  const timeProvided = body.scheduledTime !== undefined;
  const scheduledTime = body.scheduledTime ?? null;
  if (timeProvided && scheduledTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(scheduledTime)) {
    res.status(400).json({ error: "Start time must be HH:MM (24-hour)." });
    return;
  }
  if (crewLeaderId && !scheduledOn) {
    res.status(400).json({ error: "Pick a day to dispatch the crew to." });
    return;
  }
  try {
    await assertFalkonBoundary("dispatch_crew");
  } catch (err) {
    if (handleBoundaryError(err, res)) return;
    throw err;
  }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobsTable)
      .where(eq(jobsTable.id, id))
      .for("update");
    if (!job) return { status: 404 as const, error: "Job not found" };
    if (
      job.status === "complete" ||
      job.status === "paid" ||
      job.status === "cancelled"
    ) {
      return {
        status: 409 as const,
        error: "This job is already finished — it can't be dispatched.",
      };
    }
    let crew: typeof crewsTable.$inferSelect | undefined;
    if (crewLeaderId) {
      [crew] = await tx
        .select()
        .from(crewsTable)
        .where(eq(crewsTable.id, crewLeaderId));
      if (!crew) return { status: 404 as const, error: "Crew not found" };
    }
    const [updated] = await tx
      .update(jobsTable)
      .set({
        crewLeaderId,
        scheduledOn,
        ...(timeProvided ? { scheduledTime } : {}),
        // Any dispatch decision clears the "lost its crew" flag — either the
        // job just got a crew, or the office deliberately sent it to backlog.
        crewVacatedAt: null,
        status: crewLeaderId
          ? "scheduled"
          : job.status === "scheduled"
            ? "open"
            : job.status,
        // Deliberate product rule: dispatch moves are scheduling-only — they
        // NEVER touch the vendor/job board (boardStatus, broadcasts, lanes).
        // The board is managed from the Job Board itself.
      })
      .where(eq(jobsTable.id, id))
      .returning();
    // Rebuild the schedules mirror so the crew portal feed reflects the move
    // immediately: exactly one row per dispatched job, none when backlogged.
    const existing = await tx
      .select()
      .from(schedulesTable)
      .where(eq(schedulesTable.jobId, id));
    const windowStart = timeProvided
      ? scheduledTime
      : (existing.find((s) => s.windowStart)?.windowStart ?? null);
    await tx.delete(schedulesTable).where(eq(schedulesTable.jobId, id));
    if (crewLeaderId && scheduledOn) {
      await tx.insert(schedulesTable).values({
        jobId: id,
        scheduledOn,
        windowStart,
        crewLeaderId,
      });
    }
    await tx.insert(activitiesTable).values({
      entityType: "job",
      entityId: id,
      kind: crewLeaderId ? "assigned" : "flag",
      body: crewLeaderId
        ? `Job ${updated!.jobNo} dispatched to ${crew!.name} for ${scheduledOn}`
        : `Job ${updated!.jobNo} moved back to the dispatch backlog`,
    });
    return { status: 200 as const, job: updated! };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  if (crewLeaderId) await autoSendLiveLink(id, "scheduled");
  // Emit Falkon event (fire-and-forget)
  if (crewLeaderId) {
    void emitFalkonEvent("crew.dispatched", "job", id, {
      jobId: id,
      jobNo: result.job.jobNo,
      propertyId: result.job.propertyId,
      unitNo: result.job.unitNo,
      crewLeaderId,
      scheduledOn,
    });
  }
  const { propName, crewName } = await lookups();
  res.json(
    DispatchJobResponse.parse(decorateJob(result.job, propName, crewName)),
  );
});

// Clear a pending change order and put the job back into the flow: same
// crew, prior rail restored, crew alerted through their portal thread.
router.post("/jobs/:id/change-order/reopen", async (req, res): Promise<void> => {
  const { id } = ReopenJobChangeOrderParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.changeOrderStatus !== "requested") {
    res.status(409).json({ error: "No pending change order on this job" });
    return;
  }
  // boardStatus was never touched by the change-order request (the Requested
  // rail is driven purely by changeOrderStatus), so clearing the flag alone
  // drops the card back onto whatever rail its CURRENT board status says —
  // no risk of clobbering state that moved on while the CO sat in review.
  const [row] = await db
    .update(jobsTable)
    .set({
      changeOrderStatus: null,
      changeOrderAt: null,
      changeOrderPrevBoardStatus: null,
      // Same crew stays on the job — make sure it never reads as vacated.
      ...(job.crewLeaderId ? { crewVacatedAt: null } : {}),
    })
    .where(and(eq(jobsTable.id, id), eq(jobsTable.changeOrderStatus, "requested")))
    .returning();
  if (!row) {
    res.status(409).json({ error: "No pending change order on this job" });
    return;
  }
  // Side effects after the primary mutation — never 500 a committed change.
  try {
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: id,
      kind: "change_order_reopened",
      body: `Change order reviewed — job put back into the flow (${job.changeOrderReason ?? "change order"})`,
    });
    if (row.crewLeaderId) {
      await db.insert(crewMessagesTable).values({
        crewId: row.crewLeaderId,
        sender: "office",
        body: `Change order on Job ${row.jobNo}${row.unitNo ? ` (Unit ${row.unitNo})` : ""}: ${job.changeOrderReason ?? "scope updated"}${job.changeOrderNote ? ` — ${job.changeOrderNote}` : ""}. The updated scope is back on your schedule — check the job details.`,
      });
    }
  } catch (e) {
    console.error("change-order reopen side effects failed", e);
  }
  const { propName, crewName } = await lookups();
  res.json(ReopenJobChangeOrderResponse.parse(decorateJob(row, propName, crewName)));
});

router.post("/jobs/:id/complete", async (req, res): Promise<void> => {
  const { id } = CompleteJobParams.parse(req.params);
  const force = req.body?.force === true;
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  // Hard gate (no force override): a client PO is required before the card
  // may leave Done for Billing — no PO, no billing.
  if (!job.poNumber?.trim()) {
    res.status(409).json({
      error: "This job doesn't look finished yet.",
      missing: ["A client PO number is required before this job can move to Billing."],
      missingCodes: ["po"],
    });
    return;
  }
  // Guard: completing work is a real state claim — require a crew and a
  // finished checklist unless the office explicitly overrides with force.
  if (!force) {
    const blockers: { code: string; text: string }[] = [];
    if (!job.crewLeaderId) {
      blockers.push({ code: "crew", text: "No crew is assigned to this job yet." });
    }
    const lineItems = await db
      .select()
      .from(jobLineItemsTable)
      .where(eq(jobLineItemsTable.jobId, id));
    const openItems = lineItems.filter((li) => !li.completedAt);
    if (lineItems.length > 0 && openItems.length > 0) {
      blockers.push({
        code: "checklist",
        text: `${openItems.length} of ${lineItems.length} work checklist item${openItems.length === 1 ? " is" : "s are"} still unfinished.`,
      });
    }
    if (blockers.length > 0) {
      res.status(409).json({
        error: "This job doesn't look finished yet.",
        missing: blockers.map((b) => b.text),
        missingCodes: blockers.map((b) => b.code),
      });
      return;
    }
  }
  const [row] = await db
    .update(jobsTable)
    .set({ status: "complete", completedAt: new Date(), boardStatus: "completed" })
    .where(eq(jobsTable.id, id))
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "completed",
    body: force ? "Job marked complete (office override)" : "Job marked complete",
  });
  await syncJobLaborLedger(id);
  await autoSendLiveLink(id, "completed");
  emitBoardEvent(row.propertyId);
  const { propName, crewName } = await lookups();
  res.json(CompleteJobResponse.parse(decorateJob(row, propName, crewName)));
});

interface CloseOutBlocker {
  code: string;
  text: string;
}

async function computeCloseOutMissing(
  job: typeof jobsTable.$inferSelect,
): Promise<CloseOutBlocker[]> {
  const missing: CloseOutBlocker[] = [];
  if (job.status !== "complete") {
    missing.push({ code: "work", text: "Mark the work as verified complete first." });
  }
  const jobInvoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.jobId, job.id));
  if (jobInvoices.length === 0) {
    missing.push({ code: "invoice", text: "Add an invoice for this job." });
  } else if (!jobInvoices.every((i) => i.status === "paid")) {
    missing.push({
      code: "invoice_paid",
      text:
        jobInvoices.length > 1
          ? "Mark every invoice on this job as payment received."
          : "Mark the invoice as payment received.",
    });
  }
  if (!job.crewLeaderId) {
    missing.push({ code: "crew", text: "Assign a crew to this job first." });
  } else {
    const payments = await db
      .select()
      .from(crewPaymentsTable)
      .where(
        and(
          eq(crewPaymentsTable.jobId, job.id),
          eq(crewPaymentsTable.crewId, job.crewLeaderId),
        ),
      );
    if (!payments.some((p) => p.status === "completed")) {
      // Emergency flow: a HELD pay hold IS the payment guarantee — it releases
      // to a same-day payable at close-out, so don't demand pre-payment.
      const [heldHold] = await db
        .select()
        .from(crewPayHoldsTable)
        .where(
          and(
            eq(crewPayHoldsTable.jobId, job.id),
            eq(crewPayHoldsTable.crewId, job.crewLeaderId),
            eq(crewPayHoldsTable.status, "HELD"),
          ),
        );
      if (!heldHold) {
        missing.push({ code: "crew_pay", text: "Mark the crew member as paid for this job." });
      }
    }
  }
  // Optional gate: businesses can require the job summary (recap) to be sent
  // to the property manager before a job may close out.
  const [settings] = await db.select().from(businessSettingsTable).limit(1);
  if (settings?.requireSummaryBeforeCloseOut) {
    const [summary] = await db
      .select({ status: jobSummariesTable.status })
      .from(jobSummariesTable)
      .where(eq(jobSummariesTable.jobId, job.id));
    if (summary?.status !== "sent") {
      missing.push({ code: "summary", text: "Send the job summary to the property manager first." });
    }
  }
  return missing;
}

router.post("/jobs/:id/clear", async (req, res): Promise<void> => {
  const { id } = ClearJobParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "complete") {
    res.status(409).json({
      error: "Only completed jobs can be cleared to job history.",
    });
    return;
  }
  const missing = await computeCloseOutMissing(job);
  if (missing.length > 0) {
    res.status(409).json({
      error: `Finish the close-out checklist first: ${missing.map((m) => m.text).join(" ")}`,
      missing: missing.map((m) => m.text),
      missingCodes: missing.map((m) => m.code),
    });
    return;
  }
  const [row] = await db
    .update(jobsTable)
    .set({ clearedAt: new Date() })
    .where(eq(jobsTable.id, id))
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "note",
    body: "Job cleared to history",
  });
  const { propName, crewName } = await lookups();
  res.json(ClearJobResponse.parse(decorateJob(row, propName, crewName)));
});

router.post("/jobs/:id/close-out", async (req, res): Promise<void> => {
  const { id } = CloseOutJobParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.clearedAt) {
    res.status(409).json({
      error: "This job is already closed out.",
      missing: [],
    });
    return;
  }

  const missing = await computeCloseOutMissing(job);
  if (missing.length > 0) {
    res.status(409).json({
      error: "A few funnel steps still need to be finished.",
      missing: missing.map((m) => m.text),
      missingCodes: missing.map((m) => m.code),
    });
    return;
  }

  await db
    .update(jobsTable)
    .set({ clearedAt: new Date() })
    .where(eq(jobsTable.id, id));
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "note",
    body: "Job closed out — full funnel completed",
  });
  await recomputeJobFinancials(id);
  await syncJobLaborLedger(id);

  // Emergency pay holds release the moment the job passes close-out approval.
  // Guarded HELD -> RELEASED with row-count so a hold can never double-release
  // (Founding Wings reserve pattern). Released pay is same-day: a pending crew
  // payment due today is created for each released hold.
  const releasedHolds = await db
    .update(crewPayHoldsTable)
    .set({ status: "RELEASED", releasedAt: new Date() })
    .where(
      and(
        eq(crewPayHoldsTable.jobId, id),
        eq(crewPayHoldsTable.status, "HELD"),
      ),
    )
    .returning();
  for (const hold of releasedHolds) {
    const [holdCrew] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, hold.crewId));
    // Single source of truth: the hold covers pay + bonus. If part was
    // already paid through a normal completed crew payment, only the
    // remainder becomes the same-day payable — never a duplicate obligation.
    const priorPayments = await db
      .select()
      .from(crewPaymentsTable)
      .where(
        and(
          eq(crewPaymentsTable.jobId, id),
          eq(crewPaymentsTable.crewId, hold.crewId),
        ),
      );
    const alreadyPaid = priorPayments
      .filter((p) => p.status === "completed")
      .reduce((s, p) => s + (p.amount ?? 0), 0);
    const payable = Math.max(
      0,
      Math.round((hold.amount - alreadyPaid) * 100) / 100,
    );
    if (payable > 0) {
      await db.insert(crewPaymentsTable).values({
        crewId: hold.crewId,
        jobId: id,
        amount: payable,
        status: "pending",
        dueOn: new Date(),
        note: `${EMERGENCY_PAY_NOTE_PREFIX}${hold.bonusAmount > 0 ? ` (includes $${hold.bonusAmount.toFixed(2)} bonus)` : ""} — released at close-out`,
      });
      await db.insert(notificationsTable).values({
        kind: "emergency_pay_today",
        priority: "urgent",
        entityType: "job",
        entityId: id,
        title: `Pay today: ${holdCrew?.name ?? "Crew"} — $${payable.toFixed(2)}`,
        body: "Emergency job approved. Same-day pay overrides net-30 — send this payout today.",
      });
    } else {
      // Fully covered by prior completed payments — emit the canonical
      // settled marker (completed, $0, note-prefixed) so every surface that
      // uses the shared settlement predicate agrees this hold is done and it
      // can never linger as "payable" with nothing to pay.
      await db.insert(crewPaymentsTable).values({
        crewId: hold.crewId,
        jobId: id,
        amount: 0,
        status: "completed",
        dueOn: new Date(),
        note: `${EMERGENCY_PAY_NOTE_PREFIX} — already covered by prior payment, settled at close-out`,
      });
    }
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: id,
      kind: "payment",
      body:
        payable > 0
          ? `Emergency hold released — $${payable.toFixed(2)} now payable to ${holdCrew?.name ?? "crew"}, same-day payout`
          : `Emergency hold released — already covered by prior payment to ${holdCrew?.name ?? "crew"}, nothing further owed`,
    });
  }

  let emailSent = false;
  const closeOutPolicy = await getAutoEmails();
  if (closeOutPolicy.crewThankYou && job.crewLeaderId) {
    const [crew] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, job.crewLeaderId));
    if (crew?.email) {
      const [prop] = await db
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.id, job.propertyId));
      const [payment] = await db
        .select()
        .from(crewPaymentsTable)
        .where(
          and(
            eq(crewPaymentsTable.jobId, id),
            eq(crewPaymentsTable.crewId, job.crewLeaderId),
            eq(crewPaymentsTable.status, "completed"),
          ),
        );
      try {
        const result = await sendCrewThankYouEmail({
          to: crew.email,
          crewName: crew.name,
          jobDescription: job.description,
          propertyName: prop?.name ?? null,
          amountPaid: payment?.amount ?? job.crewRate ?? null,
        });
        emailSent = result.ok;
      } catch (err) {
        logger.error({ err }, "crew thank-you email failed");
      }
    }
  }

  res.json(CloseOutJobResponse.parse({ ok: true, emailSent }));
});

router.post("/jobs/:id/restart", async (req, res): Promise<void> => {
  const { id } = RestartJobParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "complete" && !job.clearedAt) {
    res.status(409).json({ error: "Only completed or cleared jobs can be restarted" });
    return;
  }
  const [row] = await db
    .update(jobsTable)
    .set({
      status: "open",
      boardStatus: "reopened",
      completedAt: null,
      clearedAt: null,
    })
    .where(eq(jobsTable.id, id))
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "note",
    body: "Job restarted",
  });
  await syncJobLaborLedger(id);
  emitBoardEvent(row.propertyId);
  const { propName, crewName } = await lookups();
  res.json(RestartJobResponse.parse(decorateJob(row, propName, crewName)));
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
  const lineItems = await db
    .select()
    .from(jobLineItemsTable)
    .where(eq(jobLineItemsTable.jobId, jobId));
  const crewPhotos = await crewPhotosForJobs([job]);
  return { job, prop, notes, beforeCount, afterCount, lineItems, crewPhotos };
}

router.get("/jobs/:id/events", async (req, res): Promise<void> => {
  const { id } = ListJobEventsParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  const crews = await db.select().from(crewsTable);
  const crewName = (crewId: string | null) =>
    crews.find((c) => c.id === crewId)?.name ?? null;

  const events: {
    kind: string;
    label: string;
    at: string;
    crewName: string | null;
  }[] = [];

  const broadcasts = await db
    .select()
    .from(jobBroadcastsTable)
    .where(eq(jobBroadcastsTable.jobId, id));
  for (const b of broadcasts) {
    if (b.status === "approved" && b.respondedAt) {
      events.push({
        kind: "accepted",
        label: "Crew accepted the job offer",
        at: b.respondedAt.toISOString(),
        crewName: crewName(b.crewId),
      });
    }
  }

  const checkins = await db
    .select()
    .from(crewCheckinsTable)
    .where(eq(crewCheckinsTable.jobId, id));
  for (const c of checkins) {
    events.push({
      kind: c.kind === "checkout" ? "checkout" : "checkin",
      label:
        c.kind === "checkout"
          ? "Crew checked out of the site"
          : "Crew checked in to the site",
      at: c.createdAt.toISOString(),
      crewName: crewName(c.crewId),
    });
  }

  const photos = await db
    .select()
    .from(crewPhotosTable)
    .where(eq(crewPhotosTable.jobId, id));
  for (const p of photos) {
    const phase =
      p.phase === "before" ? "before" : p.phase === "after" ? "after" : "progress";
    events.push({
      kind: `photo_${phase}`,
      label:
        phase === "before"
          ? "Crew uploaded before photos"
          : phase === "after"
            ? "Crew uploaded after photos"
            : "Crew uploaded progress photos",
      at: (p.capturedAt ?? p.createdAt).toISOString(),
      crewName: crewName(p.crewId),
    });
  }

  // Photos captured during a property walk that produced this job.
  const walkPhotos = await db
    .select()
    .from(walkCapturesTable)
    .where(eq(walkCapturesTable.jobId, id));
  const walkPhotoCount = walkPhotos.filter((p) => p.storagePath).length;
  if (walkPhotoCount > 0) {
    const first = walkPhotos[0];
    events.push({
      kind: "photo_before",
      label: `${walkPhotoCount} photo${walkPhotoCount === 1 ? "" : "s"} captured on the property walk`,
      at: first.createdAt.toISOString(),
      crewName: null,
    });
  }

  const acts = await db
    .select()
    .from(activitiesTable)
    .where(
      and(
        eq(activitiesTable.entityType, "job"),
        eq(activitiesTable.entityId, id),
      ),
    );
  for (const a of acts) {
    if (a.kind === "note" && a.body?.startsWith("Crew note")) {
      events.push({
        kind: "note",
        label: a.body,
        at: a.createdAt.toISOString(),
        crewName: null,
      });
    }
  }

  if (job.completedAt) {
    events.push({
      kind: "completed",
      label: "Crew has completed the job — ready for verification",
      at: job.completedAt.toISOString(),
      crewName: crewName(job.crewLeaderId),
    });
  }

  events.sort((x, y) => (x.at < y.at ? 1 : -1));
  res.json(ListJobEventsResponse.parse(events));
});

router.post("/jobs/:id/recap", async (req, res): Promise<void> => {
  const { id } = DraftJobRecapParams.parse(req.params);
  const ctx = await gatherRecapContext(id);
  if (!ctx) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { job, prop, notes, beforeCount, afterCount, lineItems, crewPhotos } =
    ctx;
  const totalPhotos = beforeCount + afterCount + crewPhotos.length;
  const system =
    "You are HALO's recap writer for ArchAngel Contractors, a premium property maintenance company. " +
    "Write a polished, client-ready work recap email that a property manager would be impressed to receive after a job is finished. " +
    "Structure the body as: (1) a warm one-line opener confirming completion, (2) a 'What we did' rundown that walks through the work performed — use short lines starting with '• ' for each item, (3) a quality-assurance line about workmanship and site cleanup, and (4) if photos are on file, one line noting that the photo documentation is included below. " +
    "Be specific and detailed using ONLY the facts provided — never invent work, dates, or numbers. Do not mention prices or costs. " +
    "Keep it tight: roughly 6-10 short lines total. Do not include a subject line or email headers in the body. " +
    "Sign off as 'The ArchAngel Contractors team'. " +
    'Respond with ONLY valid JSON of the form {"subject": string, "body": string}. The body may use \\n for line breaks. No markdown other than the • bullets.';
  const user = [
    `Property: ${prop?.name ?? "the property"}${job.unitNo ? `, Unit ${job.unitNo}` : ""}`,
    `Job number: ${job.jobNo}`,
    `Service category: ${job.category ?? "general maintenance"}`,
    `Work description: ${job.description ?? "n/a"}`,
    lineItems.length
      ? `Services performed:\n${lineItems.map((li) => `- ${li.service}${li.qty > 1 ? ` x${li.qty}` : ""}`).join("\n")}`
      : "Services performed: see work description",
    notes.length ? `Field notes:\n${notes.join("\n")}` : "Field notes: none",
    job.completedAt
      ? `Completed on: ${job.completedAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/New_York" })}`
      : "Completed on: n/a",
    `Photos on file (will be embedded in the email automatically): ${totalPhotos} total (${beforeCount} before, ${afterCount} after, ${crewPhotos.length} from the crew on site).`,
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

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function publicBaseUrl(): string {
  const domain =
    process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : "";
}

/**
 * Auto-send a live job link to the property's contact when a job is
 * scheduled or completed. Controlled by the autoSendRecapLinks business
 * setting. Never throws — failures are logged and the triggering request
 * still succeeds.
 */
async function autoSendLiveLink(
  jobId: string,
  event: "scheduled" | "completed",
): Promise<void> {
  try {
    // Check the live DB setting so the owner's toggle takes effect immediately.
    const [policy, bizSettings] = await Promise.all([
      getAutoEmails(),
      db.select().from(businessSettingsTable).limit(1),
    ]);
    if (!policy.autoJobRecapLinks) return;
    const settings = bizSettings[0];
    // Also honour the legacy autoSendRecapLinks toggle (visible in Business
    // Info as "Auto-send live job links") so either off-switch is authoritative.
    if (settings && settings.autoSendRecapLinks === false) return;

    const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
    if (!job) return;
    const [prop] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, job.propertyId));
    const contacts = await db
      .select()
      .from(contactsTable)
      .where(eq(contactsTable.propertyId, job.propertyId));
    const withEmail = contacts.filter((c) => c.email?.trim());
    if (!withEmail.length) return;
    const managerish = withEmail.find((c) =>
      /manager|pm|property|regional|director/i.test(c.role ?? ""),
    );
    const contact = managerish ?? withEmail[0];
    const to = contact.email!.trim();

    const where = [prop?.name, job.unitNo ? `Unit ${job.unitNo}` : null]
      .filter(Boolean)
      .join(" · ");
    const companyName = settings?.companyName ?? "ArchAngel Contractors";
    const subject =
      event === "scheduled"
        ? `Work scheduled${where ? ` at ${where}` : ""} — ${job.jobNo}`
        : `Work completed${where ? ` at ${where}` : ""} — ${job.jobNo}`;
    const intro =
      event === "scheduled"
        ? `Hi ${contact.name},\n\nGood news — your job ${job.jobNo}${where ? ` at ${where}` : ""} is on the schedule${job.scheduledOn ? ` for ${job.scheduledOn}` : ""}. You can follow along with a live link that updates as the crew works, including photos.\n\nPlease reply to this email with any questions.\n\n${companyName}`
        : `Hi ${contact.name},\n\nYour job ${job.jobNo}${where ? ` at ${where}` : ""} is complete. The live link below has the full recap, including the crew's photo documentation.\n\nPlease reply to this email with any questions.\n\n${companyName}`;

    const token = randomBytes(18).toString("base64url");
    await db.insert(recapSharesTable).values({
      jobId,
      token,
      subject,
      body: intro,
    });
    const link = `${publicBaseUrl()}/recap/${token}`;

    const html = recapShell({
      subject,
      body: intro,
      propertyName: prop?.name ?? null,
      unitNo: job.unitNo,
      jobNo: job.jobNo,
      photos: [],
      ctaUrl: link,
      ctaLabel: "View live job link",
    });

    const sent = await sendEmail({ to, subject, html });
    if (!sent.ok) {
      logger.warn({ jobId, event, to, error: sent.error }, "Auto live-link email failed");
      return;
    }
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: jobId,
      kind: "email",
      body: `Live job link auto-sent to ${contact.name} (${to}) — job ${event}.`,
    });
    // Mirror the auto-send onto the client board too.
    await raiseClientCard({
      propertyId: job.propertyId,
      kind: "tracker",
      title: `Live job link — Job ${job.jobNo} ${event === "scheduled" ? "scheduled" : "completed"}`,
      body: job.description || `Follow job ${job.jobNo} live — arrivals, progress, and photos.`,
      actionLabel: event === "scheduled" ? "Watch live" : "See the finished work",
      links: [{ label: "Open live job link", url: link, kind: "tracker" }],
      sourceType: "recap_link",
      sourceId: `${jobId}`,
      jobId,
    });
  } catch (err) {
    logger.warn({ err, jobId, event }, "Auto live-link send failed");
  }
}

function photoGridHtml(
  photos: { url: string; label: string }[],
  base: string,
): string {
  if (photos.length === 0) return "";
  const cells = photos
    .map(
      (p) => `<td width="50%" style="padding:6px;vertical-align:top;">
        <a href="${base}${p.url}" style="text-decoration:none;">
          <img src="${base}${p.url}" alt="${escHtml(p.label)}" width="270" style="width:100%;max-width:270px;border-radius:10px;display:block;border:1px solid #e2e1dc;" />
        </a>
        <div style="font-size:11px;color:#9a9da4;margin-top:4px;text-transform:uppercase;letter-spacing:0.08em;">${escHtml(p.label)}</div>
      </td>`,
    )
    .reduce<string[]>((rows, cell, i) => {
      if (i % 2 === 0) rows.push(`<tr>${cell}`);
      else rows[rows.length - 1] += `${cell}</tr>`;
      return rows;
    }, [])
    .map((r) => (r.endsWith("</tr>") ? r : `${r}<td width="50%"></td></tr>`))
    .join("");
  return `<tr><td style="padding:14px 4px 0 4px;">
      <div style="font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#8f6a1f;margin-bottom:4px;">Photo documentation · ${photos.length} photo${photos.length === 1 ? "" : "s"}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:8px;box-shadow:0 1px 3px rgba(23,24,28,0.08);">${cells}</table>
    </td></tr>`;
}

function recapShell(opts: {
  subject: string;
  body: string;
  propertyName: string | null;
  unitNo: string | null;
  jobNo: string;
  photos: { url: string; label: string }[];
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const base = publicBaseUrl();
  const dateLabel = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York",
  });
  const where = [opts.propertyName, opts.unitNo ? `Unit ${opts.unitNo}` : null]
    .filter(Boolean)
    .join(" · ");
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f2ee;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f2ee;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 4px 16px 4px;">
          <div style="font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#8f6a1f;">ArchAngel Contractors</div>
          <div style="font-size:22px;font-weight:800;color:#17181c;margin-top:4px;">${escHtml(opts.subject)}</div>
          <div style="font-size:13px;color:#6b6e76;margin-top:2px;">${escHtml(where)}${where ? " · " : ""}${escHtml(opts.jobNo)} · ${escHtml(dateLabel)}</div>
        </td></tr>
        <tr><td style="padding:0 4px;">
          <div style="font-size:14px;color:#17181c;line-height:1.7;background:#ffffff;border-radius:12px;padding:18px 20px;box-shadow:0 1px 3px rgba(23,24,28,0.08);border-top:3px solid #8f6a1f;white-space:pre-wrap;">${escHtml(opts.body)}</div>
        </td></tr>
        ${photoGridHtml(opts.photos, base)}
        ${
          opts.ctaUrl
            ? `<tr><td style="padding:16px 4px 0 4px;" align="center">
          <a href="${opts.ctaUrl}" style="display:inline-block;background:#8f6a1f;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;padding:12px 26px;border-radius:10px;">${escHtml(opts.ctaLabel ?? "View live link")}</a>
        </td></tr>`
            : ""
        }
        <tr><td style="padding:18px 4px 4px 4px;">
          <div style="font-size:12px;color:#9a9da4;line-height:1.5;border-top:1px solid #e2e1dc;padding-top:12px;">ArchAngel Contractors · Sent by HALO. Reply to this email with any questions — we're happy to help.</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function gatherRecapPhotos(
  jobId: string,
  crewPhotos: CrewJobPhoto[],
): Promise<{ url: string; label: string }[]> {
  const photoActs = await db
    .select()
    .from(activitiesTable)
    .where(eq(activitiesTable.entityId, jobId));
  const photos: { url: string; label: string }[] = [];
  for (const a of photoActs) {
    if (!a.storagePath) continue;
    if (a.kind === "photo_before")
      photos.push({ url: `/api/storage${a.storagePath}`, label: "Before" });
  }
  for (const a of photoActs) {
    if (!a.storagePath) continue;
    if (a.kind === "photo_after")
      photos.push({ url: `/api/storage${a.storagePath}`, label: "After" });
  }
  for (const p of crewPhotos) {
    const base = p.note?.trim() || "On site";
    photos.push({
      url: p.url,
      label: p.crewName ? `${base} · ${p.crewName}` : base,
    });
  }
  return photos;
}

router.post("/jobs/:id/recap/share", async (req, res): Promise<void> => {
  const { id } = CreateRecapShareParams.parse(req.params);
  const body = CreateRecapShareBody.parse(req.body);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const token = randomBytes(18).toString("base64url");
  const [row] = await db
    .insert(recapSharesTable)
    .values({ jobId: id, token, subject: body.subject, body: body.body })
    .returning();
  await db
    .update(jobsTable)
    .set({ recapSentAt: new Date() })
    .where(eq(jobsTable.id, id));
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: id,
    kind: "note",
    body: `Recap live link created: ${body.subject}`,
  });
  // Mirror the shared recap link onto the client board.
  await raiseClientCard({
    propertyId: job.propertyId,
    kind: "summary",
    title: body.subject || `Recap — Job ${job.jobNo}`,
    body: `Live recap from Archangel Contractors — notes and photos, updated as the job progresses.`,
    actionLabel: "View recap",
    links: [{ label: "Open live recap", url: `${publicBaseUrl()}/recap/${row.token}`, kind: "summary" }],
    sourceType: "recap_share",
    sourceId: row.id,
    jobId: id,
  });
  res.status(201).json(CreateRecapShareResponse.parse({ token: row.token }));
});

router.post("/jobs/:id/tracker/share", async (req, res): Promise<void> => {
  const { id } = CreateJobTrackerShareParams.parse(req.params);
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  // One stable tracker link per job — reuse if it already exists.
  let token = job.trackerToken;
  if (!token) {
    const candidate = randomBytes(18).toString("base64url");
    // Atomic first-wins: only set the token if it's still null, then re-read.
    const updated = await db
      .update(jobsTable)
      .set({ trackerToken: candidate })
      .where(and(eq(jobsTable.id, id), isNull(jobsTable.trackerToken)))
      .returning({ trackerToken: jobsTable.trackerToken });
    if (updated.length > 0) {
      token = candidate;
      await db.insert(activitiesTable).values({
        entityType: "job",
        entityId: id,
        kind: "note",
        body: `Live tracker link created for job ${job.jobNo}.`,
      });
    } else {
      const [fresh] = await db
        .select({ trackerToken: jobsTable.trackerToken })
        .from(jobsTable)
        .where(eq(jobsTable.id, id));
      token = fresh?.trackerToken ?? candidate;
    }
  }
  const link = `${publicBaseUrl()}/track/${token}`;
  // Mirror onto the client board so the live link is always one click away.
  await raiseClientCard({
    propertyId: job.propertyId,
    kind: "tracker",
    title: `Live tracker — Job ${job.jobNo}`,
    body: job.description || `Watch crew arrivals, GPS check-ins, and photos live for job ${job.jobNo}.`,
    actionLabel: "Watch live",
    links: [{ label: "Open live tracker", url: link, kind: "tracker" }],
    sourceType: "tracker",
    sourceId: job.id,
    jobId: job.id,
  });
  res.status(201).json(CreateJobTrackerShareResponse.parse({ token, link }));
});

// POST /jobs/:id/send-live-link — create/reuse a tracker token, deliver to crew via push + SMS
router.post("/jobs/:id/send-live-link", async (req, res): Promise<void> => {
  const { id } = req.params;
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, id));
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  // Atomic first-wins: create or reuse the stable tracker token
  let token = job.trackerToken;
  if (!token) {
    const candidate = randomBytes(18).toString("base64url");
    const updated = await db
      .update(jobsTable)
      .set({ trackerToken: candidate })
      .where(and(eq(jobsTable.id, id), isNull(jobsTable.trackerToken)))
      .returning({ trackerToken: jobsTable.trackerToken });
    if (updated.length > 0) {
      token = candidate;
      await db.insert(activitiesTable).values({
        entityType: "job",
        entityId: id,
        kind: "note",
        body: `Live tracker link sent for job ${job.jobNo}.`,
      });
    } else {
      const [fresh] = await db
        .select({ trackerToken: jobsTable.trackerToken })
        .from(jobsTable)
        .where(eq(jobsTable.id, id));
      token = fresh?.trackerToken ?? candidate;
    }
  }

  const url = `${publicBaseUrl()}/track/${token}`;

  let deliveredPush = false;
  let deliveredSms = false;
  let crewName: string | null = null;

  if (job.crewLeaderId) {
    const [crew] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, job.crewLeaderId));
    if (crew) {
      crewName = crew.name;
      // Expo push — deliveredPush is true only when the token was valid format
      // AND the HTTP dispatch completed without a transport error.
      const { sendExpoPush } = await import("../lib/pushNotification");
      if (crew.pushToken) {
        deliveredPush = await sendExpoPush(crew.pushToken, {
          title: `Live link — Job ${job.jobNo}`,
          body: `Here is your live job tracker link for today's work.`,
          data: { url, jobId: id },
        });
      }
      // SMS via Twilio
      if (crew.phone?.trim()) {
        const { sendSms } = await import("../lib/sms");
        const result = await sendSms(
          crew.phone.trim(),
          `HALO: Here is the live tracker for job ${job.jobNo}: ${url}`,
        );
        deliveredSms = result.ok;
      }
    }
  }

  res.json({ url, deliveredPush, deliveredSms, crewName });
});

router.get("/jobs/:id/report", async (req, res): Promise<void> => {
  const { id } = GetJobReportPdfParams.parse(req.params);
  const data = await gatherJobReport(id);
  if (!data) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const pdf = await buildJobReportPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="job-report-${data.job.jobNo.replace(/[^\w.-]+/g, "_")}.pdf"`,
  );
  res.send(Buffer.from(pdf));
});

router.get("/recap-shares/:token", async (req, res): Promise<void> => {
  const { token } = GetRecapShareParams.parse(req.params);
  const [share] = await db
    .select()
    .from(recapSharesTable)
    .where(eq(recapSharesTable.token, token));
  if (!share) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const ctx = await gatherRecapContext(share.jobId);
  if (!ctx) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  const { job, prop, crewPhotos } = ctx;
  const photos = await gatherRecapPhotos(share.jobId, crewPhotos as CrewJobPhoto[]);
  let crewName: string | null = null;
  if (job.crewLeaderId) {
    const [crew] = await db
      .select()
      .from(crewsTable)
      .where(eq(crewsTable.id, job.crewLeaderId));
    crewName = crew?.name ?? null;
  }
  res.json(
    GetRecapShareResponse.parse({
      subject: share.subject,
      body: share.body,
      jobNo: job.jobNo,
      propertyName: prop?.name ?? null,
      unitNo: job.unitNo ?? null,
      category: job.category ?? null,
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      crewName,
      sentOn: share.createdAt ? share.createdAt.toISOString() : null,
      photos,
    }),
  );
});

router.post("/jobs/:id/recap/send", async (req, res): Promise<void> => {
  const { id } = SendJobRecapParams.parse(req.params);
  const body = SendJobRecapBody.parse(req.body);
  const ctx = await gatherRecapContext(id);
  if (!ctx) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const { job, prop, crewPhotos } = ctx;
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
  const photos = await gatherRecapPhotos(id, crewPhotos as CrewJobPhoto[]);
  const html = recapShell({
    subject: body.subject,
    body: body.body,
    propertyName: prop?.name ?? null,
    unitNo: job.unitNo,
    jobNo: job.jobNo,
    photos,
  });
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
  // Mirror the recap email onto the client board.
  await raiseClientCard({
    propertyId: job.propertyId,
    kind: "summary",
    title: `Recap — Job ${job.jobNo}${job.unitNo ? ` (Unit ${job.unitNo})` : ""}`,
    body: body.subject,
    actionLabel: "Review recap",
    links: [],
    sourceType: "recap_email",
    sourceId: job.id,
    jobId: job.id,
  });
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

  // Count non-submitted packets per crew for the onboarding badge
  const packetRows = await db
    .select({ crewId: crewPacketsTable.crewId, status: crewPacketsTable.status })
    .from(crewPacketsTable);
  const pendingByCrewId = new Map<string, number>();
  for (const p of packetRows) {
    if (p.status !== "submitted") {
      pendingByCrewId.set(p.crewId, (pendingByCrewId.get(p.crewId) ?? 0) + 1);
    }
  }

  res.json(
    ListCrewsResponse.parse(
      crews.map((c) => {
        const leader = c.leaderId ? crews.find((x) => x.id === c.leaderId) : undefined;
        const todaySched = schedules.find(
          (s) => s.crewLeaderId === c.id && s.scheduledOn === today,
        );
        const job = todaySched ? jobById.get(todaySched.jobId) : undefined;
        return {
          ...ser(c),
          access: (c.accessGrants as object | null) ?? null,
          leaderName: leader?.name ?? null,
          todayStatus: todaySched
            ? (todaySched.status === "done" ? "done" : "site")
            : "idle",
          todayJob: job?.jobNo ?? null,
          todayProperty: job ? (propName.get(job.propertyId) ?? null) : null,
          pendingPackets: pendingByCrewId.get(c.id) ?? 0,
        };
      }),
    ),
  );
});

router.post("/crews", async (req, res): Promise<void> => {
  const body = CreateCrewBody.parse(req.body);
  // Hash-at-rest. Bearer is revealed by POST /crews/:id/portal-link or SMS senders.
  const minted = mintPortalToken();
  const [row] = await db.insert(crewsTable).values({ ...body, ...portalTokenColumns(minted) }).returning();
  res.status(201).json(CreateCrewResponse.parse(ser(row)));
});

router.patch("/crews/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCrewParams.parse(req.params);
  const body = UpdateCrewBody.parse(req.body);
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db
    .update(crewsTable)
    .set(body)
    .where(eq(crewsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Crew member not found" });
    return;
  }
  // Wings exclusion is permanent: drop their program membership so sweeps,
  // eligibility, and accrual can't keep operating on a stale member row.
  if (body.wingsExcluded === true) {
    await db
      .delete(wingMembersTable)
      .where(eq(wingMembersTable.crewId, id))
      .catch(() => {});
  }
  res.json(UpdateCrewResponse.parse(ser(row)));
});

// Office-view access grant for a member's portal link. Everything is stored
// server-side and re-checked on every portal read — the link never carries
// permissions itself.
router.put("/crews/:id/access", async (req, res): Promise<void> => {
  const { id } = UpdateCrewAccessParams.parse(req.params);
  const body = UpdateCrewAccessBody.parse(req.body);
  const [crew] = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.id, id));
  if (!crew) {
    res.status(404).json({ error: "Crew member not found" });
    return;
  }
  let grant: object | null = null;
  if (body.features.length > 0) {
    if (body.propertyScope === "selected" && (body.propertyIds ?? []).length === 0) {
      res.status(400).json({ error: "Pick at least one property, or use all properties." });
      return;
    }
    if (body.jobScope === "selected" && (body.jobIds ?? []).length === 0) {
      res.status(400).json({ error: "Pick at least one job, or use all jobs." });
      return;
    }
    // Keep only ids that actually exist so stale selections can't linger.
    const propIds =
      body.propertyScope === "selected"
        ? (
            await db
              .select({ id: propertiesTable.id })
              .from(propertiesTable)
              .where(inArray(propertiesTable.id, body.propertyIds ?? []))
          ).map((p) => p.id)
        : [];
    const jobIds =
      body.jobScope === "selected"
        ? (
            await db
              .select({ id: jobsTable.id })
              .from(jobsTable)
              .where(inArray(jobsTable.id, body.jobIds ?? []))
          ).map((j) => j.id)
        : [];
    grant = {
      features: body.features,
      propertyScope: body.propertyScope,
      propertyIds: propIds,
      jobScope: body.jobScope,
      jobIds,
    };
  }
  const [row] = await db
    .update(crewsTable)
    .set({ accessGrants: grant })
    .where(eq(crewsTable.id, id))
    .returning();
  await db.insert(activitiesTable).values({
    entityType: "crew",
    entityId: id,
    kind: "note",
    body: grant
      ? `Office-view access updated: ${body.features.join(", ")}`
      : "Office-view access removed",
  });
  res.json(
    UpdateCrewAccessResponse.parse({
      ...ser(row),
      access: (row.accessGrants as object | null) ?? null,
    }),
  );
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
    await tx
      .update(schedulesTable)
      .set({ crewLeaderId: null })
      .where(eq(schedulesTable.crewLeaderId, id));
    // Team structure: members reporting to this crew become independent.
    await tx
      .update(crewsTable)
      .set({ leaderId: null })
      .where(eq(crewsTable.leaderId, id));
    await tx
      .delete(crewDispatchAssignmentsTable)
      .where(eq(crewDispatchAssignmentsTable.memberId, id));
    await tx.delete(crewMessagesTable).where(eq(crewMessagesTable.crewId, id));
    await tx.delete(crewCheckinsTable).where(eq(crewCheckinsTable.crewId, id));
    await tx.delete(crewTrackPointsTable).where(eq(crewTrackPointsTable.crewId, id));
    await tx
      .delete(crewRoutePlansTable)
      .where(eq(crewRoutePlansTable.crewId, id));
    await tx
      .delete(crewDocumentsTable)
      .where(eq(crewDocumentsTable.crewId, id));
    await tx.delete(crewPacketsTable).where(eq(crewPacketsTable.crewId, id));
    await tx.delete(crewPaymentsTable).where(eq(crewPaymentsTable.crewId, id));
    await tx.delete(crewPhotosTable).where(eq(crewPhotosTable.crewId, id));
    await tx.delete(photoSharesTable).where(eq(photoSharesTable.crewId, id));
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
