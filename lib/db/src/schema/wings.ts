import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const wingMembersTable = pgTable(
  "wing_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    sponsorCrewId: uuid("sponsor_crew_id"),
    sponsorSince: timestamp("sponsor_since", { withTimezone: true }),
    founderStatus: text("founder_status").notNull().default("NONE"),
    founderNumber: integer("founder_number"),
    tradeSkills: jsonb("trade_skills"),
    certifications: jsonb("certifications"),
    draftTokens: integer("draft_tokens").notNull().default(0),
    maxConcurrentJobs: integer("max_concurrent_jobs").notNull().default(3),
    isAvailable: boolean("is_available").notNull().default(true),
    haloScore: doublePrecision("halo_score").notNull().default(85),
    tier: text("tier").notNull().default("TRAINING"),
    scoreConfidence: doublePrecision("score_confidence").notNull().default(0),
    scoreUpdatedAt: timestamp("score_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("wing_members_crew_uq").on(t.crewId)],
);

export const wingScoreSnapshotsTable = pgTable("wing_score_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  totalScore: doublePrecision("total_score").notNull(),
  tier: text("tier").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  points: jsonb("points"),
  sampleSize: integer("sample_size").notNull().default(0),
  reasons: jsonb("reasons"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wingAssignmentsTable = pgTable(
  "wing_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    crewId: uuid("crew_id").notNull(),
    onTime: boolean("on_time"),
    attended: boolean("attended"),
    communicationRating: doublePrecision("communication_rating"),
    professionalismRating: doublePrecision("professionalism_rating"),
    profitShareWeight: doublePrecision("profit_share_weight")
      .notNull()
      .default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("wing_assignments_job_crew_uq").on(t.jobId, t.crewId)],
);

export const wingIncidentsTable = pgTable("wing_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id"),
  crewId: uuid("crew_id"),
  type: text("type").notNull(),
  severity: integer("severity").notNull().default(1),
  description: text("description").notNull(),
  cost: doublePrecision("cost"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wingQualitySubmissionsTable = pgTable(
  "wing_quality_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    crewId: uuid("crew_id"),
    checklist: jsonb("checklist"),
    notes: text("notes"),
    beforePaths: jsonb("before_paths"),
    afterPaths: jsonb("after_paths"),
    reviewStatus: text("review_status").notNull().default("PENDING"),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("wing_quality_submissions_job_uq").on(t.jobId)],
);

export const wingQualityReviewsTable = pgTable(
  "wing_quality_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id").notNull(),
    status: text("status").notNull(),
    finalScore: doublePrecision("final_score").notNull().default(0),
    completenessScore: doublePrecision("completeness_score")
      .notNull()
      .default(0),
    craftsmanshipScore: doublePrecision("craftsmanship_score")
      .notNull()
      .default(0),
    propertyProtectionScore: doublePrecision("property_protection_score")
      .notNull()
      .default(0),
    safetyScore: doublePrecision("safety_score").notNull().default(0),
    anomalyRisk: doublePrecision("anomaly_risk").notNull().default(0),
    confidence: doublePrecision("confidence").notNull().default(0),
    criticalConcern: boolean("critical_concern").notNull().default(false),
    summary: text("summary").notNull().default(""),
    concerns: jsonb("concerns"),
    evidence: jsonb("evidence"),
    aiModel: text("ai_model"),
    decidedBy: text("decided_by").notNull().default("SYSTEM"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("wing_quality_reviews_submission_uq").on(t.submissionId)],
);

export const wingOverridesTable = pgTable(
  "wing_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    sponsorCrewId: uuid("sponsor_crew_id").notNull(),
    recruitCrewId: uuid("recruit_crew_id").notNull(),
    allocatedGrossProfit: doublePrecision("allocated_gross_profit")
      .notNull()
      .default(0),
    baseRate: doublePrecision("base_rate").notNull().default(0),
    qualityMultiplier: doublePrecision("quality_multiplier")
      .notNull()
      .default(0),
    grossOverride: doublePrecision("gross_override").notNull().default(0),
    immediateAmount: doublePrecision("immediate_amount").notNull().default(0),
    reserveAmount: doublePrecision("reserve_amount").notNull().default(0),
    reserveBonus: doublePrecision("reserve_bonus"),
    reserveDebit: doublePrecision("reserve_debit"),
    status: text("status").notNull().default("HELD"),
    immediateStatus: text("immediate_status").notNull().default("READY"),
    qualityWindowEndsAt: timestamp("quality_window_ends_at", {
      withTimezone: true,
    }),
    reserveReleasedAt: timestamp("reserve_released_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("wing_overrides_job_sponsor_recruit_uq").on(
      t.jobId,
      t.sponsorCrewId,
      t.recruitCrewId,
    ),
  ],
);

export const wingReserveAccountsTable = pgTable(
  "wing_reserve_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    heldBalance: doublePrecision("held_balance").notNull().default(0),
    releasedBalance: doublePrecision("released_balance").notNull().default(0),
    debitedBalance: doublePrecision("debited_balance").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("wing_reserve_accounts_crew_uq").on(t.crewId)],
);

export const wingReserveTxnsTable = pgTable("wing_reserve_txns", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull(),
  crewId: uuid("crew_id").notNull(),
  overrideId: uuid("override_id"),
  type: text("type").notNull(),
  amount: doublePrecision("amount").notNull(),
  balanceAfter: doublePrecision("balance_after").notNull().default(0),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wingEventsTable = pgTable(
  "wing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("wing_events_event_uq").on(t.eventId)],
);

export const wingConfigTable = pgTable("wing_config", {
  id: uuid("id").primaryKey().defaultRandom(),
  config: jsonb("config"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const wingAutomationRunsTable = pgTable("wing_automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull().default("DAILY_FOUNDING_WINGS"),
  status: text("status").notNull().default("RUNNING"),
  actionsRun: integer("actions_run").notNull().default(0),
  result: jsonb("result"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const wingAuditTable = pgTable("wing_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorType: text("actor_type").notNull().default("SYSTEM"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
