import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

export const leadsTable = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id"),
  source: text("source"),
  summary: text("summary"),
  status: text("status").notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bidsTable = pgTable("bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  bidNo: text("bid_no").notNull(),
  propertyId: uuid("property_id"),
  unitNo: text("unit_no"),
  scope: text("scope"),
  amount: doublePrecision("amount").notNull(),
  estCost: doublePrecision("est_cost"),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  lastNudgeAt: timestamp("last_nudge_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Lead = typeof leadsTable.$inferSelect;
export type Bid = typeof bidsTable.$inferSelect;
