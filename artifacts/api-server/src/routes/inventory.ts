import { Router, type IRouter } from "express";
import { desc, eq, and } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  vendorsTable,
  vendorRatesTable,
  purchaseOrdersTable,
  jobsTable,
  catalogItemsTable,
} from "@workspace/db";
import {
  ListInventoryResponse,
  CreateInventoryItemBody,
  CreateInventoryItemResponse,
  AdjustInventoryBody,
  AdjustInventoryParams,
  AdjustInventoryResponse,
  ListVendorsResponse,
  CreateVendorBody,
  CreateVendorResponse,
  UpdateVendorParams,
  UpdateVendorBody,
  UpdateVendorResponse,
  DeleteVendorParams,
  DeleteVendorResponse,
  ListVendorRatesParams,
  ListVendorRatesResponse,
  UpsertVendorRateParams,
  UpsertVendorRateBody,
  UpsertVendorRateResponse,
  DeleteVendorRateParams,
  DeleteVendorRateResponse,
  ListPurchaseOrdersResponse,
  ListPurchaseOrdersQueryParams,
  CreatePurchaseOrderBody,
  CreatePurchaseOrderResponse,
  ReceivePurchaseOrderParams,
  ReceivePurchaseOrderResponse,
} from "@workspace/api-zod";
import { localToday } from "../lib/localDate";
import { ser } from "../lib/serialize";
import { computeVendorMetrics, NO_VENDOR_METRICS } from "../lib/vendorMetrics";

const router: IRouter = Router();

function decorateItem(item: typeof inventoryItemsTable.$inferSelect) {
  return { ...ser(item), low: item.qty <= item.reorderAt };
}

router.get("/inventory", async (_req, res): Promise<void> => {
  const rows = await db.select().from(inventoryItemsTable);
  res.json(ListInventoryResponse.parse(rows.map(decorateItem)));
});

router.post("/inventory", async (req, res): Promise<void> => {
  const body = CreateInventoryItemBody.parse(req.body);
  const [row] = await db.insert(inventoryItemsTable).values(body).returning();
  res.status(201).json(CreateInventoryItemResponse.parse(decorateItem(row)));
});

router.post("/inventory/:id/adjust", async (req, res): Promise<void> => {
  const { id } = AdjustInventoryParams.parse(req.params);
  const body = AdjustInventoryBody.parse(req.body);
  const [item] = await db
    .select()
    .from(inventoryItemsTable)
    .where(eq(inventoryItemsTable.id, id));
  if (!item) {
    res.status(404).json({ error: "Item not found" });
    return;
  }
  const [row] = await db
    .update(inventoryItemsTable)
    .set({ qty: item.qty + body.delta })
    .where(eq(inventoryItemsTable.id, id))
    .returning();
  res.json(AdjustInventoryResponse.parse(decorateItem(row)));
});

router.get("/vendors", async (_req, res): Promise<void> => {
  const rows = await db.select().from(vendorsTable);
  const today = localToday();
  const metrics = await computeVendorMetrics(
    rows.filter((v) => v.vendorType === "in_house").map((v) => v.id),
  );
  res.json(
    ListVendorsResponse.parse(
      rows.map((v) => ({
        ...ser(v),
        compliant: v.coiExpiresOn ? v.coiExpiresOn >= today : false,
        ...(metrics.get(v.id) ?? NO_VENDOR_METRICS),
      })),
    ),
  );
});

router.post("/vendors", async (req, res): Promise<void> => {
  const body = CreateVendorBody.parse(req.body);
  const [row] = await db.insert(vendorsTable).values(body).returning();
  res.status(201).json(CreateVendorResponse.parse(ser(row)));
});

router.patch("/vendors/:id", async (req, res): Promise<void> => {
  const { id } = UpdateVendorParams.parse(req.params);
  const body = UpdateVendorBody.parse(req.body);
  const patch = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== undefined),
  );
  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }
  const [current] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const stayingInHouse =
    (patch.vendorType ?? current.vendorType) === "in_house";
  if (stayingInHouse && patch.contractStatus === "inactive") {
    // The in-house row is pinned at the top of the module and holds our own
    // crews' turn time. Hiding it behind the inactive filter would quietly
    // empty the anchor of the whole list.
    res.status(409).json({
      error: "Your own organization is always active and can't be set inactive.",
    });
    return;
  }
  let row;
  try {
    [row] = await db
      .update(vendorsTable)
      .set(patch)
      .where(eq(vendorsTable.id, id))
      .returning();
  } catch (err) {
    // A partial unique index keeps exactly one in-house row. Drizzle wraps pg
    // errors, so the code can sit one level down.
    const code =
      (err as { code?: string }).code ??
      ((err as { cause?: { code?: string } }).cause?.code ?? "");
    if (code === "23505") {
      res.status(409).json({
        error:
          "Another vendor is already marked as your own organization. Change that one first.",
      });
      return;
    }
    throw err;
  }
  if (!row) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const today = localToday();
  res.json(
    UpdateVendorResponse.parse({
      ...ser(row),
      compliant: row.coiExpiresOn ? row.coiExpiresOn >= today : false,
    }),
  );
});

router.delete("/vendors/:id", async (req, res): Promise<void> => {
  const { id } = DeleteVendorParams.parse(req.params);
  const result = await db.transaction(async (tx) => {
    const [vendor] = await tx
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, id));
    if (!vendor) return { status: 404 as const, error: "Vendor not found" };
    if (vendor.vendorType === "in_house") {
      // The in-house organization is the anchor of the vendors module: it is
      // pinned first and carries our own crews' turn time. Deleting it would
      // silently drop that row until the next server boot re-seeded it.
      return {
        status: 409 as const,
        error:
          "This is your own organization. Mark it inactive instead of deleting it.",
      };
    }

    const pos = await tx
      .select()
      .from(purchaseOrdersTable)
      .where(eq(purchaseOrdersTable.vendorId, id));
    const openPos = pos.filter((p) => p.status !== "received");
    if (openPos.length > 0) {
      return {
        status: 409 as const,
        error: `This vendor has ${openPos.length} open purchase order${openPos.length === 1 ? "" : "s"}. Receive or reassign them first.`,
      };
    }
    // Detach historical (received) POs so records keep their history.
    if (pos.length > 0) {
      await tx
        .update(purchaseOrdersTable)
        .set({ vendorId: null })
        .where(eq(purchaseOrdersTable.vendorId, id));
    }
    await tx.delete(vendorsTable).where(eq(vendorsTable.id, id));
    return { status: 200 as const };
  });

  if (result.status !== 200) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(DeleteVendorResponse.parse({ id }));
});

/* ---------------------------------------------------------------- vendor rates */

router.get("/vendors/:id/rates", async (req, res): Promise<void> => {
  const { id } = ListVendorRatesParams.parse(req.params);
  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const rates = await db.select().from(vendorRatesTable).where(eq(vendorRatesTable.vendorId, id));
  const catalogItems = await db.select().from(catalogItemsTable);
  const catalogById = new Map(catalogItems.map((c) => [c.id, c]));
  const result = rates
    .map((r) => {
      const item = catalogById.get(r.catalogItemId);
      if (!item) return null;
      return {
        id: r.id,
        vendorId: r.vendorId,
        catalogItemId: r.catalogItemId,
        service: item.service,
        detail: item.detail ?? null,
        unit: item.unit ?? null,
        category: item.category ?? null,
        rate: r.rate,
        masterRate: item.rate ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  res.json(ListVendorRatesResponse.parse(result));
});

router.put("/vendors/:id/rates/:catalogItemId", async (req, res): Promise<void> => {
  const { id, catalogItemId } = UpsertVendorRateParams.parse(req.params);
  const { rate } = UpsertVendorRateBody.parse(req.body);

  const [vendor] = await db.select().from(vendorsTable).where(eq(vendorsTable.id, id));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const [item] = await db
    .select()
    .from(catalogItemsTable)
    .where(eq(catalogItemsTable.id, catalogItemId));
  if (!item) {
    res.status(404).json({ error: "Catalog item not found" });
    return;
  }

  // Upsert: insert or update the rate for this vendor+catalog pair.
  const [row] = await db
    .insert(vendorRatesTable)
    .values({ vendorId: id, catalogItemId, rate })
    .onConflictDoUpdate({
      target: [vendorRatesTable.vendorId, vendorRatesTable.catalogItemId],
      set: { rate, updatedAt: new Date() },
    })
    .returning();

  res.json(
    UpsertVendorRateResponse.parse({
      id: row!.id,
      vendorId: row!.vendorId,
      catalogItemId: row!.catalogItemId,
      service: item.service,
      detail: item.detail ?? null,
      unit: item.unit ?? null,
      category: item.category ?? null,
      rate: row!.rate,
      masterRate: item.rate ?? null,
    }),
  );
});

router.delete("/vendors/:id/rates/:catalogItemId", async (req, res): Promise<void> => {
  const { id, catalogItemId } = DeleteVendorRateParams.parse(req.params);
  await db
    .delete(vendorRatesTable)
    .where(
      and(
        eq(vendorRatesTable.vendorId, id),
        eq(vendorRatesTable.catalogItemId, catalogItemId),
      ),
    );
  res.json(DeleteVendorRateResponse.parse({ vendorId: id, catalogItemId }));
});

/* --------------------------------------------------------------- purchase orders */

async function nextPoNo(): Promise<string> {
  const rows = await db.select().from(purchaseOrdersTable);
  return `PO-${String(700 + rows.length + 1)}`;
}

router.get("/purchase-orders", async (req, res): Promise<void> => {
  const { status } = ListPurchaseOrdersQueryParams.parse(req.query);
  let rows = await db
    .select()
    .from(purchaseOrdersTable)
    .orderBy(desc(purchaseOrdersTable.createdAt));
  if (status) rows = rows.filter((r) => r.status === status);
  const vendors = await db.select().from(vendorsTable);
  const jobs = await db.select().from(jobsTable);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const jobNo = new Map(jobs.map((j) => [j.id, j.jobNo]));
  const today = localToday();
  res.json(
    ListPurchaseOrdersResponse.parse(
      rows.map((po) => ({
        ...ser(po),
        vendorName: po.vendorId ? (vendorName.get(po.vendorId) ?? null) : null,
        jobNo: po.jobId ? (jobNo.get(po.jobId) ?? null) : null,
        late:
          !po.receivedAt && po.expectedOn ? po.expectedOn < today : false,
      })),
    ),
  );
});

router.post("/purchase-orders", async (req, res): Promise<void> => {
  const body = CreatePurchaseOrderBody.parse(req.body);
  const [row] = await db
    .insert(purchaseOrdersTable)
    .values({ ...body, poNo: await nextPoNo() })
    .returning();
  res.status(201).json(CreatePurchaseOrderResponse.parse(ser(row)));
});

router.post("/purchase-orders/:id/receive", async (req, res): Promise<void> => {
  const { id } = ReceivePurchaseOrderParams.parse(req.params);
  const [row] = await db
    .update(purchaseOrdersTable)
    .set({ status: "received", receivedAt: new Date() })
    .where(eq(purchaseOrdersTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Purchase order not found" });
    return;
  }
  const vendors = await db.select().from(vendorsTable);
  const jobs = await db.select().from(jobsTable);
  const vendorName = new Map(vendors.map((v) => [v.id, v.name]));
  const jobNo = new Map(jobs.map((j) => [j.id, j.jobNo]));
  res.json(
    ReceivePurchaseOrderResponse.parse({
      ...ser(row),
      vendorName: row.vendorId ? (vendorName.get(row.vendorId) ?? null) : null,
      jobNo: row.jobId ? (jobNo.get(row.jobId) ?? null) : null,
      late: false,
    }),
  );
});

export default router;
