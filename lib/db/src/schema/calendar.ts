import { pgTable, uuid, text, boolean, date, timestamp } from "drizzle-orm/pg-core";

export const calendarEventsTable = pgTable("calendar_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  notes: text("notes"),
  eventDate: date("event_date", { mode: "string" }).notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  allDay: boolean("all_day").notNull().default(false),
  color: text("color").notNull().default("gold"),
  jobId: uuid("job_id"),
  crewId: uuid("crew_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CalendarEvent = typeof calendarEventsTable.$inferSelect;
