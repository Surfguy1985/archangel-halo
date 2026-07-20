import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const propertiesTable = pgTable("properties", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  pmcName: text("pmc_name"),
  address: text("address"),
  city: text("city"),
  units: integer("units"),
  accessNotes: text("access_notes"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  geocodedAt: timestamp("geocoded_at", { withTimezone: true }),
  imagePath: text("image_path"),
  imageGeneratedAt: timestamp("image_generated_at", { withTimezone: true }),
  brief: text("brief"),
  briefUpdatedAt: timestamp("brief_updated_at", { withTimezone: true }),
  avgDaysToPay: doublePrecision("avg_days_to_pay"),
  marginMin: doublePrecision("margin_min"),
  marginTarget: doublePrecision("margin_target"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const catalogItemsTable = pgTable("catalog_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  service: text("service").notNull(),
  detail: text("detail"),
  unit: text("unit"),
  rate: doublePrecision("rate").notNull(),
  category: text("category"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contactsTable = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id"),
  name: text("name").notNull(),
  role: text("role"),
  phone: text("phone"),
  email: text("email"),
  prefers: text("prefers"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const priceItemsTable = pgTable("price_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  service: text("service").notNull(),
  detail: text("detail"),
  unit: text("unit"),
  rate: doublePrecision("rate").notNull(),
  marginFloor: doublePrecision("margin_floor"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const agreementsTable = pgTable("agreements", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id"),
  title: text("title").notNull(),
  storagePath: text("storage_path"),
  effectiveFrom: date("effective_from", { mode: "string" }),
  renewsOn: date("renews_on", { mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Property = typeof propertiesTable.$inferSelect;
export type Contact = typeof contactsTable.$inferSelect;
export type PriceItem = typeof priceItemsTable.$inferSelect;
export type Agreement = typeof agreementsTable.$inferSelect;
