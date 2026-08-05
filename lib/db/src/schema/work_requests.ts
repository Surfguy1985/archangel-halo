import { pgTable, uuid, text, date, timestamp, boolean, jsonb, doublePrecision } from "drizzle-orm/pg-core";

// Work requests submitted by property managers from their client dashboard.
// Pending requests surface in the desktop Pipeline; accepting one creates a
// job under the property with the requested completion date (flexDueBy).
export const workRequestsTable = pgTable("work_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  requesterName: text("requester_name"),
  serviceId: uuid("service_id"), // price_items row when picked from dropdown
  serviceLabel: text("service_label").notNull(),
  unitNo: text("unit_no"), // legacy single unit; first entry of `units` for new rows
  units: jsonb("units"), // string[] of unit labels (multi-unit requests)
  notes: text("notes"),
  neededBy: date("needed_by", { mode: "string" }), // complete-by date (local)
  emergency: boolean("emergency").notNull().default(false), // ≤24h notice or explicit flag
  poNumber: text("po_number"), // required for normal requests; emergencies may omit it (office approves manually)
  budgetEstimate: doublePrecision("budget_estimate"), // client's expected budget, pre-filled from the price list
  photoPaths: jsonb("photo_paths"), // string[] of /objects/... storage paths
  changeOrderJobId: uuid("change_order_job_id"), // set when this is a change order on an existing job
  bidId: uuid("bid_id"), // set when the client typed an office bid number — request prefilled from that bid
  bidNumber: text("bid_number"), // the B-xxxx the client entered, kept for display
  status: text("status").notNull().default("pending"), // pending | accepted | declined
  declineReason: text("decline_reason"),
  adjustNote: text("adjust_note"), // office note back to the client when approved with changes
  jobId: uuid("job_id"), // set when accepted
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WorkRequest = typeof workRequestsTable.$inferSelect;
