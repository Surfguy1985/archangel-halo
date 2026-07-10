import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  db,
  inventoryItemsTable,
  vendorsTable,
  purchaseOrdersTable,
  jobsTable,
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
  ListPurchaseOrdersResponse,
  ListPurchaseOrdersQueryParams,
  CreatePurchaseOrderBody,
  CreatePurchaseOrderResponse,
  ReceivePurchaseOrderParams,
  ReceivePurchaseOrderResponse,
} from "@workspace/api-zod";
import { ser } from "../lib/serialize";

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
  const today = new Date().toISOString().slice(0, 10);
  res.json(
    ListVendorsResponse.parse(
      rows.map((v) => ({
        ...ser(v),
        compliant: v.coiExpiresOn ? v.coiExpiresOn >= today : false,
      })),
    ),
  );
});

router.post("/vendors", async (req, res): Promise<void> => {
  const body = CreateVendorBody.parse(req.body);
  const [row] = await db.insert(vendorsTable).values(body).returning();
  res.status(201).json(CreateVendorResponse.parse(ser(row)));
});

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
  const today = new Date().toISOString().slice(0, 10);
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
