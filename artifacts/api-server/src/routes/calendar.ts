import { Router, type IRouter } from "express";
import { and, gte, lte, eq, inArray } from "drizzle-orm";
import {
  db,
  schedulesTable,
  jobsTable,
  crewsTable,
  propertiesTable,
  calendarEventsTable,
} from "@workspace/db";
import {
  GetCalendarQueryParams,
  GetCalendarResponse,
  CreateCalendarEventBody,
  CreateCalendarEventResponse,
  UpdateCalendarEventParams,
  UpdateCalendarEventBody,
  UpdateCalendarEventResponse,
  DeleteCalendarEventParams,
  DeleteCalendarEventResponse,
} from "@workspace/api-zod";
import { publicPortalBearer } from "../lib/portalToken";

const router: IRouter = Router();

// Deterministic crew -> color token so an event's color is stable across views.
const CREW_COLORS = ["blue", "green", "purple", "orange", "red", "yellow"];
function crewColor(crewId: string | null | undefined): string {
  if (!crewId) return "gold";
  let sum = 0;
  for (let i = 0; i < crewId.length; i++) sum = (sum + crewId.charCodeAt(i)) % 997;
  return CREW_COLORS[sum % CREW_COLORS.length]!;
}

// Normalize a free-form time ("8:00 AM", "8 AM", "14:00", "9") to 24h "HH:MM".
function normalizeTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let hour = parseInt(m[1]!, 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const mer = m[3]?.toLowerCase();
  if (mer === "pm" && hour < 12) hour += 12;
  if (mer === "am" && hour === 12) hour = 0;
  if (hour > 23 || min > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  const total = (h! * 60 + m! + minutes + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

router.get("/calendar", async (req, res): Promise<void> => {
  const { from, to } = GetCalendarQueryParams.parse(req.query);

  const [schedules, crews, props, notes] = await Promise.all([
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          gte(schedulesTable.scheduledOn, from),
          lte(schedulesTable.scheduledOn, to),
        ),
      ),
    db.select().from(crewsTable),
    db.select().from(propertiesTable),
    db
      .select()
      .from(calendarEventsTable)
      .where(
        and(
          gte(calendarEventsTable.eventDate, from),
          lte(calendarEventsTable.eventDate, to),
        ),
      ),
  ]);

  const crewById = new Map(crews.map((c) => [c.id, c]));
  const propById = new Map(props.map((p) => [p.id, p]));
  const jobIds = [...new Set(schedules.map((s) => s.jobId))];
  const jobs = jobIds.length
    ? await db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds))
    : [];
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  const events = [];

  for (const s of schedules) {
    const job = jobById.get(s.jobId);
    const crew = s.crewLeaderId ? crewById.get(s.crewLeaderId) : undefined;
    const prop = job ? propById.get(job.propertyId) : undefined;
    const start = normalizeTime(s.windowStart);
    events.push({
      id: `job-${s.id}`,
      kind: "job" as const,
      title: job?.category || job?.description || "Scheduled job",
      subtitle: prop?.name
        ? `${prop.name}${job?.unitNo ? ` · Unit ${job.unitNo}` : ""}`
        : (job?.description ?? null),
      date: s.scheduledOn,
      start,
      end: start ? addMinutes(start, 120) : null,
      allDay: !start,
      color: crewColor(s.crewLeaderId),
      notes: job?.description ?? null,
      jobId: s.jobId,
      crewId: s.crewLeaderId ?? null,
      crewName: crew?.name ?? null,
      crewPortalToken: publicPortalBearer(crew?.portalToken),
      propertyName: prop?.name ?? null,
      status: s.status ?? null,
    });
  }

  for (const n of notes) {
    const crew = n.crewId ? crewById.get(n.crewId) : undefined;
    events.push({
      id: `note-${n.id}`,
      kind: "note" as const,
      title: n.title,
      subtitle: crew?.name ?? null,
      date: n.eventDate,
      start: normalizeTime(n.startTime),
      end: normalizeTime(n.endTime),
      allDay: n.allDay,
      color: n.color || "gold",
      notes: n.notes ?? null,
      jobId: n.jobId ?? null,
      crewId: n.crewId ?? null,
      crewName: crew?.name ?? null,
      crewPortalToken: publicPortalBearer(crew?.portalToken),
      propertyName: null,
      status: null,
    });
  }

  res.json(GetCalendarResponse.parse({ from, to, events }));
});

async function serEvent(n: typeof calendarEventsTable.$inferSelect) {
  const crew = n.crewId
    ? (await db.select().from(crewsTable).where(eq(crewsTable.id, n.crewId)))[0]
    : undefined;
  return {
    id: `note-${n.id}`,
    kind: "note" as const,
    title: n.title,
    subtitle: crew?.name ?? null,
    date: n.eventDate,
    start: n.startTime,
    end: n.endTime,
    allDay: n.allDay,
    color: n.color || "gold",
    notes: n.notes,
    jobId: n.jobId,
    crewId: n.crewId,
    crewName: crew?.name ?? null,
    crewPortalToken: publicPortalBearer(crew?.portalToken ?? null),
    propertyName: null,
    status: null,
  };
}

router.post("/calendar/events", async (req, res): Promise<void> => {
  const body = CreateCalendarEventBody.parse(req.body);
  const allDay = body.allDay ?? false;
  const startTime = allDay ? null : normalizeTime(body.start);
  const endTime = allDay ? null : normalizeTime(body.end);
  if (startTime && endTime && endTime <= startTime) {
    res.status(400).json({ error: "End time must be after start time." });
    return;
  }
  const [row] = await db
    .insert(calendarEventsTable)
    .values({
      title: body.title,
      notes: body.notes ?? null,
      eventDate: body.date,
      startTime,
      endTime,
      allDay,
      color: body.color || "gold",
      jobId: body.jobId ?? null,
      crewId: body.crewId ?? null,
    })
    .returning();
  res.json(CreateCalendarEventResponse.parse(await serEvent(row!)));
});

router.patch("/calendar/events/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCalendarEventParams.parse(req.params);
  const body = UpdateCalendarEventBody.parse(req.body);
  const patch: Partial<typeof calendarEventsTable.$inferInsert> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.date !== undefined) patch.eventDate = body.date;
  if (body.start !== undefined) patch.startTime = normalizeTime(body.start);
  if (body.end !== undefined) patch.endTime = normalizeTime(body.end);
  if (body.allDay !== undefined) patch.allDay = body.allDay;
  if (body.color !== undefined && body.color) patch.color = body.color;
  if (body.jobId !== undefined) patch.jobId = body.jobId;
  if (body.crewId !== undefined) patch.crewId = body.crewId;

  const [existing] = await db
    .select()
    .from(calendarEventsTable)
    .where(eq(calendarEventsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  const effAllDay = patch.allDay !== undefined ? patch.allDay : existing.allDay;
  const effStart =
    patch.startTime !== undefined ? patch.startTime : existing.startTime;
  const effEnd = patch.endTime !== undefined ? patch.endTime : existing.endTime;
  if (!effAllDay && effStart && effEnd && effEnd <= effStart) {
    res.status(400).json({ error: "End time must be after start time." });
    return;
  }

  const [row] = await db
    .update(calendarEventsTable)
    .set(patch)
    .where(eq(calendarEventsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(UpdateCalendarEventResponse.parse(await serEvent(row)));
});

router.delete("/calendar/events/:id", async (req, res): Promise<void> => {
  const { id } = DeleteCalendarEventParams.parse(req.params);
  const [row] = await db
    .delete(calendarEventsTable)
    .where(eq(calendarEventsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json(DeleteCalendarEventResponse.parse({ id }));
});

export default router;
