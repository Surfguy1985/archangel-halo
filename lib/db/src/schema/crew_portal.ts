import {
  pgTable,
  uuid,
  text,
  boolean,
  doublePrecision,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const crewMessagesTable = pgTable("crew_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  sender: text("sender").notNull().default("crew"),
  body: text("body").notNull(),
  attachmentName: text("attachment_name"),
  attachmentPath: text("attachment_path"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crewCheckinsTable = pgTable("crew_checkins", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  jobId: uuid("job_id"),
  kind: text("kind").notNull().default("checkin"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracy: doublePrecision("accuracy"),
  label: text("label"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// 30-second GPS breadcrumb pings while a crew is checked in (live trail).
export const crewTrackPointsTable = pgTable(
  "crew_track_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    jobId: uuid("job_id"),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracy: doublePrecision("accuracy"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("crew_track_points_job_created_idx").on(t.jobId, t.createdAt),
    index("crew_track_points_crew_created_idx").on(t.crewId, t.createdAt),
    index("crew_track_points_created_idx").on(t.createdAt),
  ],
);

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

export const crewPhotosTable = pgTable("crew_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  jobId: uuid("job_id"),
  storagePath: text("storage_path").notNull(),
  note: text("note"),
  takenOn: text("taken_on").notNull(),
  phase: text("phase"),
  sha256: text("sha256"),
  sizeBytes: doublePrecision("size_bytes"),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  accuracy: doublePrecision("accuracy"),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const photoSharesTable = pgTable("photo_shares", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  day: text("day").notNull(),
  token: text("token").notNull().unique(),
  notes: text("notes"),
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
  // null/job_pay = normal job payment; bonus | gift_card are extras shown in
  // the crew work-history popup.
  kind: text("kind"),
  note: text("note"),
  jobId: uuid("job_id"),
  dueOn: timestamp("due_on", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crewInvoicesTable = pgTable("crew_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  crewId: uuid("crew_id").notNull(),
  jobId: uuid("job_id"),
  propertyId: uuid("property_id"),
  invoiceNo: text("invoice_no"),
  poNumber: text("po_number"),
  invoiceDate: text("invoice_date").notNull(),
  terms: text("terms"),
  dueDate: text("due_date"),
  fromCompany: text("from_company").notNull(),
  fromTrade: text("from_trade"),
  fromAddress: text("from_address"),
  fromCityStateZip: text("from_city_state_zip"),
  fromContact: text("from_contact"),
  fromPhone: text("from_phone"),
  fromEmail: text("from_email"),
  propertyAddress: text("property_address").notNull(),
  subtotal: doublePrecision("subtotal").notNull(),
  total: doublePrecision("total").notNull(),
  signatureName: text("signature_name").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("submitted"),
  adminNote: text("admin_note"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const crewInvoiceItemsTable = pgTable("crew_invoice_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull(),
  dateOfWork: text("date_of_work").notNull(),
  unitNo: text("unit_no"),
  typeOfWork: text("type_of_work").notNull(),
  qty: doublePrecision("qty").notNull(),
  unitPrice: doublePrecision("unit_price").notNull(),
  amount: doublePrecision("amount").notNull(),
  sortOrder: doublePrecision("sort_order").notNull().default(0),
});

export type CrewPhoto = typeof crewPhotosTable.$inferSelect;
export type PhotoShare = typeof photoSharesTable.$inferSelect;
export type CrewMessage = typeof crewMessagesTable.$inferSelect;
export type CrewCheckin = typeof crewCheckinsTable.$inferSelect;
export type CrewTrackPoint = typeof crewTrackPointsTable.$inferSelect;
export type CrewDocument = typeof crewDocumentsTable.$inferSelect;
export type CrewPayment = typeof crewPaymentsTable.$inferSelect;
export type CrewInvoice = typeof crewInvoicesTable.$inferSelect;
export type CrewInvoiceItem = typeof crewInvoiceItemsTable.$inferSelect;
