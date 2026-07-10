import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const inventoryItemsTable = pgTable("inventory_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  qty: doublePrecision("qty").notNull().default(0),
  reorderAt: doublePrecision("reorder_at").notNull().default(0),
  unitCost: doublePrecision("unit_cost"),
  preferredVendor: text("preferred_vendor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const vendorsTable = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  trade: text("trade"),
  email: text("email"),
  phone: text("phone"),
  coiExpiresOn: date("coi_expires_on", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const purchaseOrdersTable = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  poNo: text("po_no").notNull(),
  vendorId: uuid("vendor_id"),
  jobId: uuid("job_id"),
  expectedOn: date("expected_on", { mode: "string" }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type Vendor = typeof vendorsTable.$inferSelect;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
