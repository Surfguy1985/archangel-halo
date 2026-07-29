import { pgTable, uuid, text, date, timestamp } from "drizzle-orm/pg-core";

// Work requests submitted by property managers from their client dashboard.
// Pending requests surface in the desktop Pipeline; accepting one creates a
// job under the property with the requested completion date (flexDueBy).
export const workRequestsTable = pgTable("work_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  requesterName: text("requester_name"),
  serviceId: uuid("service_id"), // price_items row when picked from dropdown
  serviceLabel: text("service_label").notNull(),
  unitNo: text("unit_no"),
  notes: text("notes"),
  neededBy: date("needed_by", { mode: "string" }), // complete-by date (local)
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  declineReason: text("decline_reason"),
  jobId: uuid("job_id"), // set when accepted
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkRequest = typeof workRequestsTable.$inferSelect;
