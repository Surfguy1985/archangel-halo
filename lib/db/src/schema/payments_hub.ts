import {
  pgTable,
  uuid,
  text,
  doublePrecision,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

// A branded payment request sent to a property, covering one or more jobs.
export const paymentRequestsTable = pgTable("payment_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestNo: text("request_no").notNull(),
  token: text("token").notNull().unique(),
  propertyId: uuid("property_id").notNull(),
  total: doublePrecision("total").notNull().default(0),
  memo: text("memo"),
  status: text("status").notNull().default("draft"), // draft | sent | paid | returned
  sentVia: text("sent_via"), // email | sms
  sentTo: text("sent_to"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidAmount: doublePrecision("paid_amount"),
  paymentMethod: text("payment_method"), // card | ach | wire | echeck
  confirmationNo: text("confirmation_no"),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  returnReason: text("return_reason"),
  // OCR-extracted payer payment info (verified by the office before sending)
  payerInfo: jsonb("payer_info"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Per-job breakdown lines on a payment request.
export const paymentRequestJobsTable = pgTable("payment_request_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id").notNull(),
  jobId: uuid("job_id"),
  invoiceId: uuid("invoice_id"),
  label: text("label").notNull(),
  amount: doublePrecision("amount").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Crew banking info submitted through the portal (Plaid-style flow).
export const crewBankAccountsTable = pgTable("crew_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull().unique(),
  accountKind: text("account_kind").notNull().default("personal"), // personal | business
  holderName: text("holder_name").notNull(),
  businessName: text("business_name"),
  bankName: text("bank_name"),
  accountType: text("account_type").notNull().default("checking"), // checking | savings
  routingNumber: text("routing_number").notNull(),
  accountNumber: text("account_number").notNull(),
  status: text("status").notNull().default("pending"), // pending | verified
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

// Crew payouts distributed from received property payments (Cybrid ACH stub).
export const crewPayoutsTable = pgTable("crew_payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  jobId: uuid("job_id").notNull(),
  paymentRequestId: uuid("payment_request_id"),
  amount: doublePrecision("amount").notNull(),
  method: text("method").notNull().default("ach"),
  status: text("status").notNull().default("paid"), // paid | returned
  confirmationNo: text("confirmation_no").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  returnedAt: timestamp("returned_at", { withTimezone: true }),
  returnReason: text("return_reason"),
});

export type PaymentRequest = typeof paymentRequestsTable.$inferSelect;
export type PaymentRequestJob = typeof paymentRequestJobsTable.$inferSelect;
export type CrewBankAccount = typeof crewBankAccountsTable.$inferSelect;
export type CrewPayout = typeof crewPayoutsTable.$inferSelect;
