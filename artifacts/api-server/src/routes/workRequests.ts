import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  workRequestsTable,
  propertiesTable,
  propertyUnitsTable,
  priceItemsTable,
  jobsTable,
  notificationsTable,
  activitiesTable,
} from "@workspace/db";
import { sendEmail } from "../lib/email";
import { ADMIN_EMAIL } from "../lib/notifications";
import { emitBoardEvent } from "../lib/boardEvents";
import { logger } from "../lib/logger";
import {
  GetClientRequestOptionsResponse,
  CreateClientWorkRequestBody,
  CreateClientWorkRequestResponse,
  ListWorkRequestsResponse,
  AcceptWorkRequestBody,
  AcceptWorkRequestResponse,
  DeclineWorkRequestBody,
  DeclineWorkRequestResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function accountByToken(token: string) {
  const [account] = await db
    .select()
    .from(clientAccountsTable)
    .where(eq(clientAccountsTable.dashboardToken, token))
    .limit(1);
  return account && account.status === "active" ? account : undefined;
}

async function propertyNameMap(): Promise<Map<string, string>> {
  const props = await db
    .select({ id: propertiesTable.id, name: propertiesTable.name })
    .from(propertiesTable);
  return new Map(props.map((p) => [p.id, p.name]));
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function serRequest(
  r: typeof workRequestsTable.$inferSelect,
  propName: Map<string, string>,
  jobNo?: string | null,
  changeOrderJobNo?: string | null,
) {
  return {
    id: r.id,
    propertyId: r.propertyId,
    propertyName: propName.get(r.propertyId) ?? "Unknown property",
    requesterName: r.requesterName,
    serviceId: r.serviceId,
    serviceLabel: r.serviceLabel,
    unitNo: r.unitNo,
    units: strArray(r.units),
    notes: r.notes,
    neededBy: r.neededBy,
    emergency: r.emergency,
    poNumber: r.poNumber,
    // Manual /api asset links must be absolute — never BASE_URL-prefixed.
    photoUrls: strArray(r.photoPaths).map((p) => `/api/storage${p}`),
    changeOrderJobId: r.changeOrderJobId,
    changeOrderJobNo: changeOrderJobNo ?? null,
    status: r.status,
    declineReason: r.declineReason,
    adjustNote: r.adjustNote,
    jobId: r.jobId,
    jobNo: jobNo ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

// A request is an emergency when explicitly flagged or needed within 24h.
// neededBy is a LOCAL date-only string; compare against local tomorrow.
function isWithin24h(neededBy: string | null | undefined): boolean {
  if (!neededBy) return false;
  const [y, m, d] = neededBy.split("-").map(Number);
  if (!y || !m || !d) return false;
  const due = new Date(y, m - 1, d, 23, 59, 59);
  return due.getTime() - Date.now() <= 24 * 3600 * 1000;
}

// ---------------------------------------------------------------------------
// Client (property manager) side — gated by the dashboard token.
// ---------------------------------------------------------------------------

router.get(
  "/client/:token/request-options",
  async (req, res): Promise<void> => {
    const account = await accountByToken(String(req.params.token));
    if (!account) {
      res.status(404).json({ error: "Invalid link" });
      return;
    }
    const [prop] = await db
      .select({ name: propertiesTable.name })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, account.propertyId))
      .limit(1);
    const services = await db
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.propertyId, account.propertyId));
    services.sort((a, b) => a.service.localeCompare(b.service));
    const units = await db
      .select({ label: propertyUnitsTable.label })
      .from(propertyUnitsTable)
      .where(eq(propertyUnitsTable.propertyId, account.propertyId));
    const unitLabels = units
      .map((u) => u.label)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    res.json(
      GetClientRequestOptionsResponse.parse({
        propertyName: prop?.name ?? "Your property",
        logoUrl: account.logoPath ? `/api/storage${account.logoPath}` : null,
        services: services.map((s) => ({
          id: s.id,
          service: s.service,
          detail: s.detail,
          unit: s.unit,
        })),
        unitLabels,
      }),
    );
  },
);

router.post("/client/:token/requests", async (req, res): Promise<void> => {
  const parsed = CreateClientWorkRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;
  const account = await accountByToken(String(req.params.token));
  if (!account) {
    res.status(404).json({ error: "Invalid link" });
    return;
  }
  if (!body.serviceLabel.trim()) {
    res.status(400).json({ error: "Pick a service" });
    return;
  }
  if (body.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(body.neededBy)) {
    res.status(400).json({ error: "Complete-by date must be YYYY-MM-DD" });
    return;
  }
  // Ownership check: a picked service must belong to this property.
  if (body.serviceId) {
    const [svc] = await db
      .select({ id: priceItemsTable.id })
      .from(priceItemsTable)
      .where(
        and(
          eq(priceItemsTable.id, body.serviceId),
          eq(priceItemsTable.propertyId, account.propertyId),
        ),
      )
      .limit(1);
    if (!svc) {
      res.status(400).json({ error: "That service isn't on your list" });
      return;
    }
  }
  // Multi-unit list: trimmed, deduped, capped.
  const units = [...new Set((body.units ?? []).map((u) => u.trim()).filter(Boolean))];
  if (units.length > 50) {
    res.status(400).json({ error: "Pick at most 50 units per request" });
    return;
  }
  // Photos must be storage object paths from our own upload flow.
  const photoPaths = (body.photoPaths ?? []).slice(0, 10);
  if (photoPaths.some((p) => !p.startsWith("/objects/"))) {
    res.status(400).json({ error: "Invalid photo attachment" });
    return;
  }
  // Change orders must reference a job on THIS property (no FKs — manual guard).
  let changeOrderJob: { id: string; jobNo: string } | null = null;
  if (body.changeOrderJobId) {
    const [job] = await db
      .select({ id: jobsTable.id, jobNo: jobsTable.jobNo, propertyId: jobsTable.propertyId })
      .from(jobsTable)
      .where(eq(jobsTable.id, body.changeOrderJobId))
      .limit(1);
    if (!job || job.propertyId !== account.propertyId) {
      res.status(400).json({ error: "That job isn't on your property" });
      return;
    }
    changeOrderJob = { id: job.id, jobNo: job.jobNo };
  }
  const emergency = body.emergency === true || isWithin24h(body.neededBy);
  // PO number is mandatory for normal requests. Emergencies may skip it —
  // they land as urgent "Action Required" items the office manually approves
  // (and can attach a PO to) before the work is posted.
  const poNumber = body.poNumber?.trim() || null;
  if (!emergency && !poNumber) {
    res.status(400).json({ error: "A PO number is required — or mark the request as an emergency" });
    return;
  }
  const [row] = await db
    .insert(workRequestsTable)
    .values({
      propertyId: account.propertyId,
      requesterName: body.requesterName?.trim() || null,
      serviceId: body.serviceId ?? null,
      serviceLabel: body.serviceLabel.trim(),
      unitNo: units[0] ?? (body.unitNo?.trim() || null),
      units: units.length ? units : null,
      notes: body.notes?.trim() || null,
      neededBy: body.neededBy ?? null,
      emergency,
      poNumber,
      photoPaths: photoPaths.length ? photoPaths : null,
      changeOrderJobId: changeOrderJob?.id ?? null,
    })
    .returning();
  const propName = await propertyNameMap();
  const pn = propName.get(account.propertyId) ?? "a property";
  const unitsLabel = units.length
    ? ` — Unit${units.length > 1 ? "s" : ""} ${units.join(", ")}`
    : row!.unitNo
      ? ` — Unit ${row!.unitNo}`
      : "";
  const kindLabel = changeOrderJob
    ? `Change order on Job ${changeOrderJob.jobNo}`
    : "work request";
  await db.insert(notificationsTable).values({
    kind: "work_request",
    priority: emergency ? "urgent" : "high",
    entityType: "work_request",
    entityId: row!.id,
    title: emergency
      ? `EMERGENCY request from ${pn}`
      : `New ${kindLabel} from ${pn}`,
    body: `${row!.serviceLabel}${unitsLabel}${row!.neededBy ? ` — needed by ${row!.neededBy}` : ""}${poNumber ? ` — PO ${poNumber}` : " — NO PO (manual approval)"}. Review it in Today or Pipeline.`,
  });
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: account.propertyId,
    kind: "note",
    body: `${emergency ? "EMERGENCY " : ""}${changeOrderJob ? `Change order (Job ${changeOrderJob.jobNo})` : "Work request"} submitted${row!.requesterName ? ` by ${row!.requesterName}` : ""}: ${row!.serviceLabel}${unitsLabel}${row!.neededBy ? ` (needed by ${row!.neededBy})` : ""}`,
  });
  // Emergencies skip the digest cycle: immediate office email, best-effort.
  if (emergency) {
    try {
      await sendEmail({
        to: ADMIN_EMAIL,
        subject: `🚨 Emergency request — ${pn}: ${row!.serviceLabel}`,
        html: `<p><strong>${pn}</strong> filed an emergency request${row!.requesterName ? ` (by ${row!.requesterName})` : ""}.</p><p>${row!.serviceLabel}${unitsLabel}${row!.neededBy ? ` — needed by <strong>${row!.neededBy}</strong>` : ""}</p><p>${poNumber ? `PO ${poNumber}` : "<strong>No PO provided</strong> — approve and post it manually."}</p>${row!.notes ? `<p>${row!.notes}</p>` : ""}<p>Approve or decline it from the Today feed.</p>`,
      });
    } catch (err) {
      logger.error({ err }, "emergency work-request alert email failed");
    }
  }
  // Live-update the client's own board (card appears in Requested instantly).
  emitBoardEvent(account.propertyId);
  res
    .status(201)
    .json(CreateClientWorkRequestResponse.parse(serRequest(row!, propName, null, changeOrderJob?.jobNo ?? null)));
});

// ---------------------------------------------------------------------------
// Office side — Pipeline list + accept/decline.
// ---------------------------------------------------------------------------

router.get("/work-requests", async (req, res): Promise<void> => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  let rows = await db
    .select()
    .from(workRequestsTable)
    .orderBy(desc(workRequestsTable.createdAt));
  if (status) rows = rows.filter((r) => r.status === status);
  const propName = await propertyNameMap();
  // Attach jobNo for accepted requests.
  const jobIds = rows.map((r) => r.jobId).filter((v): v is string => !!v);
  const jobNoById = new Map<string, string>();
  if (jobIds.length) {
    const jobs = await db
      .select({ id: jobsTable.id, jobNo: jobsTable.jobNo })
      .from(jobsTable);
    for (const j of jobs) jobNoById.set(j.id, j.jobNo);
  }
  res.json(
    ListWorkRequestsResponse.parse(
      rows.map((r) =>
        serRequest(r, propName, r.jobId ? jobNoById.get(r.jobId) : null),
      ),
    ),
  );
});

router.post("/work-requests/:id/accept", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const parsedBody = AcceptWorkRequestBody.safeParse(req.body ?? {});
  const adjust = parsedBody.success ? parsedBody.data : {};
  if (adjust.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(adjust.neededBy)) {
    res.status(400).json({ error: "Adjusted date must be YYYY-MM-DD" });
    return;
  }
  const [request] = await db
    .select()
    .from(workRequestsTable)
    .where(eq(workRequestsTable.id, id))
    .limit(1);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (request.status !== "pending") {
    res.status(409).json({ error: `Request is already ${request.status}` });
    return;
  }
  // Change orders reference an existing job; carry its number into the record.
  let changeOrderJobNo: string | null = null;
  if (request.changeOrderJobId) {
    const [coJob] = await db
      .select({ jobNo: jobsTable.jobNo })
      .from(jobsTable)
      .where(eq(jobsTable.id, request.changeOrderJobId))
      .limit(1);
    changeOrderJobNo = coJob?.jobNo ?? null;
  }
  const adjustNote = adjust.note?.trim() || null;
  const neededBy = adjust.neededBy ?? request.neededBy;
  const units = strArray(request.units);
  let jobNo = "";
  let jobId = "";
  try {
    await db.transaction(async (tx) => {
      // First-wins guard: only the transition pending -> accepted proceeds.
      const claimed = await tx
        .update(workRequestsTable)
        .set({ status: "accepted", decidedAt: new Date(), adjustNote })
        .where(
          and(
            eq(workRequestsTable.id, id),
            eq(workRequestsTable.status, "pending"),
          ),
        )
        .returning();
      if (claimed.length === 0) throw new Error("ALREADY_DECIDED");
      // Job number pattern matches POST /jobs (J-2xxx from row count).
      const existing = await tx.select({ id: jobsTable.id }).from(jobsTable);
      jobNo = `J-${String(2000 + existing.length + 1)}`;
      const description = [
        request.emergency ? "EMERGENCY (≤24h notice)" : null,
        changeOrderJobNo ? `Change order on Job ${changeOrderJobNo}` : null,
        request.serviceLabel,
        units.length > 1 ? `Units: ${units.join(", ")}` : null,
        request.notes ? `Notes from PM: ${request.notes}` : null,
        adjustNote ? `Office adjustment: ${adjustNote}` : null,
        request.requesterName ? `Requested by ${request.requesterName}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const [job] = await tx
        .insert(jobsTable)
        .values({
          jobNo,
          propertyId: request.propertyId,
          unitNo: request.unitNo,
          category: request.serviceLabel,
          description,
          status: "open",
          // Requested complete-by date becomes a flex deadline on the card.
          scheduleType: neededBy ? "flex" : "scheduled",
          flexDueBy: neededBy,
        })
        .returning();
      jobId = job!.id;
      await tx
        .update(workRequestsTable)
        .set({ jobId })
        .where(eq(workRequestsTable.id, id));
    });
  } catch (e) {
    if (e instanceof Error && e.message === "ALREADY_DECIDED") {
      res.status(409).json({ error: "Request was already decided" });
      return;
    }
    throw e;
  }
  const propName = await propertyNameMap();
  await db.insert(activitiesTable).values({
    entityType: "job",
    entityId: jobId,
    kind: "note",
    body: `Job created from client ${request.changeOrderJobId ? "change order" : "work request"}: ${request.serviceLabel}${neededBy ? ` — complete by ${neededBy}` : ""}${adjustNote ? ` (adjusted: ${adjustNote})` : ""}`,
  });
  // Change orders also leave a note on the ORIGINAL job so the office sees
  // the change attached to the work it modifies.
  if (request.changeOrderJobId) {
    await db.insert(activitiesTable).values({
      entityType: "job",
      entityId: request.changeOrderJobId,
      kind: "note",
      body: `Client change order approved → new Job ${jobNo}: ${request.serviceLabel}`,
    });
  }
  // The client's Requested card flips to the job card on next read.
  emitBoardEvent(request.propertyId);
  const [fresh] = await db
    .select()
    .from(workRequestsTable)
    .where(eq(workRequestsTable.id, id))
    .limit(1);
  res.json(
    AcceptWorkRequestResponse.parse(
      serRequest(fresh!, propName, jobNo, changeOrderJobNo),
    ),
  );
});

router.post("/work-requests/:id/decline", async (req, res): Promise<void> => {
  const id = String(req.params.id);
  const body = DeclineWorkRequestBody.safeParse(req.body ?? {});
  const reason = body.success ? (body.data.reason ?? null) : null;
  const declined = await db
    .update(workRequestsTable)
    .set({ status: "declined", declineReason: reason, decidedAt: new Date() })
    .where(
      and(eq(workRequestsTable.id, id), eq(workRequestsTable.status, "pending")),
    )
    .returning();
  if (declined.length === 0) {
    const [exists] = await db
      .select({ status: workRequestsTable.status })
      .from(workRequestsTable)
      .where(eq(workRequestsTable.id, id))
      .limit(1);
    if (!exists) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    res.status(409).json({ error: `Request is already ${exists.status}` });
    return;
  }
  const propName = await propertyNameMap();
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: declined[0]!.propertyId,
    kind: "note",
    body: `Work request declined: ${declined[0]!.serviceLabel}${reason ? ` — ${reason}` : ""}`,
  });
  // The decline reason lands on the client's card right away.
  emitBoardEvent(declined[0]!.propertyId);
  res.json(DeclineWorkRequestResponse.parse(serRequest(declined[0]!, propName)));
});

export default router;
