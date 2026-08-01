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
    // Which client board the card lives on: "vendor" (Archangel contractors,
    // HALO-fed) | "pm" (the client's own property-management board).
    board: text("board").notNull().default("vendor"),
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
    // Triage "Defer": hide from the triage queue until this instant passes.
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    // Wekan-style card fields.
    labels: jsonb("labels"), // string[] of label keys (e.g. "maintenance","billing")
    checklist: jsonb("checklist"), // [{ id, text, done }]
    // Client -> office card sending. null = not sent.
    sentToOfficeAt: timestamp("sent_to_office_at", { withTimezone: true }),
    officeStatus: text("office_status"), // pending | accepted | declined
    officeNote: text("office_note"), // office response note back to client
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

// Two-way comment threads on any board card (pushed or client-created).
// cardKey matches client_dashboard_cards.cardKey / pushed card "pushed:<id>".
export const clientCardCommentsTable = pgTable("client_card_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  cardKey: text("card_key").notNull(),
  authorType: text("author_type").notNull(), // office | client
  authorName: text("author_name").notNull(),
  body: text("body").notNull(),
  // Slack-style thread upgrades: optional photo/file attachment (object
  // storage path), read receipt (set when the OTHER side opens the thread),
  // and email-digest claim marker (claim-before-send, crew_messages pattern).
  attachmentName: text("attachment_name"),
  attachmentPath: text("attachment_path"),
  readAt: timestamp("read_at", { withTimezone: true }),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Live in-app notification feed for both surfaces. audience scopes delivery.
export const clientBoardNotificationsTable = pgTable("client_board_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  audience: text("audience").notNull(), // client | office
  type: text("type").notNull(), // comment | card_sent | card_response | card_pushed | card_updated
  title: text("title").notNull(),
  body: text("body"),
  cardKey: text("card_key"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Cleared-card history. When a client clears a card off their board, a
// snapshot lands here so the board stays clean but nothing is lost — feeds
// the History tab and the CSV export. Snapshot fields are denormalized at
// clear time because HALO-fed cards are recomputed on read.
export const clientCardHistoryTable = pgTable("client_card_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  cardKey: text("card_key").notNull(),
  title: text("title").notNull(),
  template: text("template"), // job | makeready | invoice | crew | request | custom | ...
  status: text("status").notNull(), // completed | paid | cleared
  amountPaid: doublePrecision("amount_paid").notNull().default(0),
  unitLabel: text("unit_label"),
  jobLabel: text("job_label"),
  summary: text("summary"),
  frequency: text("frequency").notNull().default("one_time"), // one_time | recurring
  clearedBy: text("cleared_by"),
  clearedAt: timestamp("cleared_at", { withTimezone: true }).notNull().defaultNow(),
  // Restore paper trail: when a writer restores the card back onto the board,
  // the entry stays here but gets stamped so the History tab can show it.
  restoredBy: text("restored_by"),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
});

// Concierge chat history — one row per chat message, persisted per signed-in
// client user so the conversation survives reloads and devices. Guests chat
// ephemerally (nothing stored). meta carries pending confirm chips and links.
export const clientConciergeMessagesTable = pgTable("client_concierge_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  clientUserId: uuid("client_user_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// One row per EXECUTED concierge confirmation (jti = the token's unique id).
// The primary key makes token consumption atomic and multi-instance safe: a
// replayed or double-clicked confirm hits a duplicate-key error and is
// rejected, so a confirm chip can only ever run its action once.
export const clientConciergeConfirmsTable = pgTable("client_concierge_confirms", {
  jti: uuid("jti").primaryKey(),
  propertyId: uuid("property_id").notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ClientConciergeMessage = typeof clientConciergeMessagesTable.$inferSelect;
export type ClientCardHistory = typeof clientCardHistoryTable.$inferSelect;
export type ClientCardComment = typeof clientCardCommentsTable.$inferSelect;
export type ClientBoardNotification = typeof clientBoardNotificationsTable.$inferSelect;
export type ClientDashboardCard = typeof clientDashboardCardsTable.$inferSelect;
export type ClientDashboardAction = typeof clientDashboardActionsTable.$inferSelect;
