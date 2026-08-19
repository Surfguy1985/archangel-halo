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
  // Who the crew actually works for, shown on every map pin. Null = in-house,
  // which renders the business's own company name; a sub carries its own so a
  // pin never puts our badge on somebody else's people.
  company: text("company"),
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
  // Map pin colour for this crew's team, saved so a foreman keeps the same
  // colour. Null = derive it (Archangel staff gold, members inherit their
  // foreman's, foremen get a stable palette slot). See lib/crewPinColor.ts.
  pinColor: text("pin_color"),
  active: boolean("active").default(true),
  portalToken: text("portal_token"),
  // sha256 of the URL bearer. portal_token holds either legacy plaintext or `h:<hash>`.
  portalTokenHash: text("portal_token_hash"),
  agreementAcceptedAt: timestamp("agreement_accepted_at", {
    withTimezone: true,
  }),
  preferredPaymentMethod: text("preferred_payment_method"),
  paymentDetails: text("payment_details"),
  paymentTerms: text("payment_terms"),
  // Weekly availability the office keeps current so dispatch can plan ahead:
  // { mon: { on: true, from: "8:00 AM", to: "5:00 PM" }, ... } — free text times.
  availability: jsonb("availability"),
  services: jsonb("services"),
  w9: jsonb("w9"),
  w9SubmittedAt: timestamp("w9_submitted_at", { withTimezone: true }),
  portalSeen: jsonb("portal_seen"),
  // Office-view access grant for the crew's portal link:
  // { features: string[], propertyScope: "all"|"selected", propertyIds: string[],
  //   jobScope: "all"|"selected", jobIds: string[] }. Null = no office access.
  accessGrants: jsonb("access_grants"),
  selfiePath: text("selfie_path"),
  // Expo push token saved by the crew's mobile app for native push delivery.
  pushToken: text("push_token"),
  // Falkon Ops vendor registry — external ID assigned by Falkon on sync.
  falkonVendorId: text("falkon_vendor_id").unique(),
  // Contractor compliance fields surfaced to Falkon's vendor twin.
  vendorLicense: text("vendor_license"),
  insuranceCert: text("insurance_cert"),
  insuranceExpiry: date("insurance_expiry", { mode: "string" }),
  // Falkon vendor tier: preferred | standard | on-demand | emergency
  falkonTier: text("falkon_tier"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Known name variants for a crew (e.g. "Bryce Beck" → the "Bryce Back" row).
// Written when duplicate crew rows are merged so the Base44 sync stops
// re-creating a fresh row for a spelling variant. alias is stored normalized
// (lowercased, whitespace collapsed) and is unique.
export const crewAliasesTable = pgTable(
  "crew_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("crew_aliases_alias_uq").on(t.alias)],
);

export const jobsTable = pgTable("jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobNo: text("job_no").notNull(),
  woNo: text("wo_no"),
  // Client purchase order — the Done→Billing gate: no PO, no billing.
  poNumber: text("po_number"),
  // Client PO intake (office chat "here's the PO for unit X, send to vendor"):
  // when the property sends over the PO, poReceivedAt stamps arrival and drives
  // the flashing purple "PO RECEIVED" banner until the office acknowledges it.
  poReceivedAt: timestamp("po_received_at", { withTimezone: true }),
  poReceivedSource: text("po_received_source"),
  poAcknowledgedAt: timestamp("po_acknowledged_at", { withTimezone: true }),
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
  // Operator-set ordering for the job board and today's feed. Follows the
  // client-board card precedent exactly (client_dashboard_cards.position):
  // a double so a card can always be slotted between two others, ASCENDING
  // sort, and LOWER sorts FIRST — "move to the top" writes min(priority) - 1.
  // Default 0 = untouched, so the board's createdAt ordering is unchanged
  // until somebody actually prioritises something.
  priority: doublePrecision("priority").notNull().default(0),
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
  // Office-defined extra columns, keyed by board_field_defs.key. Values are
  // whatever the field's type implies (string | number | boolean | ISO date).
  // A bag rather than real columns: the office adds and drops these at will,
  // and drizzle-kit push is unusable in this repo.
  customFields: jsonb("custom_fields"),
  // Falkon Ops job twin — external job reference assigned by Falkon on sync.
  // NULL until the job is registered in the Falkon twin model.
  falkonJobId: text("falkon_job_id"),
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
    // Set (atomically, claim-before-send) once the scheduler sends a reminder
    // ping to the foreman. Clears to null when the move resolves (approve/decline).
    moveReminderSentAt: timestamp("move_reminder_sent_at", {
      withTimezone: true,
    }),
    // PM approval of HALO Walk findings — set when the property manager approves
  // walk-captured work from the client board. Drives the gold flash on the
  // office job board so crews know this job has been greenlit by the client.
  walkApprovedAt: timestamp("walk_approved_at", { withTimezone: true }),
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

/**
 * Per-job, per-crew completion state for the Archangel Turn Cleaning checklist.
 * The template (sections + items) lives in lib/cleaningChecklist.ts; this table
 * only stores which item IDs have been checked and the sign-off timestamp.
 * Unique on (job_id, crew_id) — one record per cleaning crew per job.
 */
export const cleaningChecklistsTable = pgTable(
  "cleaning_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    crewId: uuid("crew_id").notNull(),
    unitNo: text("unit_no"),
    // [{id, checkedAt, checkedBy}] — only checked items are stored.
    checkedItems: jsonb("checked_items").notNull().default([]),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    signedOffBy: text("signed_off_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("cleaning_checklists_job_crew_uq").on(t.jobId, t.crewId)],
);

export type CleaningChecklist = typeof cleaningChecklistsTable.$inferSelect;

/**
 * Per-job, per-crew, per-type completion state for trade-specific checklists:
 * carpet, make_ready, painting. Uses the same shape as cleaning_checklists but
 * adds checklist_type (the discriminator) and agreed_at/agreed_by (the crew's
 * explicit acknowledgement that incomplete work may affect their pay).
 * Unique on (job_id, crew_id, checklist_type).
 */
export const jobChecklistsTable = pgTable(
  "job_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    crewId: uuid("crew_id").notNull(),
    // 'carpet' | 'make_ready' | 'painting'
    checklistType: text("checklist_type").notNull(),
    // [{id, checkedAt, checkedBy}] — only checked items stored.
    checkedItems: jsonb("checked_items").notNull().default([]),
    // Crew tapped "I Agree" to the consequence acknowledgement.
    agreedAt: timestamp("agreed_at", { withTimezone: true }),
    agreedBy: text("agreed_by"),
    signedOffAt: timestamp("signed_off_at", { withTimezone: true }),
    signedOffBy: text("signed_off_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("job_checklists_job_crew_type_uq").on(t.jobId, t.crewId, t.checklistType),
  ],
);

export type JobChecklist = typeof jobChecklistsTable.$inferSelect;

/**
 * Per-job, per-crew agreement record. Every contractor must explicitly
 * acknowledge their payout schedule and the two release conditions
 * (property verification + Archangel receipt of payment) before starting
 * work on any job. Unique on (job_id, crew_id) — idempotent on repeat calls.
 *
 * paymentTerms / termsText are snapshots of what the crew agreed to at the
 * time so we have an audit trail even if the crew's profile terms change later.
 */
export const jobAgreementsTable = pgTable(
  "job_agreements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    crewId: uuid("crew_id").notNull(),
    // Snapshot of crew.payment_terms at time of agreement
    paymentTerms: text("payment_terms").notNull(),
    // Full agreement text snapshot
    termsText: text("terms_text").notNull(),
    agreedAt: timestamp("agreed_at", { withTimezone: true }).notNull().defaultNow(),
    agreedBy: text("agreed_by").notNull(),
  },
  (t) => [uniqueIndex("job_agreements_job_crew_uq").on(t.jobId, t.crewId)],
);

export type JobAgreement = typeof jobAgreementsTable.$inferSelect;

export type Crew = typeof crewsTable.$inferSelect;
export type Job = typeof jobsTable.$inferSelect;
export type Schedule = typeof schedulesTable.$inferSelect;
export type JobLineItem = typeof jobLineItemsTable.$inferSelect;
export type JobBroadcast = typeof jobBroadcastsTable.$inferSelect;
