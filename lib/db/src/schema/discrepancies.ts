import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
export const discrepanciesTable = pgTable("discrepancies", {
  id: uuid("id").primaryKey().defaultRandom(), jobId: uuid("job_id").notNull(), invoiceId: uuid("invoice_id"),
  crewPaymentId: uuid("crew_payment_id"), type: text("type").notNull(), serviceCode: text("service_code"),
  expectedCents: integer("expected_cents"), actualCents: integer("actual_cents"), varianceCents: integer("variance_cents"),
  severity: text("severity").notNull().default("high"), status: text("status").notNull().default("open"),
  explanation: text("explanation").notNull(), suggestedFix: jsonb("suggested_fix"),
  adminOverrideCents: integer("admin_override_cents"), adminReason: text("admin_reason"),
  resolvedBy: uuid("resolved_by"), resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
