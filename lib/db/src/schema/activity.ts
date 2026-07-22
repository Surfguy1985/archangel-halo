import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  priority: text("priority").notNull().default("normal"),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  title: text("title").notNull(),
  body: text("body"),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const activitiesTable = pgTable("activities", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  kind: text("kind").notNull(),
  body: text("body"),
  storagePath: text("storage_path"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const voiceLogsTable = pgTable("voice_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  transcript: text("transcript").notNull(),
  actions: jsonb("actions"),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Actions the Autopilot proposes (and, when auto-approve is on, executes).
// status: pending -> executing -> executed | failed, or pending -> dismissed
export const autopilotActionsTable = pgTable(
  "autopilot_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    payload: jsonb("payload"),
    status: text("status").notNull().default("pending"),
    result: text("result"),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("autopilot_actions_kind_entity_uq").on(t.kind, t.entityId)],
);

export type AutopilotAction = typeof autopilotActionsTable.$inferSelect;
export type Notification = typeof notificationsTable.$inferSelect;
export type Activity = typeof activitiesTable.$inferSelect;
export type VoiceLog = typeof voiceLogsTable.$inferSelect;
