import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  date,
  unique,
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
  // "in_house" is the company's own crew organization (Archangel Contractors)
  // — it is pinned to the top of the vendors module and never sorted in among
  // the subs. Everything else is an outside vendor.
  vendorType: text("vendor_type").notNull().default("subcontractor"),
  // "contracted" vendors are the ones we currently use; "inactive" ones stay
  // on file (history, old POs) but drop out of the default list.
  contractStatus: text("contract_status").notNull().default("contracted"),
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

export const vendorRatesTable = pgTable(
  "vendor_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id").notNull(),
    catalogItemId: uuid("catalog_item_id").notNull(),
    rate: doublePrecision("rate").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.vendorId, t.catalogItemId)],
);

export type InventoryItem = typeof inventoryItemsTable.$inferSelect;
export type Vendor = typeof vendorsTable.$inferSelect;
export type PurchaseOrder = typeof purchaseOrdersTable.$inferSelect;
export type VendorRate = typeof vendorRatesTable.$inferSelect;
