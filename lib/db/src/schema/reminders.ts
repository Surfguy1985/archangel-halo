import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";

export const remindersTable = pgTable("reminders", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  entityType: text("entity_type"),
  entityId: text("entity_id"),
  entityLabel: text("entity_label"),
  remindAt: timestamp("remind_at", { withTimezone: true }),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  createdBy: text("created_by").notNull().default("office"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Reminder = typeof remindersTable.$inferSelect;
