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
  WritePropertyBriefParams,
  WritePropertyBriefResponse,
} from "@workspace/api-zod";
import { ser, serList } from "../lib/serialize";
import { completeText } from "../lib/ai";

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
  const [row] = await db.insert(propertiesTable).values(body).returning();
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

  res.json(
    GetPropertyResponse.parse({
      property: ser(property),
      contacts: serList(contacts),
      priceItems: serList(priceItems),
      jobs,
      expenses: serList(expenses),
      agreements: serList(agreements),
      invoices: decoratedInvoices,
      upcomingVisits,
      crewPhotos,
      stats: {
        owed,
        openJobs,
        marginPct,
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
  const [row] = await db
    .update(priceItemsTable)
    .set(body)
    .where(eq(priceItemsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Price item not found" });
    return;
  }
  res.json(UpdatePriceItemResponse.parse(ser(row)));
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

router.post("/properties/:id/price-items", async (req, res): Promise<void> => {
  const { id } = CreatePriceItemParams.parse(req.params);
  const body = CreatePriceItemBody.parse(req.body);
  const [row] = await db
    .insert(priceItemsTable)
    .values({ ...body, propertyId: id })
    .returning();
  res.status(201).json(CreatePriceItemResponse.parse(ser(row)));
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
      imported = await db
        .insert(priceItemsTable)
        .values(
          toInsert.map((c) => ({
            propertyId: id,
            service: c.service,
            detail: c.detail,
            unit: c.unit,
            rate: c.rate,
          })),
        )
        .returning();
    }

    res.json(
      ImportPriceItemsResponse.parse({ imported: serList(imported), skipped }),
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

export default router;
