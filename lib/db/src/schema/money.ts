import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  timestamp,
} from "drizzle-orm/pg-core";

export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNo: text("invoice_no").notNull(),
  jobId: uuid("job_id"),
  propertyId: uuid("property_id").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull().default("draft"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id"),
  amount: doublePrecision("amount").notNull(),
  method: text("method"),
  receivedAt: timestamp("received_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const expensesTable = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id"),
  propertyId: uuid("property_id"),
  vendor: text("vendor"),
  category: text("category"),
  amount: doublePrecision("amount").notNull(),
  source: text("source"),
  spentOn: timestamp("spent_on", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Invoice = typeof invoicesTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
