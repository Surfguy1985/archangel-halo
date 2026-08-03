import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// An urgent "need you at X ASAP" broadcast for one job: bonus on top of the
// job's crew pay, sent to hand-picked closest crews. First commit wins.
export const emergencyPingsTable = pgTable(
  "emergency_pings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id").notNull(),
    bonusAmount: doublePrecision("bonus_amount").notNull().default(0),
    payAmount: doublePrecision("pay_amount").notNull().default(0),
    neededBy: text("needed_by"),
    note: text("note"),
    status: text("status").notNull().default("open"), // open | filled | cancelled
    filledByCrewId: uuid("filled_by_crew_id"),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Optional deadline: an open ping past this instant can no longer be
    // committed — the sweep flips it to cancelled and stamps expiredAt.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    // Set only when the ping was closed BY expiry (vs a manual cancel), so
    // Today can surface "no one committed" without a new status enum value.
    expiredAt: timestamp("expired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // At most one live (open or filled-awaiting-completion) ping per job.
    uniqueIndex("emergency_pings_open_job_uq")
      .on(t.jobId)
      .where(sql`${t.status} = 'open'`),
  ],
);

// One row per pinged crew — mirrors the job-board one-row-per-(job,crew) rule.
export const emergencyPingTargetsTable = pgTable("emergency_ping_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  pingId: uuid("ping_id").notNull(),
  jobId: uuid("job_id").notNull(),
  crewId: uuid("crew_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | committed | declined | missed | cancelled
  distanceMeters: doublePrecision("distance_meters"),
  checkinAt: timestamp("checkin_at", { withTimezone: true }),
  smsSent: text("sms_sent"), // null | "sent" | error summary
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Committed emergency pay (job pay + bonus) held in the crew's visual bank.
// Guarded HELD-claim state machine (Founding Wings reserve pattern): every
// transition out of HELD is a guarded UPDATE + row-count check so a hold can
// never double-release or release after cancel.
export const crewPayHoldsTable = pgTable(
  "crew_pay_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    jobId: uuid("job_id").notNull(),
    pingId: uuid("ping_id"),
    amount: doublePrecision("amount").notNull(), // pay + bonus, total held
    bonusAmount: doublePrecision("bonus_amount").notNull().default(0),
    status: text("status").notNull().default("HELD"), // HELD | RELEASED | CANCELLED
    note: text("note"),
    heldAt: timestamp("held_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // At most one live hold per crew+job.
    uniqueIndex("crew_pay_holds_held_crew_job_uq")
      .on(t.crewId, t.jobId)
      .where(sql`${t.status} = 'HELD'`),
  ],
);

export type EmergencyPing = typeof emergencyPingsTable.$inferSelect;
export type EmergencyPingTarget = typeof emergencyPingTargetsTable.$inferSelect;
export type CrewPayHold = typeof crewPayHoldsTable.$inferSelect;
