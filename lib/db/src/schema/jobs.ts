import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
  date,
  jsonb,
} from "drizzle-orm/pg-core";

export const crewsTable = pgTable("crews", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  trade: text("trade"),
  phone: text("phone"),
  email: text("email"),
  isLeader: boolean("is_leader").default(false),
  active: boolean("active").default(true),
  portalToken: text("portal_token"),
  preferredPaymentMethod: text("preferred_payment_method"),
  paymentDetails: text("payment_details"),
  paymentTerms: text("payment_terms"),
  services: jsonb("services"),
  w9: jsonb("w9"),
  w9SubmittedAt: timestamp("w9_submitted_at", { withTimezone: true }),
  portalSeen: jsonb("portal_seen"),
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
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  recapSentAt: timestamp("recap_sent_at", { withTimezone: true }),
  warrantyUntil: date("warranty_until", { mode: "string" }),
  scheduledOn: date("scheduled_on", { mode: "string" }),
  grossProfit: doublePrecision("gross_profit"),
  marginPct: doublePrecision("margin_pct"),
  boardStatus: text("board_status").notNull().default("active"),
  isRecurring: boolean("is_recurring").default(false),
  recurrence: text("recurrence"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobBroadcastsTable = pgTable("job_broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  crewId: uuid("crew_id").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const jobLineItemsTable = pgTable("job_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  priceItemId: uuid("price_item_id"),
  service: text("service").notNull(),
  unit: text("unit"),
  rate: doublePrecision("rate").notNull(),
  qty: doublePrecision("qty").notNull().default(1),
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
export type JobLineItem = typeof jobLineItemsTable.$inferSelect;
export type JobBroadcast = typeof jobBroadcastsTable.$inferSelect;
