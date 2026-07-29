import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  clientAccountsTable,
  workRequestsTable,
  propertiesTable,
  priceItemsTable,
  jobsTable,
  notificationsTable,
  activitiesTable,
} from "@workspace/db";
import {
  GetClientRequestOptionsResponse,
  CreateClientWorkRequestBody,
  CreateClientWorkRequestResponse,
  ListWorkRequestsResponse,
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

function serRequest(
  r: typeof workRequestsTable.$inferSelect,
  propName: Map<string, string>,
  jobNo?: string | null,
) {
  return {
    id: r.id,
    propertyId: r.propertyId,
    propertyName: propName.get(r.propertyId) ?? "Unknown property",
    requesterName: r.requesterName,
    serviceId: r.serviceId,
    serviceLabel: r.serviceLabel,
    unitNo: r.unitNo,
    notes: r.notes,
    neededBy: r.neededBy,
    status: r.status,
    declineReason: r.declineReason,
    jobId: r.jobId,
    jobNo: jobNo ?? null,
    decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
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
  const [row] = await db
    .insert(workRequestsTable)
    .values({
      propertyId: account.propertyId,
      requesterName: body.requesterName?.trim() || null,
      serviceId: body.serviceId ?? null,
      serviceLabel: body.serviceLabel.trim(),
      unitNo: body.unitNo?.trim() || null,
      notes: body.notes?.trim() || null,
      neededBy: body.neededBy ?? null,
    })
    .returning();
  const propName = await propertyNameMap();
  const pn = propName.get(account.propertyId) ?? "a property";
  await db.insert(notificationsTable).values({
    kind: "work_request",
    priority: "high",
    entityType: "work_request",
    entityId: row!.id,
    title: `New work request from ${pn}`,
    body: `${row!.serviceLabel}${row!.unitNo ? ` — Unit ${row!.unitNo}` : ""}${row!.neededBy ? ` — needed by ${row!.neededBy}` : ""}. Review it in Pipeline.`,
  });
  await db.insert(activitiesTable).values({
    entityType: "property",
    entityId: account.propertyId,
    kind: "note",
    body: `Work request submitted${row!.requesterName ? ` by ${row!.requesterName}` : ""}: ${row!.serviceLabel}${row!.neededBy ? ` (needed by ${row!.neededBy})` : ""}`,
  });
  res
    .status(201)
    .json(CreateClientWorkRequestResponse.parse(serRequest(row!, propName)));
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
  let jobNo = "";
  let jobId = "";
  try {
    await db.transaction(async (tx) => {
      // First-wins guard: only the transition pending -> accepted proceeds.
      const claimed = await tx
        .update(workRequestsTable)
        .set({ status: "accepted", decidedAt: new Date() })
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
        request.serviceLabel,
        request.notes ? `Notes from PM: ${request.notes}` : null,
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
          scheduleType: request.neededBy ? "flex" : "scheduled",
          flexDueBy: request.neededBy,
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
    body: `Job created from client work request: ${request.serviceLabel}${request.neededBy ? ` — complete by ${request.neededBy}` : ""}`,
  });
  const [fresh] = await db
    .select()
    .from(workRequestsTable)
    .where(eq(workRequestsTable.id, id))
    .limit(1);
  res.json(AcceptWorkRequestResponse.parse(serRequest(fresh!, propName, jobNo)));
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
  res.json(DeclineWorkRequestResponse.parse(serRequest(declined[0]!, propName)));
});

export default router;
