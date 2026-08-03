import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  integer,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
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
  agreementAcceptedAt: timestamp("agreement_accepted_at", {
    withTimezone: true,
  }),
  preferredPaymentMethod: text("preferred_payment_method"),
  paymentDetails: text("payment_details"),
  paymentTerms: text("payment_terms"),
  services: jsonb("services"),
  w9: jsonb("w9"),
  w9SubmittedAt: timestamp("w9_submitted_at", { withTimezone: true }),
  portalSeen: jsonb("portal_seen"),
  selfiePath: text("selfie_path"),
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
  scheduledTime: text("scheduled_time"),
  grossProfit: doublePrecision("gross_profit"),
  marginPct: doublePrecision("margin_pct"),
  crewRate: doublePrecision("crew_rate"),
  boardStatus: text("board_status").notNull().default("active"),
  scheduleType: text("schedule_type").notNull().default("scheduled"),
  flexDueBy: date("flex_due_by", { mode: "string" }),
  crewsNeeded: integer("crews_needed").notNull().default(1),
  crewsFilled: integer("crews_filled").notNull().default(0),
  trackerToken: text("tracker_token"),
  isRecurring: boolean("is_recurring").default(false),
  recurrence: text("recurrence"),
  // Set when a crew is pulled off this job onto another one; cleared the
  // moment any crew is (re)assigned. Drives the "lost its crew" Today flag.
  crewVacatedAt: timestamp("crew_vacated_at", { withTimezone: true }),
  // Emergency jobs: crew pay bypasses net-30 everywhere — pay the day the
  // job is approved. Set by the emergency ping flow.
  sameDayPay: boolean("same_day_pay").notNull().default(false),
  // Bonus offered on top of crewRate via an emergency ping; flows through
  // job financials and the labor ledger like any other crew cost.
  emergencyBonus: doublePrecision("emergency_bonus"),
  // Client's stated budget carried over from the accepted work request; the
  // invoice editors warn when an invoice total exceeds it.
  clientBudget: doublePrecision("client_budget"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const recapSharesTable = pgTable("recap_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  token: text("token").notNull().unique(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
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

// Per-crew, per-day route plan: an ordered list of stop keys. A stop key is
// either a schedules-row id (job stop) or "event-<calendarEventId>" — the same
// keys the crew portal schedule feed uses for its items.
export const crewRoutePlansTable = pgTable(
  "crew_route_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    stopKeys: jsonb("stop_keys").notNull().default([]),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("crew_route_plans_crew_day_uq").on(t.crewId, t.day)],
);

export type CrewRoutePlan = typeof crewRoutePlansTable.$inferSelect;

export type Crew = typeof crewsTable.$inferSelect;
export type Job = typeof jobsTable.$inferSelect;
export type Schedule = typeof schedulesTable.$inferSelect;
export type JobLineItem = typeof jobLineItemsTable.$inferSelect;
export type JobBroadcast = typeof jobBroadcastsTable.$inferSelect;
