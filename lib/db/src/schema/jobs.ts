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
  // Wings Program: role tier (crew|lead|foreman|superintendent) + start date
  // drive base Wings and the tenure multiplier. Null role = "crew".
  role: text("role"),
  hireDate: date("hire_date"),
  // Excluded crews are never auto-imported into the Wings Program and their
  // portal hides the Wings tab content.
  wingsExcluded: boolean("wings_excluded").default(false),
  // Team structure: members report to a foreman (a crew with isLeader=true).
  // Null = independent (or is themselves a leader). No DB FK — guarded in code.
  leaderId: uuid("leader_id"),
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
  // Office-view access grant for the crew's portal link:
  // { features: string[], propertyScope: "all"|"selected", propertyIds: string[],
  //   jobScope: "all"|"selected", jobIds: string[] }. Null = no office access.
  accessGrants: jsonb("access_grants"),
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
  // Client-initiated change order: while status is "requested" the card sits
  // in the Requested rail on BOTH boards with a "Change order" banner until
  // the office reviews upcharges and reopens it back into the flow.
  changeOrderStatus: text("change_order_status"), // "requested" | null
  changeOrderReason: text("change_order_reason"),
  changeOrderNote: text("change_order_note"),
  changeOrderAt: timestamp("change_order_at", { withTimezone: true }),
  // Board status to restore when the office reopens the card.
  changeOrderPrevBoardStatus: text("change_order_prev_board_status"),
  // Crew payout tracker for the board pay flow: array of
  // { crewId, name, amount, paidAt, clearedAt } — office pays each member,
  // then manually clears each row; all cleared → card leaves the board.
  crewPay: jsonb("crew_pay"),
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

export const jobBroadcastsTable = pgTable(
  "job_broadcasts",
  {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  crewId: uuid("crew_id").notNull(),
  status: text("status").notNull().default("pending"),
  // Specialty broadcast: which of the job's services this offer covers, and
  // when that crew should start (staggered arrivals). Null = whole job.
  forServices: jsonb("for_services"),
  startTime: text("start_time"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  },
  // One offer row per (job, crew) — concurrent broadcasts must not create
  // duplicate offers; writes upsert against this.
  (t) => [uniqueIndex("job_broadcasts_job_crew_uq").on(t.jobId, t.crewId)],
);

export const jobLineItemsTable = pgTable("job_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull(),
  priceItemId: uuid("price_item_id"),
  service: text("service").notNull(),
  unit: text("unit"),
  rate: doublePrecision("rate").notNull(),
  qty: doublePrecision("qty").notNull().default(1),
  // Per-item completion tracked by crew: the office assigns each line item to
  // a crew; only that crew can mark it done from their live link.
  assignedCrewId: uuid("assigned_crew_id"),
  // Staggered starts: when this service's crew should arrive (HH:MM local).
  startTime: text("start_time"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  completedByCrewId: uuid("completed_by_crew_id"),
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

// Member-level daily dispatch: one row assigns a crew member to a job for a
// day, carrying a scope-of-work checklist ({id,text,done} objects). Moves to
// another job go through the member's foreman: status becomes "pending_move"
// with pendingJobId set until the foreman approves (jobId flips) or declines.
export const crewDispatchAssignmentsTable = pgTable(
  "crew_dispatch_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day", { mode: "string" }).notNull(),
    jobId: uuid("job_id").notNull(),
    memberId: uuid("member_id").notNull(),
    status: text("status").notNull().default("assigned"),
    checklist: jsonb("checklist").notNull().default([]),
    pendingJobId: uuid("pending_job_id"),
    moveRequestedAt: timestamp("move_requested_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("crew_dispatch_member_day_job_uq").on(t.memberId, t.day, t.jobId),
  ],
);

export type CrewDispatchAssignment =
  typeof crewDispatchAssignmentsTable.$inferSelect;

export type Crew = typeof crewsTable.$inferSelect;
export type Job = typeof jobsTable.$inferSelect;
export type Schedule = typeof schedulesTable.$inferSelect;
export type JobLineItem = typeof jobLineItemsTable.$inferSelect;
export type JobBroadcast = typeof jobBroadcastsTable.$inferSelect;
