import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Falkon Ops integration — Phase 0 schema
//
// Design rules:
//   - falkon_connections is a singleton (one row per HALO deployment).
//   - falkon_events is the outbound signed-callback outbox; the scheduler
//     tick delivers pending rows and updates status.
//   - falkon_inbound_events stores inbound Falkon → HALO events with a
//     Falkon-assigned ID for deduplication.
//   - falkon_policies holds per-property (or global-default) thresholds
//     that govern the ASSISTED/LIVE mode automation gates.
//   - property_units is the Unit/Asset Twin — the largest structural gap
//     found in the audit. unitNo on jobs stays as the display label; this
//     table gives each unit a stable UUID and Falkon external ID.
// ---------------------------------------------------------------------------

/** Singleton connection state: Falkon Ops ↔ HALO handshake. */
export const falkonConnectionsTable = pgTable("falkon_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Falkon-issued org identifier returned during Connect. */
  falkonOrgId: text("falkon_org_id").unique(),
  /** Scrypt/bcrypt hash of the inbound Falkon partner key — never stored raw. */
  apiKeyHash: text("api_key_hash"),
  /** URL HALO POSTs signed callbacks to. */
  webhookUrl: text("webhook_url"),
  /**
   * HMAC-SHA256 signing secret for outbound callbacks.
   * Stored encrypted when FALKON_CREDENTIAL_ENCRYPTION_KEY is set in env.
   */
  webhookSecret: text("webhook_secret"),
  /** Integration mode: OFF | SHADOW | ASSISTED | LIVE */
  mode: text("mode").notNull().default("OFF"),
  /** JSON array of active capability strings. */
  capabilities: jsonb("capabilities").notNull().default([]),
  connectedAt: timestamp("connected_at", { withTimezone: true }),
  /** Set after the round-trip ping verifies the webhook URL responds correctly. */
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  lastPingAt: timestamp("last_ping_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Outbound signed-callback outbox. One row per event emitted by a HALO mutation. */
export const falkonEventsTable = pgTable("falkon_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * Dot-namespaced event name, e.g. "job.walk_approved", "unit.status_changed".
   */
  eventType: text("event_type").notNull(),
  /** HALO entity domain: job | property | unit | crew | invoice | system */
  entityType: text("entity_type").notNull(),
  /** UUID of the primary entity — null for system-level events. */
  entityId: uuid("entity_id"),
  /** Full JSON payload sent to Falkon's webhook. */
  payload: jsonb("payload").notNull(),
  /** Mode snapshot at emit time — preserved for audit even if mode changes. */
  mode: text("mode").notNull(),
  /** Delivery lifecycle: pending → delivered | failed → dead (after 5 attempts). */
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  /** Scheduler delivers when nextRetryAt <= now(). Exponential backoff on failure. */
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  /** Last delivery error string, for the admin dead-letter view. */
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Inbound events from Falkon → HALO. Stored before processing for deduplication. */
export const falkonInboundEventsTable = pgTable("falkon_inbound_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Falkon-assigned event ID — deduplicated via UNIQUE constraint. */
  falkonEventId: text("falkon_event_id").unique(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  /** pending | processed | failed */
  status: text("status").notNull().default("pending"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-property (or global-default when propertyId IS NULL) policy thresholds
 * for the ASSISTED / LIVE automation gates.
 */
export const falkonPoliciesTable = pgTable("falkon_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * NULL = global default row.
   * A property-specific row overrides the global default for that property.
   */
  propertyId: uuid("property_id"),
  /** Max crew rate (cents) that Falkon can auto-approve in LIVE mode. NULL = no auto. */
  maxAutoCrewRate: doublePrecision("max_auto_crew_rate"),
  /** Max invoice amount (cents) that Falkon can auto-approve. NULL = no auto. */
  maxAutoInvoiceAmount: doublePrecision("max_auto_invoice_amount"),
  /** Max change-order amount (cents) for auto-approval. NULL = no auto. */
  maxAutoChangeOrder: doublePrecision("max_auto_change_order"),
  requirePhotoMinBefore: integer("require_photo_min_before").notNull().default(1),
  requirePhotoMinAfter: integer("require_photo_min_after").notNull().default(2),
  /** Metres from property coords for GPS arrival match. */
  requireArrivalRadius: integer("require_arrival_radius").notNull().default(300),
  requireInspection: boolean("require_inspection").notNull().default(false),
  /** LIVE: auto-broadcast to Falkon-ranked crew #1 on job creation. */
  autoDispatchEnabled: boolean("auto_dispatch_enabled").notNull().default(false),
  /** ASSISTED/LIVE: send photo bundle to Falkon AI before Walk approval. */
  aiPhotoReviewEnabled: boolean("ai_photo_review_enabled").notNull().default(false),
  /** Minimum quality score [0,1] from Falkon AI to auto-approve Walk. */
  aiPhotoReviewThreshold: doublePrecision("ai_photo_review_threshold")
    .notNull()
    .default(0.8),
  /**
   * If set, overrides properties.margin_min for Falkon evidence gates.
   * Allows Falkon to raise (never lower) the margin floor without touching
   * the base property record.
   */
  marginFloorOverride: doublePrecision("margin_floor_override"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Unit/Asset Twin — each row is one physical unit at a property.
 *
 * NOTE: "property_units" is already used by the client-board CMS (site-map
 * boxes with x/y/w/h coordinates in client_cms.ts). This table is named
 * "falkon_units" to avoid the collision.
 *
 * This resolves the largest structural gap found in the Falkon audit:
 * jobs.unit_no is a free-text display label with no stable UUID. falkon_units
 * gives each unit a stable UUID and a Falkon external ID. Existing
 * jobs.unit_no is NOT changed — the unit label here matches it exactly so
 * resolution is (propertyId, unitLabel).
 */
export const falkonUnitsTable = pgTable(
  "falkon_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull(),
    /** Matches jobs.unit_no exactly (free-text). */
    unitLabel: text("unit_label").notNull(),
    /** Falkon-assigned external unit ID, populated by the Falkon sync. */
    falkonUnitId: text("falkon_unit_id"),
    /**
     * Operational status:
     *   vacant → needs_turn → in_progress → ready → occupied
     * Derived from the current active make-ready job; updated by route handlers.
     */
    status: text("status").notNull().default("vacant"),
    /** UUID of the currently active make-ready job (app-level ref, no SQL FK). */
    currentJobId: uuid("current_job_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("falkon_units_property_label_uq").on(t.propertyId, t.unitLabel)],
);

export type FalkonConnection = typeof falkonConnectionsTable.$inferSelect;
export type FalkonEvent = typeof falkonEventsTable.$inferSelect;
export type FalkonPolicy = typeof falkonPoliciesTable.$inferSelect;
export type FalkonUnit = typeof falkonUnitsTable.$inferSelect;
