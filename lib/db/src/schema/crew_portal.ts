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
  // Set on checkout when the crew is moving to a next job; cleared on next check-in.
  movingToUnit: text("moving_to_unit"),
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

/**
 * Append-only record of a crew member accepting the crew-link instructions
 * gate (the umbrella "check in, check out, before/after photos or your pay may
 * be delayed" requirement shown on every crew QR link).
 *
 * One row per acceptance — NOT one per crew. A supervisor reviewing pay needs
 * to see who agreed, when, through which link, and the exact wording they were
 * shown, so `termsText` is a snapshot: re-wording the gate later must never
 * rewrite what an earlier crew agreed to.
 *
 * `linkKind` is 'paycard' | 'portal' | 'join' | 'app'. Acceptance is always
 * attributed through the token's crew — a crew id from the client is never
 * trusted, because crew links are unauthenticated bearer tokens.
 */
export const crewLinkAcksTable = pgTable(
  "crew_link_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    linkKind: text("link_kind").notNull(),
    // crew_checkin_links.id / crew_join_links.id when the surface has one.
    linkId: uuid("link_id"),
    tokenPrefix: text("token_prefix"),
    lang: text("lang").notNull().default("en"),
    version: text("version").notNull(),
    termsText: text("terms_text").notNull(),
    agreedAt: timestamp("agreed_at", { withTimezone: true }).notNull().defaultNow(),
    agreedBy: text("agreed_by").notNull(),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
  },
  (t) => [index("crew_link_acks_crew_agreed_idx").on(t.crewId, t.agreedAt)],
);

/**
 * Extra portal bearers for one crew — one row per device that claimed the
 * person from the shared roster code. crews.portal_token still holds the
 * original link; these are additional keys to the same portal so a second
 * phone never has to rotate (and break) the first one.
 */
export const crewPortalBearersTable = pgTable(
  "crew_portal_bearers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    // sha256 of the URL bearer. The bearer itself is shown once and never stored.
    tokenHash: text("token_hash").notNull().unique(),
    source: text("source").notNull().default("roster"),
    // pending | approved | denied. A bearer is INERT until the office approves
    // it — that approval is the only thing standing between a shared code and
    // somebody else's pay, so authentication must check status, not existence.
    status: text("status").notNull().default("pending"),
    // The name the person picked or typed, kept for the office's approval card
    // even if the crew row is later renamed.
    requestedName: text("requested_name"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    deniedAt: timestamp("denied_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("crew_portal_bearers_crew_idx").on(t.crewId)],
);

export type CrewPortalBearer = typeof crewPortalBearersTable.$inferSelect;

export type CrewLinkAck = typeof crewLinkAcksTable.$inferSelect;

export type CrewPhoto = typeof crewPhotosTable.$inferSelect;
export type PhotoShare = typeof photoSharesTable.$inferSelect;
export type CrewMessage = typeof crewMessagesTable.$inferSelect;
export type CrewCheckin = typeof crewCheckinsTable.$inferSelect;
export type CrewTrackPoint = typeof crewTrackPointsTable.$inferSelect;
export type CrewDocument = typeof crewDocumentsTable.$inferSelect;
export type CrewPayment = typeof crewPaymentsTable.$inferSelect;
export type CrewInvoice = typeof crewInvoicesTable.$inferSelect;
export type CrewInvoiceItem = typeof crewInvoiceItemsTable.$inferSelect;
