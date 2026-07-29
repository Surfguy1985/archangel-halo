import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Client dashboard kanban board state. HALO-fed cards (jobs, invoices, crews,
// work requests) are projected live from CRM data; this table stores what the
// client layers on top: their own custom cards, plus per-card overrides
// (lane placement, notes) for HALO-fed cards. cardKey is stable:
//   "custom:<uuid>" | "job:<id>" | "invoice:<id>" | "crew:<jobId>" | "request:<id>"
export const clientDashboardCardsTable = pgTable(
  "client_dashboard_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull(),
    cardKey: text("card_key").notNull(),
    kind: text("kind").notNull().default("custom"), // custom | override
    lane: text("lane"), // board lane the client placed the card in
    position: doublePrecision("position").notNull().default(0),
    title: text("title"),
    // Template-library key the client created the card from (null = plain custom).
    template: text("template"),
    description: text("description"),
    notes: text("notes"),
    priority: text("priority"), // low | normal | high | urgent
    dueOn: text("due_on"), // YYYY-MM-DD, local date string
    createdBy: text("created_by"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("client_dashboard_cards_property_key_uq").on(t.propertyId, t.cardKey),
  ],
);

// Audit log for the client-board action registry: every button press the
// dashboard dispatches lands here — allowed, blocked, or failed.
export const clientDashboardActionsTable = pgTable("client_dashboard_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  action: text("action").notNull(),
  cardKey: text("card_key"),
  actorName: text("actor_name"),
  actorRole: text("actor_role").notNull().default("guest"), // admin | member | guest
  payload: jsonb("payload"),
  ok: boolean("ok").notNull().default(false),
  blocked: boolean("blocked").notNull().default(false),
  reason: text("reason"),
  result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type ClientDashboardCard = typeof clientDashboardCardsTable.$inferSelect;
export type ClientDashboardAction = typeof clientDashboardActionsTable.$inferSelect;
