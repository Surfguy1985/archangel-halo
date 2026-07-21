import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  timestamp,
  date,
} from "drizzle-orm/pg-core";

export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceNo: text("invoice_no").notNull(),
  jobId: uuid("job_id"),
  propertyId: uuid("property_id").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: text("status").notNull().default("draft"),
  poNumber: text("po_number"),
  terms: text("terms").notNull().default("Net 30"),
  billToName: text("bill_to_name"),
  propertyAddress: text("property_address"),
  notes: text("notes"),
  paymentInstructions: text("payment_instructions"),
  issuedOn: date("issued_on", { mode: "string" }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  taxAmount: doublePrecision("tax_amount").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invoiceLineItemsTable = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull(),
  dateOfWork: date("date_of_work", { mode: "string" }),
  unitNo: text("unit_no"),
  typeOfWork: text("type_of_work").notNull(),
  description: text("description"),
  qty: doublePrecision("qty").notNull().default(1),
  unitPrice: doublePrecision("unit_price").notNull().default(0),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id"),
  amount: doublePrecision("amount").notNull(),
  method: text("method"),
  payerName: text("payer_name"),
  checkNumber: text("check_number"),
  checkImagePath: text("check_image_path"),
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
  paymentStatus: text("payment_status").notNull().default("paid"),
  dueDate: date("due_date", { mode: "string" }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  receiptPath: text("receipt_path"),
  approvalStatus: text("approval_status").notNull().default("approved"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  bankTxnId: text("bank_txn_id"),
  bankTxnLabel: text("bank_txn_label"),
  spentOn: timestamp("spent_on", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceLineItem = typeof invoiceLineItemsTable.$inferSelect;
export type Payment = typeof paymentsTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
