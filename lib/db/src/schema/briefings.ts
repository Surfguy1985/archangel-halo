import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * HALO-owned end-of-day snapshot. Not Base44 SoR.
 * One row per Eastern calendar date; regenerated in place.
 */
export const haloEodBriefingsTable = pgTable(
  "halo_eod_briefings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    localDate: date("local_date", { mode: "string" }).notNull(),
    summary: text("summary").notNull(),
    fallbackUsed: boolean("fallback_used").notNull().default(true),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("halo_eod_briefings_date_uq").on(t.localDate)],
);

export type HaloEodBriefing = typeof haloEodBriefingsTable.$inferSelect;
