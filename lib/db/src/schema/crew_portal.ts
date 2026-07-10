import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

export const crewMessagesTable = pgTable("crew_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  sender: text("sender").notNull().default("crew"),
  body: text("body").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crewCheckinsTable = pgTable("crew_checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracy: doublePrecision("accuracy"),
  label: text("label"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crewDocumentsTable = pgTable("crew_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  direction: text("direction").notNull().default("to_crew"),
  name: text("name").notNull(),
  storagePath: text("storage_path").notNull(),
  contentType: text("content_type"),
  size: doublePrecision("size"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crewPaymentsTable = pgTable("crew_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  amount: doublePrecision("amount").notNull(),
  method: text("method"),
  status: text("status").notNull().default("pending"),
  note: text("note"),
  jobId: uuid("job_id"),
  dueOn: timestamp("due_on", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CrewMessage = typeof crewMessagesTable.$inferSelect;
export type CrewCheckin = typeof crewCheckinsTable.$inferSelect;
export type CrewDocument = typeof crewDocumentsTable.$inferSelect;
export type CrewPayment = typeof crewPaymentsTable.$inferSelect;
