import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  doublePrecision,
  timestamp,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

// Subscription back-office: one account per property (client), managed from
// the desktop Admin tab. The dashboardToken gates the future client dashboard.
export const clientAccountsTable = pgTable("client_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull().unique(),
  tier: text("tier").notNull().default("basic"), // basic | pro | enterprise
  userSeats: integer("user_seats").notNull().default(3),
  guestSeats: integer("guest_seats").notNull().default(5),
  status: text("status").notNull().default("active"), // active | paused | cancelled
  notes: text("notes"),
  logoPath: text("logo_path"), // object storage path for the client's logo
  servicesOverview: text("services_overview"), // what we do for them, shown on their dashboard
  dashboardToken: text("dashboard_token").notNull().unique(),
  // Subscription billing, managed by the client's admin from their dashboard.
  billingDay: integer("billing_day").notNull().default(1), // day of month the charge pulls (1–28)
  // Sanitized payment method only — last4 + display fields, never full numbers.
  paymentMethod: jsonb("payment_method").$type<{
    methodType: "card" | "ach";
    last4: string;
    brand?: string | null;
    bankName?: string | null;
    cardExp?: string | null;
    payerName: string;
    zip?: string | null;
    updatedAt: string;
  } | null>(),
  billingContact: jsonb("billing_contact").$type<{
    name?: string | null;
    email?: string | null;
    company?: string | null;
    phone?: string | null;
  } | null>(),
  // Optional outbound webhook: every board-card event is POSTed here so the
  // client can mirror cards into their own tools (Trello, Slack, Zapier...).
  webhookUrl: text("webhook_url"),
  // Per-account toggle: email the billing/primary contact a batched digest
  // when new cards land on their board (deduped hourly by the scheduler).
  notifyNewCards: boolean("notify_new_cards").notNull().default(true),
  onboardingStatus: text("onboarding_status").notNull().default("not_sent"), // not_sent | sent
  onboardingSentAt: timestamp("onboarding_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clientUsersTable = pgTable(
  "client_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    role: text("role").notNull().default("member"), // admin | member | guest
    // Feature keys this user can access on the client dashboard. NULL means
    // "use the defaults for their role" until someone customizes it.
    permissions: jsonb("permissions").$type<string[] | null>(),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    lastPasswordResetAt: timestamp("last_password_reset_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("client_users_property_email_uq").on(t.propertyId, t.email),
  ],
);

export const clientOnboardingSendsTable = pgTable("client_onboarding_sends", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  channel: text("channel").notNull(), // email | sms
  sentTo: text("sent_to").notNull(),
  link: text("link").notNull(),
  status: text("status").notNull().default("sent"), // sent | failed
  detail: text("detail"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Trello-style board cards for the client dashboard. Cards in the
// "Archangel Contractors" lane are raised automatically whenever the office
// sends the client anything (invoice, pay link, recap, live tracker...),
// prepopulated with every link and amount so the client never hunts for them.
export const clientBoardCardsTable = pgTable(
  "client_board_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull(),
    // Where the card sits on the client's board.
    column: text("column").notNull().default("inbox"), // inbox | todo | in_progress | done
    // What kind of send raised it.
    kind: text("kind").notNull(), // invoice | payment_request | summary | tracker | photos | flag | manual
    title: text("title").notNull(),
    body: text("body"),
    // What the client is expected to do, shown as the card's action chip.
    actionLabel: text("action_label"), // e.g. "Pay now", "Review & approve", "Watch live"
    amount: doublePrecision("amount"),
    dueDate: text("due_date"), // YYYY-MM-DD, local date parts
    // Prepopulated links: pay pages, PDFs, trackers, summaries...
    links: jsonb("links")
      .$type<{ label: string; url: string; kind?: string | null }[]>()
      .notNull()
      .default([]),
    // Source dedupe key: one card per sent thing, updated on re-send.
    sourceType: text("source_type").notNull(), // invoice | payment_request | job_summary | tracker | manual
    sourceId: text("source_id").notNull(),
    jobId: uuid("job_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // When this card was included in a client notification digest. NULL means
    // "not yet notified" — the scheduler sweeps these hourly.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("client_board_cards_source_uq").on(
      t.propertyId,
      t.sourceType,
      t.sourceId,
    ),
  ],
);

export type ClientBoardCard = typeof clientBoardCardsTable.$inferSelect;

export type ClientAccount = typeof clientAccountsTable.$inferSelect;
export type ClientUser = typeof clientUsersTable.$inferSelect;
export type ClientOnboardingSend =
  typeof clientOnboardingSendsTable.$inferSelect;
