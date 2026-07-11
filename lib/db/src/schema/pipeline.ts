import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const leadsTable = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id"),
  source: text("source"),
  summary: text("summary"),
  status: text("status").notNull().default("new"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
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
  welcomeMessage: text("welcome_message"),
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

export const bidLineItemsTable = pgTable("bid_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  bidId: uuid("bid_id").notNull(),
  service: text("service").notNull(),
  description: text("description"),
  qty: doublePrecision("qty").notNull().default(1),
  unitPrice: doublePrecision("unit_price").notNull().default(0),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const leadCampaignsTable = pgTable("lead_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  leadId: uuid("lead_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("active"),
  stepIndex: integer("step_index").notNull().default(0),
  nextSendAt: timestamp("next_send_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type Lead = typeof leadsTable.$inferSelect;
export type Bid = typeof bidsTable.$inferSelect;
export type BidLineItem = typeof bidLineItemsTable.$inferSelect;
export type LeadCampaign = typeof leadCampaignsTable.$inferSelect;
