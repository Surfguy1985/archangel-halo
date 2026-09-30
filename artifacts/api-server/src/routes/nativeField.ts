import { Router, type IRouter, type Request } from "express";
import { and, eq, gte, inArray, lte, notInArray } from "drizzle-orm";
import {
  db,
  jobsTable,
  schedulesTable,
  propertiesTable,
  jobLineItemsTable,
  crewDispatchAssignmentsTable,
} from "@workspace/db";
import { findCrewByPortalBearer } from "../lib/portalToken";
import { localToday } from "../lib/localDate";

const router: IRouter = Router();

function bearerFromRequest(req: Request): string | null {
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization.trim() : "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match?.[1]) return match[1].trim();
  const fallback = typeof req.headers["x-halo-crew-token"] === "string"
    ? req.headers["x-halo-crew-token"].trim()
    : "";
  return fallback || null;
}

function plusDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y!, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

router.get("/native/v1/field-feed", async (req, res): Promise<void> => {
  const token = bearerFromRequest(req);
  if (!token) {
    res.status(401).json({ error: "Crew activation token required" });
    return;
  }

  const crew = await findCrewByPortalBearer(token);
  if (!crew || crew.active === false) {
    res.status(401).json({ error: "Crew activation token is invalid or inactive" });
    return;
  }

  const requested = typeof req.query.date === "string" ? req.query.date : "";
  const start = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : localToday();
  const end = plusDays(start, 14);

  const [scheduledRows, dispatchRows, directRows] = await Promise.all([
    db
      .select()
      .from(schedulesTable)
      .where(
        and(
          eq(schedulesTable.crewLeaderId, crew.id),
          gte(schedulesTable.scheduledOn, start),
          lte(schedulesTable.scheduledOn, end),
        ),
      ),
    db
      .select()
      .from(crewDispatchAssignmentsTable)
      .where(
        and(
          eq(crewDispatchAssignmentsTable.memberId, crew.id),
          gte(crewDispatchAssignmentsTable.day, start),
          lte(crewDispatchAssignmentsTable.day, end),
        ),
      ),
    db
      .select()
      .from(jobsTable)
      .where(
        and(
          eq(jobsTable.crewLeaderId, crew.id),
          notInArray(jobsTable.status, ["complete", "paid", "cancelled", "cleared"]),
        ),
      ),
  ]);

  const jobIds = [
    ...new Set(
      [
        ...scheduledRows.map((row) => row.jobId),
        ...dispatchRows.map((row) => row.jobId),
        ...directRows.map((row) => row.id),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];

  if (!jobIds.length) {
    res.json({
      ok: true,
      crew: { id: crew.id, name: crew.name },
      range: { start, end },
      jobs: [],
    });
    return;
  }

  const [jobs, lineItems] = await Promise.all([
    db.select().from(jobsTable).where(inArray(jobsTable.id, jobIds)),
    db.select().from(jobLineItemsTable).where(inArray(jobLineItemsTable.jobId, jobIds)),
  ]);

  const propertyIds = [
    ...new Set(jobs.map((job) => job.propertyId).filter((id): id is string => Boolean(id))),
  ];
  const properties = propertyIds.length
    ? await db.select().from(propertiesTable).where(inArray(propertiesTable.id, propertyIds))
    : [];

  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const scheduleByJob = new Map(scheduledRows.map((row) => [row.jobId, row]));
  const dispatchByJob = new Map(dispatchRows.map((row) => [row.jobId, row]));
  const serviceMap = new Map<string, string[]>();

  for (const line of lineItems) {
    if (!line.service || line.service === "Quoted price") continue;
    const list = serviceMap.get(line.jobId) ?? [];
    if (!list.includes(line.service)) list.push(line.service);
    serviceMap.set(line.jobId, list);
  }

  const payload = jobs.map((job) => {
    const property = propertyById.get(job.propertyId);
    const schedule = scheduleByJob.get(job.id);
    const dispatch = dispatchByJob.get(job.id);

    return {
      id: job.id,
      jobNo: job.jobNo ?? null,
      propertyId: job.propertyId,
      propertyName: property?.name ?? null,
      propertyAddress: property?.address ?? null,
      propertyCity: property?.city ?? null,
      unitNo: job.unitNo ?? null,
      category: job.category ?? null,
      description: job.description ?? null,
      services: serviceMap.get(job.id) ?? [],
      status: job.status,
      boardStatus: job.boardStatus ?? null,
      scheduledOn: schedule?.scheduledOn ?? job.scheduledOn ?? dispatch?.day ?? null,
      scheduledTime: schedule?.windowStart ?? job.scheduledTime ?? null,
      scheduleStatus: schedule?.status ?? null,
      source: dispatch ? "dispatch" : schedule ? "schedule" : "assigned",
      crewLeaderId: job.crewLeaderId ?? crew.id,
      crewLeaderName: crew.name,
      updatedAt: job.createdAt?.toISOString?.() ?? null,
    };
  });

  payload.sort((a, b) => {
    const ad = a.scheduledOn ?? "9999-12-31";
    const bd = b.scheduledOn ?? "9999-12-31";
    if (ad !== bd) return ad.localeCompare(bd);
    return (a.scheduledTime ?? "99:99").localeCompare(b.scheduledTime ?? "99:99");
  });

  res.json({
    ok: true,
    crew: { id: crew.id, name: crew.name },
    range: { start, end },
    jobs: payload,
  });
});

export default router;
