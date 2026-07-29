import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Unit status map: an uploaded property map/site plan plus a persisted box
// layout of units. Coordinates are FRACTIONS of the canvas (0..1) so the
// layout renders at any size, over the image or on a plain grid.
export const propertyMapsTable = pgTable("property_maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull().unique(),
  imagePath: text("image_path"), // object storage path (/objects/...), null = plain grid
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const propertyUnitsTable = pgTable(
  "property_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull(),
    label: text("label").notNull(),
    x: doublePrecision("x").notNull().default(0), // 0..1 fraction of canvas
    y: doublePrecision("y").notNull().default(0),
    w: doublePrecision("w").notNull().default(0.1),
    h: doublePrecision("h").notNull().default(0.08),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("property_units_property_label_uq").on(t.propertyId, t.label)],
);

// Client CMS ("Property Hub"): links, docs, custom info cards, the client's
// own employees, and maintenance contacts — managed by the client from their
// dashboard and by our staff from the Admin tab.
export const clientHubItemsTable = pgTable("client_hub_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  section: text("section").notNull(), // link | doc | card | employee | maintenance
  title: text("title").notNull(),
  subtitle: text("subtitle"), // role for employees, category for docs/links
  url: text("url"), // external link
  storagePath: text("storage_path"), // uploaded doc (/objects/...)
  body: text("body"), // free text for info cards
  phone: text("phone"),
  email: text("email"),
  position: doublePrecision("position").notNull().default(0),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PropertyMap = typeof propertyMapsTable.$inferSelect;
export type PropertyUnit = typeof propertyUnitsTable.$inferSelect;
export type ClientHubItem = typeof clientHubItemsTable.$inferSelect;
