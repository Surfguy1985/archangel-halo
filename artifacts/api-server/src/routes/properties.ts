import { Router, type IRouter } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { crewPhotosForJobs } from "../lib/jobPhotos";
import {
  db,
  propertiesTable,
  catalogItemsTable,
  contactsTable,
  priceItemsTable,
  jobsTable,
  expensesTable,
  agreementsTable,
  invoicesTable,
  crewsTable,
  jobLineItemsTable,
  schedulesTable,
  crewPaymentsTable,
  crewCheckinsTable,
  activitiesTable,
} from "@workspace/db";
import {
  ListPropertiesResponse,
  ListPropertiesQueryParams,
  CreatePropertyBody,
  CreatePropertyResponse,
  GetPropertyParams,
  GetPropertyResponse,
  UpdatePropertyBody,
  UpdatePropertyParams,
  UpdatePropertyResponse,
  DeletePropertyParams,
  DeletePropertyResponse,
  CreateContactBody,
  CreateContactResponse,
  UpdateContactParams,
  UpdateContactBody,
  UpdateContactResponse,
  DeleteContactParams,
  DeleteContactResponse,
  CreatePriceItemBody,
  CreatePriceItemParams,
  CreatePriceItemResponse,
  UpdatePriceItemParams,
  UpdatePriceItemBody,
  UpdatePriceItemResponse,
  DeletePriceItemParams,
  DeletePriceItemResponse,
  ListCatalogItemsResponse,
  CreateCatalogItemBody,
  CreateCatalogItemResponse,
  UpdateCatalogItemParams,
  UpdateCatalogItemBody,
  UpdateCatalogItemResponse,
  DeleteCatalogItemParams,
  DeleteCatalogItemResponse,
  ImportPriceItemsParams,
  ImportPriceItemsBody,
  ImportPriceItemsResponse,
  ExtractPriceSheetParams,
  ExtractPriceSheetBody,
  ExtractPriceSheetResponse,
  SavePriceSheetItemsParams,
  SavePriceSheetItemsBody,
  SavePriceSheetItemsResponse,
  WritePropertyBriefParams,
  WritePropertyBriefResponse,
} from "@workspace/api-zod";
import { ser, serList } from "../lib/serialize";
import { completeText, completeJson, completeJsonWithImage } from "../lib/ai";
import {
  GeneratePropertyImageParams,
  GeneratePropertyImageResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/properties", async (req, res): Promise<void> => {
  const { search } = ListPropertiesQueryParams.parse(req.query);
  const props = await db
    .select()
    .from(propertiesTable)
    .where(
      search
        ? sql`(${propertiesTable.name} ilike ${"%" + search + "%"} or ${propertiesTable.pmcName} ilike ${"%" + search + "%"})`
        : undefined,
    );
  const items = await Promise.all(
    props.map(async (p) => {
      const [owedRow] = await db
        .select({
          owed: sql<number>`coalesce(sum(${invoicesTable.amount}), 0)`,
        })
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.propertyId, p.id),
            sql`${invoicesTable.status} in ('sent','overdue')`,
          ),
        );
      const [jobRow] = await db
        .select({ open: sql<number>`count(*)` })
        .from(jobsTable)
        .where(
          and(
            eq(jobsTable.propertyId, p.id),
            sql`${jobsTable.status} not in ('complete','closed','cancelled')`,
          ),
        );
      return {
        ...ser(p),
        owed: Number(owedRow?.owed ?? 0),
        openJobs: Number(jobRow?.open ?? 0),
      };
    }),
  );
  res.json(ListPropertiesResponse.parse(items));
});

router.post("/properties", async (req, res): Promise<void> => {
  const body = CreatePropertyBody.parse(req.body);
  if ((body.latitude == null) !== (body.longitude == null)) {
    res.status(400).json({ error: "latitude and longitude must be provided together" });
    return;
  }
  const [row] = await db
    .insert(propertiesTable)
    .values({
      ...body,
      // Pinned coordinates are authoritative — mark as geocoded so the
      // background address geocoder never overwrites them.
      ...(body.latitude != null && body.longitude != null
        ? { geocodedAt: new Date() }
        : {}),
    })
    .returning();
  // Kick off hero image generation in the background — never blocks creation.
  if (row) {
    generateAndStorePropertyImage(row.id).catch((err) =>
      req.log.error({ err }, "Background property image generation failed"),
    );
  }
  res.status(201).json(CreatePropertyResponse.parse(ser(row)));
});

router.get("/properties/:id", async (req, res): Promise<void> => {
  const { id } = GetPropertyParams.parse(req.params);
  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, id));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const contacts = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.propertyId, id));
  const priceItems = await db
    .select()
    .from(priceItemsTable)
    .where(eq(priceItemsTable.propertyId, id));
  const rawJobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.propertyId, id));
  const crews = await db.select().from(crewsTable);
  const crewName = new Map(crews.map((c) => [c.id, c.name]));
  const jobIds = rawJobs.map((j) => j.id);
  const rawLineItems =
    jobIds.length > 0
      ? await db
          .select()
          .from(jobLineItemsTable)
          .where(inArray(jobLineItemsTable.jobId, jobIds))
      : [];
  const lineItemsByJob = new Map<string, typeof rawLineItems>();
  for (const li of rawLineItems) {
    const list = lineItemsByJob.get(li.jobId) ?? [];
    list.push(li);
    lineItemsByJob.set(li.jobId, list);
  }
  const jobs = rawJobs.map((j) => {
    const items = (lineItemsByJob.get(j.id) ?? []).map((li) => ({
      ...ser(li),
      amount: Math.round(li.rate * li.qty * 100) / 100,
    }));
    return {
      ...ser(j),
      propertyName: property.name,
      crewLeaderName: j.crewLeaderId
        ? (crewName.get(j.crewLeaderId) ?? null)
        : null,
      lineItems: items,
      lineTotal:
        Math.round(items.reduce((s, li) => s + li.amount, 0) * 100) / 100,
    };
  });
  const expenses = await db
    .select()
    .from(expensesTable)
    .where(eq(expensesTable.propertyId, id));
  const agreements = await db
    .select()
    .from(agreementsTable)
    .where(eq(agreementsTable.propertyId, id));
  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.propertyId, id));

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const jobsWithMoney = jobs.map((j) => {
    const jobInvoices = invoices.filter(
      (i) => i.jobId === j.id && i.status !== "draft",
    );
    const jobExpenses = expenses.filter((e) => e.jobId === j.id);
    return {
      ...j,
      invoicedTotal: round2(jobInvoices.reduce((s, i) => s + i.amount, 0)),
      paidTotal: round2(
        jobInvoices
          .filter((i) => i.status === "paid")
          .reduce((s, i) => s + i.amount, 0),
      ),
      expensesTotal: round2(jobExpenses.reduce((s, e) => s + e.amount, 0)),
    };
  });

  const isActive = (j: (typeof rawJobs)[number]) =>
    !j.clearedAt && !["complete", "closed", "cancelled"].includes(j.status);
  const weightedMargin = (list: typeof rawJobs): number | null => {
    let revenue = 0;
    let profit = 0;
    let fallbackSum = 0;
    let fallbackN = 0;
    for (const j of list) {
      const jobInvoiced = invoices
        .filter((i) => i.jobId === j.id && i.status !== "draft")
        .reduce((s, i) => s + i.amount, 0);
      if (jobInvoiced > 0 && j.grossProfit != null) {
        revenue += jobInvoiced;
        profit += j.grossProfit;
      } else if (j.marginPct != null) {
        fallbackSum += j.marginPct;
        fallbackN++;
      }
    }
    if (revenue > 0) return Math.round((profit / revenue) * 1000) / 10;
    if (fallbackN > 0) return Math.round((fallbackSum / fallbackN) * 1000) / 10;
    return null;
  };
  const activeMarginPct = weightedMargin(rawJobs.filter(isActive));
  const historicalMarginPct = weightedMargin(
    rawJobs.filter((j) => !isActive(j)),
  );

  const owed = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + i.amount, 0);
  const openJobs = rawJobs.filter(
    (j) => !["complete", "closed", "cancelled"].includes(j.status),
  ).length;
  const now = new Date();
  const mtdRevenue = invoices
    .filter(
      (i) =>
        i.paidAt &&
        i.paidAt.getMonth() === now.getMonth() &&
        i.paidAt.getFullYear() === now.getFullYear(),
    )
    .reduce((s, i) => s + i.amount, 0);
  const withMargin = rawJobs.filter((j) => j.marginPct != null);
  const marginPct =
    withMargin.length > 0
      ? Math.round(
          (withMargin.reduce((s, j) => s + (j.marginPct ?? 0), 0) /
            withMargin.length) *
            1000,
        ) / 10
      : null;

  const invoicedTotal =
    Math.round(
      invoices
        .filter((i) => i.status !== "draft")
        .reduce((s, i) => s + i.amount, 0) * 100,
    ) / 100;
  const collectedTotal =
    Math.round(
      invoices
        .filter((i) => i.status === "paid")
        .reduce((s, i) => s + i.amount, 0) * 100,
    ) / 100;
  const expensesTotal =
    Math.round(expenses.reduce((s, e) => s + e.amount, 0) * 100) / 100;

  const DAY = 24 * 60 * 60 * 1000;
  const decoratedInvoices = invoices
    .slice()
    .sort(
      (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
    )
    .map((i) => ({
      ...ser(i),
      propertyName: property.name,
      daysLate:
        i.paidAt || !i.dueAt
          ? 0
          : Math.max(0, Math.floor((Date.now() - i.dueAt.getTime()) / DAY)),
    }));

  const nowLocal = new Date();
  const todayStr = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, "0")}-${String(nowLocal.getDate()).padStart(2, "0")}`;
  const schedules =
    jobIds.length > 0
      ? await db
          .select()
          .from(schedulesTable)
          .where(inArray(schedulesTable.jobId, jobIds))
      : [];
  const jobById = new Map(rawJobs.map((j) => [j.id, j]));
  const upcomingVisits = schedules
    .filter((s) => s.scheduledOn >= todayStr && s.status !== "cancelled")
    .sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))
    .map((s) => {
      const j = jobById.get(s.jobId);
      return {
        id: s.id,
        jobId: s.jobId,
        scheduledOn: s.scheduledOn,
        windowStart: s.windowStart,
        crewLeaderName: s.crewLeaderId
          ? (crewName.get(s.crewLeaderId) ?? null)
          : null,
        jobDescription: j?.description ?? null,
        unitNo: j?.unitNo ?? null,
      };
    });

  const crewPhotos = await crewPhotosForJobs(rawJobs);

  const [crewPayments, checkins, assignActivities] =
    jobIds.length > 0
      ? await Promise.all([
          db
            .select()
            .from(crewPaymentsTable)
            .where(inArray(crewPaymentsTable.jobId, jobIds)),
          // First crew check-in per job = "work started" for the stage timeline.
          db
            .select()
            .from(crewCheckinsTable)
            .where(inArray(crewCheckinsTable.jobId, jobIds)),
          // Assignment activity rows carry the only timestamp for "crew assigned".
          db
            .select()
            .from(activitiesTable)
            .where(
              and(
                eq(activitiesTable.entityType, "job"),
                eq(activitiesTable.kind, "assigned"),
                inArray(activitiesTable.entityId, jobIds),
              ),
            ),
        ])
      : [[], [], []];
  const firstCheckinByJob = new Map<string, Date>();
  for (const c of checkins) {
    if (!c.jobId || c.kind === "checkout") continue;
    const cur = firstCheckinByJob.get(c.jobId);
    if (!cur || c.createdAt < cur) firstCheckinByJob.set(c.jobId, c.createdAt);
  }
  const lastAssignedByJob = new Map<string, Date>();
  for (const a of assignActivities) {
    if (!a.entityId || !a.createdAt) continue;
    const cur = lastAssignedByJob.get(a.entityId);
    if (!cur || a.createdAt > cur) lastAssignedByJob.set(a.entityId, a.createdAt);
  }
  const jobsWithFunnel = jobsWithMoney.map((j) => {
    const nextVisit = schedules
      .filter(
        (s) =>
          s.jobId === j.id &&
          s.scheduledOn >= todayStr &&
          s.status !== "cancelled",
      )
      .sort((a, b) => a.scheduledOn.localeCompare(b.scheduledOn))[0];
    const payments = crewPayments.filter((p) => p.jobId === j.id);
    const completedPayment = payments.find((p) => p.status === "completed");
    // Board pay-flow: the Job Board records crew pay as crewPay entries and
    // flips boardStatus to pay_alert once the whole roster is paid — treat
    // that as "crew paid" here so the two views can never disagree.
    const raw = jobById.get(j.id);
    const crewPayEntries = Array.isArray(raw?.crewPay)
      ? (raw.crewPay as { paidAt?: string | null }[])
      : [];
    const boardPaidAt =
      raw?.boardStatus === "pay_alert" ||
      (crewPayEntries.length > 0 && crewPayEntries.every((e) => e.paidAt))
        ? (crewPayEntries
            .map((e) => e.paidAt)
            .filter((d): d is string => !!d)
            .sort()
            .at(-1) ?? null)
        : null;
    const paidVia = completedPayment?.paidAt?.toISOString() ?? boardPaidAt;
    return {
      ...j,
      nextVisitOn: nextVisit?.scheduledOn ?? null,
      crewPaymentStatus: paidVia
        ? "paid"
        : payments.length > 0 || crewPayEntries.length > 0
          ? "pending"
          : null,
      crewPaidAt: paidVia,
      crewAssignedAt: lastAssignedByJob.get(j.id)?.toISOString() ?? null,
      workStartedAt: firstCheckinByJob.get(j.id)?.toISOString() ?? null,
    };
  });

  res.json(
    GetPropertyResponse.parse({
      property: ser(property),
      contacts: serList(contacts),
      priceItems: serList(priceItems),
      jobs: jobsWithFunnel,
      expenses: serList(expenses),
      agreements: serList(agreements),
      invoices: decoratedInvoices,
      upcomingVisits,
      crewPhotos,
      stats: {
        owed,
        openJobs,
        marginPct,
        activeMarginPct,
        historicalMarginPct,
        mtdRevenue,
        invoicedTotal,
        collectedTotal,
        expensesTotal,
      },
    }),
  );
});

router.patch("/properties/:id", async (req, res): Promise<void> => {
  const { id } = UpdatePropertyParams.parse(req.params);
  const body = UpdatePropertyBody.parse(req.body);
  const [row] = await db
    .update(propertiesTable)
    .set(body)
    .where(eq(propertiesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  res.json(UpdatePropertyResponse.parse(ser(row)));
});

router.delete("/properties/:id", async (req, res): Promise<void> => {
  const { id } = DeletePropertyParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(eq(propertiesTable.id, id));
    if (!existing) {
      return { status: 404 as const, error: "Property not found" };
    }
    const relatedJobs = await tx
      .select({ id: jobsTable.id })
      .from(jobsTable)
      .where(eq(jobsTable.propertyId, id));
    if (relatedJobs.length > 0) {
      return {
        status: 409 as const,
        error: `This property still has ${relatedJobs.length} job${relatedJobs.length === 1 ? "" : "s"}. Delete or move those first.`,
      };
    }
    const relatedInvoices = await tx
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(eq(invoicesTable.propertyId, id));
    if (relatedInvoices.length > 0) {
      return {
        status: 409 as const,
        error: `This property still has ${relatedInvoices.length} invoice${relatedInvoices.length === 1 ? "" : "s"}. Remove those first to keep your money records intact.`,
      };
    }
    const relatedExpenses = await tx
      .select({ id: expensesTable.id })
      .from(expensesTable)
      .where(eq(expensesTable.propertyId, id));
    if (relatedExpenses.length > 0) {
      return {
        status: 409 as const,
        error: `This property still has ${relatedExpenses.length} expense${relatedExpenses.length === 1 ? "" : "s"}. Remove those first to keep your money records intact.`,
      };
    }
    await tx.delete(agreementsTable).where(eq(agreementsTable.propertyId, id));
    await tx.delete(contactsTable).where(eq(contactsTable.propertyId, id));
    await tx.delete(priceItemsTable).where(eq(priceItemsTable.propertyId, id));
    await tx.delete(propertiesTable).where(eq(propertiesTable.id, id));
    return { status: 200 as const };
  });
  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(DeletePropertyResponse.parse({ ok: true }));
});

router.post("/contacts", async (req, res): Promise<void> => {
  const body = CreateContactBody.parse(req.body);
  const [row] = await db.insert(contactsTable).values(body).returning();
  res.status(201).json(CreateContactResponse.parse(ser(row)));
});

router.patch("/contacts/:id", async (req, res): Promise<void> => {
  const { id } = UpdateContactParams.parse(req.params);
  const body = UpdateContactBody.parse(req.body);
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db
    .update(contactsTable)
    .set(body)
    .where(eq(contactsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json(UpdateContactResponse.parse(ser(row)));
});

router.delete("/contacts/:id", async (req, res): Promise<void> => {
  const { id } = DeleteContactParams.parse(req.params);
  const [row] = await db
    .delete(contactsTable)
    .where(eq(contactsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Contact not found" });
    return;
  }
  res.json(DeleteContactResponse.parse({ ok: true }));
});

router.patch("/price-items/:id", async (req, res): Promise<void> => {
  const { id } = UpdatePriceItemParams.parse(req.params);
  const body = UpdatePriceItemBody.parse(req.body);
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  try {
    const [row] = await db
      .update(priceItemsTable)
      .set(body.service != null ? { ...body, service: body.service.trim() } : body)
      .where(eq(priceItemsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Price item not found" });
      return;
    }
    res.json(UpdatePriceItemResponse.parse(ser(row)));
  } catch (err) {
    // Renaming onto an existing service name would create a duplicate.
    if (isPriceItemDuplicate(err)) {
      res
        .status(409)
        .json({ error: duplicatePriceItemError(body.service?.trim() ?? "This service") });
      return;
    }
    throw err;
  }
});

router.delete("/price-items/:id", async (req, res): Promise<void> => {
  const { id } = DeletePriceItemParams.parse(req.params);
  const [row] = await db
    .delete(priceItemsTable)
    .where(eq(priceItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Price item not found" });
    return;
  }
  res.json(DeletePriceItemResponse.parse({ ok: true }));
});

// Drizzle sometimes wraps the pg error — the unique-violation code can live on
// err.code OR err.cause.code depending on the driver path.
import { isUniqueViolation as isPriceItemDuplicate } from "../lib/dbErrors";

const duplicatePriceItemError = (service: string) =>
  `"${service}" is already on this property's price list. Edit the existing entry instead — two entries with the same name would make price autofill unpredictable.`;

router.post("/properties/:id/price-items", async (req, res): Promise<void> => {
  const { id } = CreatePriceItemParams.parse(req.params);
  const body = CreatePriceItemBody.parse(req.body);
  const service = body.service.trim();
  if (!service) {
    res.status(400).json({ error: "Service name is required" });
    return;
  }
  const [dup] = await db
    .select({ id: priceItemsTable.id })
    .from(priceItemsTable)
    .where(
      and(
        eq(priceItemsTable.propertyId, id),
        sql`lower(trim(${priceItemsTable.service})) = lower(${service})`,
      ),
    );
  if (dup) {
    res.status(409).json({ error: duplicatePriceItemError(service) });
    return;
  }
  try {
    const [row] = await db
      .insert(priceItemsTable)
      .values({ ...body, service, propertyId: id })
      .returning();
    res.status(201).json(CreatePriceItemResponse.parse(ser(row)));
  } catch (err) {
    // Race: two concurrent creates can both pass the pre-check — the unique
    // index is the backstop.
    if (isPriceItemDuplicate(err)) {
      res.status(409).json({ error: duplicatePriceItemError(service) });
      return;
    }
    throw err;
  }
});

router.get("/catalog-items", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(catalogItemsTable)
    .orderBy(catalogItemsTable.service);
  res.json(ListCatalogItemsResponse.parse(serList(rows)));
});

router.post("/catalog-items", async (req, res): Promise<void> => {
  const body = CreateCatalogItemBody.parse(req.body);
  const [row] = await db.insert(catalogItemsTable).values(body).returning();
  res.status(201).json(CreateCatalogItemResponse.parse(ser(row)));
});

router.patch("/catalog-items/:id", async (req, res): Promise<void> => {
  const { id } = UpdateCatalogItemParams.parse(req.params);
  const body = UpdateCatalogItemBody.parse(req.body);
  if (Object.keys(body).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  const [row] = await db
    .update(catalogItemsTable)
    .set(body)
    .where(eq(catalogItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Catalog item not found" });
    return;
  }
  res.json(UpdateCatalogItemResponse.parse(ser(row)));
});

router.delete("/catalog-items/:id", async (req, res): Promise<void> => {
  const { id } = DeleteCatalogItemParams.parse(req.params);
  const [row] = await db
    .delete(catalogItemsTable)
    .where(eq(catalogItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Catalog item not found" });
    return;
  }
  res.json(DeleteCatalogItemResponse.parse({ ok: true }));
});

router.post(
  "/properties/:id/price-items/import",
  async (req, res): Promise<void> => {
    const { id } = ImportPriceItemsParams.parse(req.params);
    const { catalogItemIds } = ImportPriceItemsBody.parse(req.body);

    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, id));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const catalogRows = await db
      .select()
      .from(catalogItemsTable)
      .where(inArray(catalogItemsTable.id, catalogItemIds));
    if (catalogRows.length === 0) {
      res.status(400).json({ error: "No matching catalog items" });
      return;
    }

    const existing = await db
      .select()
      .from(priceItemsTable)
      .where(eq(priceItemsTable.propertyId, id));
    const existingServices = new Set(
      existing.map((p) => p.service.trim().toLowerCase()),
    );

    const seen = new Set<string>();
    const toInsert = catalogRows.filter((c) => {
      const key = c.service.trim().toLowerCase();
      if (existingServices.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const skipped = catalogRows.length - toInsert.length;

    let imported: (typeof priceItemsTable.$inferSelect)[] = [];
    if (toInsert.length > 0) {
      // onConflictDoNothing: a concurrent add can slip past the pre-filter —
      // the (propertyId, service) unique index quietly skips it instead of
      // failing the whole import.
      imported = await db
        .insert(priceItemsTable)
        .values(
          toInsert.map((c) => ({
            propertyId: id,
            service: c.service.trim(),
            detail: c.detail,
            unit: c.unit,
            rate: c.rate ?? 0,
            category: c.category,
          })),
        )
        .onConflictDoNothing()
        .returning();
    }

    res.json(
      ImportPriceItemsResponse.parse({
        imported: serList(imported),
        skipped: skipped + (toInsert.length - imported.length),
      }),
    );
  },
);

const normalizeService = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

const PRICE_SHEET_MAX_BASE64_CHARS = 14_000_000;

type ExtractedPriceRow = {
  service?: string;
  rate?: number | null;
  unit?: string | null;
  detail?: string | null;
  bidOnly?: boolean | null;
  confidence?: number | null;
};

router.post(
  "/properties/:id/price-items/extract",
  async (req, res): Promise<void> => {
    const { id } = ExtractPriceSheetParams.parse(req.params);
    const body = ExtractPriceSheetBody.parse(req.body);

    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, id));
    if (!property) {
      res.status(404).json({ error: "Property not found" });
      return;
    }

    const hasText = !!body.content && body.content.trim().length > 0;
    const hasImage = !!body.image && !!body.mediaType;
    if (!hasText && !hasImage) {
      res.status(400).json({ error: "Provide the file's text content or an image." });
      return;
    }
    if (hasImage && (body.image as string).length > PRICE_SHEET_MAX_BASE64_CHARS) {
      res.status(413).json({ error: "File too large. Try a smaller file or photo." });
      return;
    }

    const systemPrompt = `You are HALO's price-sheet reader for a property-maintenance contractor.
The office uploaded a price list / rate sheet / bid sheet for the property "${property.name}". Extract EVERY service line as one row.
Rules:
- service: the service name exactly as written (trim numbering/bullets).
- rate: the price as a number (no $ or commas). If the price is "BID", "quote", "TBD", "per quote", "varies", or missing, set rate to null and bidOnly to true.
- bidOnly: true ONLY for lines without a fixed price (bid/quote/TBD); false when a numeric price is given.
- unit: the pricing unit when stated (each, sqft, hour, unit, door, month...), else null.
- detail: any extra description/notes for the line, else null.
- confidence: 0-1 how sure you are you read the line correctly.
- Transcribe names and numbers EXACTLY as printed — never invent or round values. Skip headers, totals, and non-service text.
Return {"summary": "one sentence", "rows": [{ "service", "rate", "unit", "detail", "bidOnly", "confidence" }]}.`;

    let parsed: { summary?: string | null; rows?: ExtractedPriceRow[] };
    try {
      if (hasImage) {
        parsed = await completeJsonWithImage<typeof parsed>(
          systemPrompt,
          `Filename: ${body.filename ?? "price sheet"}. Extract the price rows from this document.`,
          body.image as string,
          body.mediaType as
            | "image/jpeg"
            | "image/png"
            | "image/webp"
            | "image/gif"
            | "application/pdf",
          8192,
        );
      } else {
        parsed = await completeJson<typeof parsed>(
          systemPrompt,
          `Filename: ${body.filename ?? "price sheet"}\n\nContent:\n${(body.content as string).slice(0, 40000)}`,
          8192,
        );
      }
    } catch (err) {
      req.log.error({ err }, "price sheet extract failed");
      res.status(502).json({ error: "Could not read the price sheet. Please try again." });
      return;
    }

    const rows = (parsed.rows ?? [])
      .filter((r) => r.service && String(r.service).trim())
      .map((r) => {
        const rate =
          typeof r.rate === "number" && Number.isFinite(r.rate) && r.rate >= 0
            ? r.rate
            : null;
        return {
          service: String(r.service).trim(),
          rate,
          unit: r.unit ? String(r.unit) : null,
          detail: r.detail ? String(r.detail) : null,
          bidOnly: rate == null ? true : !!r.bidOnly,
          confidence: typeof r.confidence === "number" ? r.confidence : null,
        };
      });

    res.json(
      ExtractPriceSheetResponse.parse({
        summary: parsed.summary ?? null,
        rows,
      }),
    );
  },
);

router.post(
  "/properties/:id/price-items/bulk",
  async (req, res): Promise<void> => {
    const { id } = SavePriceSheetItemsParams.parse(req.params);
    const { items } = SavePriceSheetItemsBody.parse(req.body);

    const result = await db.transaction(async (tx) => {
      const [property] = await tx
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.id, id));
      if (!property) return null;

      const existing = await tx
        .select()
        .from(priceItemsTable)
        .where(eq(priceItemsTable.propertyId, id));
      const byService = new Map(existing.map((p) => [normalizeService(p.service), p]));

      const imported: (typeof priceItemsTable.$inferSelect)[] = [];
      const updated: (typeof priceItemsTable.$inferSelect)[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        const key = normalizeService(item.service);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const match = byService.get(key);
        if (match) {
          const [row] = await tx
            .update(priceItemsTable)
            .set({
              rate: item.rate,
              unit: item.unit ?? match.unit,
              detail: item.detail ?? match.detail,
            })
            .where(eq(priceItemsTable.id, match.id))
            .returning();
          updated.push(row);
        } else {
          const [row] = await tx
            .insert(priceItemsTable)
            .values({
              propertyId: id,
              service: item.service.trim(),
              rate: item.rate,
              unit: item.unit ?? null,
              detail: item.detail ?? null,
            })
            .returning();
          imported.push(row);
        }
      }
      return { imported, updated };
    });

    if (!result) {
      res.status(404).json({ error: "Property not found" });
      return;
    }
    res.json(
      SavePriceSheetItemsResponse.parse({
        imported: serList(result.imported),
        updated: serList(result.updated),
      }),
    );
  },
);

router.post("/properties/:id/brief", async (req, res): Promise<void> => {
  const { id } = WritePropertyBriefParams.parse(req.params);
  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, id));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const contacts = await db
    .select()
    .from(contactsTable)
    .where(eq(contactsTable.propertyId, id));
  const priceItems = await db
    .select()
    .from(priceItemsTable)
    .where(eq(priceItemsTable.propertyId, id));
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(eq(jobsTable.propertyId, id));
  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.propertyId, id));

  const owed = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((s, i) => s + i.amount, 0);

  const context = {
    property: {
      name: property.name,
      pmc: property.pmcName,
      city: property.city,
      units: property.units,
      accessNotes: property.accessNotes,
      avgDaysToPay: property.avgDaysToPay,
    },
    contacts: contacts.map((c) => ({
      name: c.name,
      role: c.role,
      prefers: c.prefers,
    })),
    priceItems: priceItems.map((p) => ({
      service: p.service,
      rate: p.rate,
      unit: p.unit,
    })),
    openJobs: jobs.filter(
      (j) => !["complete", "closed", "cancelled"].includes(j.status),
    ).length,
    totalJobs: jobs.length,
    owed,
  };

  let brief: string;
  try {
    brief = await completeText(
      "You are HALO, an operations chief of staff for a property-maintenance contractor. Write a tight, plain-spoken briefing (3-5 short sentences) a busy owner can read in 15 seconds. Cover the relationship, how they like to work, what to watch for on money and access, and any risk. No headings, no bullet points, no fluff.",
      `Write the working brief for this property:\n${JSON.stringify(context, null, 2)}`,
      1024,
    );
  } catch {
    brief =
      property.brief ??
      `${property.name} (${property.pmcName ?? "PMC"}) — ${context.openJobs} open job(s), $${owed} outstanding. Brief could not be regenerated; showing last known notes.`;
  }

  const [row] = await db
    .update(propertiesTable)
    .set({ brief, briefUpdatedAt: new Date() })
    .where(eq(propertiesTable.id, id))
    .returning();

  res.json(WritePropertyBriefResponse.parse(ser(row)));
});

// ---------------------------------------------------------------------------
// AI property hero image generation
// ---------------------------------------------------------------------------

const imageInFlight = new Set<string>();

async function generateAndStorePropertyImage(propertyId: string): Promise<
  typeof propertiesTable.$inferSelect | null
> {
  if (imageInFlight.has(propertyId)) return null;
  imageInFlight.add(propertyId);
  try {
    const [property] = await db
      .select()
      .from(propertiesTable)
      .where(eq(propertiesTable.id, propertyId));
    if (!property) return null;
    // Never regenerate an existing image — caps spend.
    if (property.imagePath) return property;

    const locationBits = [property.address, property.city]
      .filter(Boolean)
      .join(", ");
    const sizeHint =
      property.units && property.units > 40
        ? "a large multi-building apartment community"
        : property.units && property.units > 8
          ? "a mid-size garden-style apartment complex"
          : property.units && property.units > 1
            ? "a small residential multifamily building"
            : "a well-kept commercial/residential property";

    const prompt = [
      `Photorealistic golden-hour aerial photograph of ${sizeHint}`,
      locationBits ? `located at ${locationBits}` : "in an American suburb",
      `named "${property.name}".`,
      "Shot from a drone at roughly 60 meters, three-quarter angle, architectural photography style.",
      "Manicured landscaping, clean parking areas, warm late-afternoon light, soft long shadows, clear sky.",
      "Realistic regional architecture consistent with the location. No people, no text, no watermarks, no logos.",
      "High-end real-estate marketing photo, crisp, natural colors, Apple-advert level of polish.",
    ].join(" ");

    const { generateImageBuffer } = await import(
      "@workspace/integrations-openai-ai-server/image"
    );
    const buffer = await generateImageBuffer(prompt, "1536x1024");
    if (!buffer || buffer.length === 0) {
      throw new Error("Empty image buffer returned");
    }

    const { ObjectStorageService } = await import("../lib/objectStorage");
    const svc = new ObjectStorageService();
    const uploadURL = await svc.getObjectEntityUploadURL();
    const putRes = await fetch(uploadURL, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: new Uint8Array(buffer),
    });
    if (!putRes.ok) {
      throw new Error(`Storage upload failed: ${putRes.status}`);
    }
    const imagePath = svc.normalizeObjectEntityPath(uploadURL);

    const [row] = await db
      .update(propertiesTable)
      .set({ imagePath, imageGeneratedAt: new Date() })
      .where(eq(propertiesTable.id, propertyId))
      .returning();
    return row ?? null;
  } finally {
    imageInFlight.delete(propertyId);
  }
}

router.post("/properties/:id/image", async (req, res): Promise<void> => {
  const { id } = GeneratePropertyImageParams.parse(req.params);
  const [existing] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Property not found" });
    return;
  }
  if (imageInFlight.has(id)) {
    res.json(GeneratePropertyImageResponse.parse(ser(existing)));
    return;
  }
  try {
    const row = await generateAndStorePropertyImage(id);
    res.json(GeneratePropertyImageResponse.parse(ser(row ?? existing)));
  } catch (err) {
    req.log.error({ err }, "Property image generation failed");
    res.status(500).json({ error: "Image generation failed" });
  }
});

export default router;
