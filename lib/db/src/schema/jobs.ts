import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const crewsTable = pgTable("crews", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  trade: text("trade"),
  phone: text("phone"),
  isLeader: boolean("is_leader").default(false),
  active: boolean("active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobsTable = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobNo: text("job_no").notNull(),
  woNo: text("wo_no"),
  propertyId: uuid("property_id").notNull(),
  unitNo: text("unit_no"),
  category: text("category"),
  description: text("description"),
  status: text("status").notNull().default("open"),
  crewLeaderId: uuid("crew_leader_id"),
  bidId: uuid("bid_id"),
  contactId: uuid("contact_id"),
  inspectionRequired: boolean("inspection_required").default(false),
  inspectionPassedAt: timestamp("inspection_passed_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  recapSentAt: timestamp("recap_sent_at", { withTimezone: true }),
  warrantyUntil: date("warranty_until", { mode: "string" }),
  scheduledOn: date("scheduled_on", { mode: "string" }),
  grossProfit: doublePrecision("gross_profit"),
  marginPct: doublePrecision("margin_pct"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const schedulesTable = pgTable("schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  scheduledOn: date("scheduled_on", { mode: "string" }).notNull(),
  windowStart: text("window_start"),
  crewLeaderId: uuid("crew_leader_id"),
  status: text("status").notNull().default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Crew = typeof crewsTable.$inferSelect;
export type Job = typeof jobsTable.$inferSelect;
export type Schedule = typeof schedulesTable.$inferSelect;
