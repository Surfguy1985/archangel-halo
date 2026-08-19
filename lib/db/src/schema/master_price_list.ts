import { pgTable, uuid, text, integer, date, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
export const masterPriceListTable = pgTable("master_price_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceCode: text("service_code").notNull(), name: text("name").notNull(), category: text("category").notNull(),
  unitType: text("unit_type").notNull(), rateCents: integer("rate_cents"), notes: text("notes"),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull().default("2026-08-01"),
  effectiveTo: date("effective_to", { mode: "string" }), isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("master_price_list_code_unit_eff_uq").on(t.serviceCode, t.unitType, t.effectiveFrom)]);
