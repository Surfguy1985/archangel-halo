/**
 * Client Board v1 (CAF Edition) — Segment 1 data model.
 *
 * Namespaced `client_*` so we do not collide with office tables:
 *   properties / property_units (CMS boxes) / price_items / invoices / bids /
 *   notifications.
 *
 * The existing `properties` table is extended in properties.ts — never cloned.
 * Operational units live here (`client_units`); CMS `property_units` stay boxes
 * on the site map.
 *
 * Turn clock is event-sourced: `client_turn_stage_events` is append-only.
 * Never store a mutable days_vacant column as source of truth. Dashboards read
 * `client_turn_metrics_mv`, which is refreshed from the event stream.
 */

import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  doublePrecision,
  timestamp,
  jsonb,
  numeric,
  uniqueIndex,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type {
  TurnStage,
  StageOwner,
  WorkSource,
  ClientOrgType,
  StageEventKind,
  ClientBoardFlagSegment,
} from "../clientBoardEnums";

// ── Tenancy ────────────────────────────────────────────────────────────────

export const clientOrgsTable = pgTable(
  "client_orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").$type<ClientOrgType>().notNull(),
    timezone: text("timezone").notNull().default("America/Chicago"),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("client_orgs_slug_uq").on(t.slug)],
);

export const clientOrgMembersTable = pgTable("client_org_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  // Portfolio ids this member can see. Empty/null = inherit from role.
  scope: jsonb("scope").$type<{ portfolioIds?: string[] } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clientPortfoliosTable = pgTable("client_portfolios", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const clientPortfolioPropertiesTable = pgTable(
  "client_portfolio_properties",
  {
    portfolioId: uuid("portfolio_id").notNull(),
    propertyId: uuid("property_id").notNull(),
  },
  (t) => [
    primaryKey({
      columns: [t.portfolioId, t.propertyId],
      name: "client_portfolio_properties_pk",
    }),
  ],
);

export const clientBoardFlagsTable = pgTable("client_board_flags", {
  segment: text("segment").$type<ClientBoardFlagSegment>().primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ── Operational units (not CMS property_units) ─────────────────────────────

export const clientUnitsTable = pgTable(
  "client_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    propertyId: uuid("property_id").notNull(),
    unitNumber: text("unit_number").notNull(),
    bedrooms: integer("bedrooms").notNull().default(1),
    bathrooms: numeric("bathrooms", { precision: 3, scale: 1, mode: "string" })
      .notNull()
      .default("1.0"),
    sqft: integer("sqft"),
    marketRentCents: bigint("market_rent_cents", { mode: "bigint" }).notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("client_units_property_number_uq").on(t.propertyId, t.unitNumber),
    index("client_units_property_idx").on(t.propertyId),
  ],
);

// ── Turn lifecycle ─────────────────────────────────────────────────────────

export const clientTurnsTable = pgTable(
  "client_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    orgId: uuid("org_id").notNull(),
    status: text("status").$type<TurnStage>().notNull(),
    noticeGivenAt: timestamp("notice_given_at", { withTimezone: true }),
    scheduledVacateAt: timestamp("scheduled_vacate_at", { withTimezone: true }),
    actualVacateAt: timestamp("actual_vacate_at", { withTimezone: true }),
    readyAt: timestamp("ready_at", { withTimezone: true }),
    nextMoveInAt: timestamp("next_move_in_at", { withTimezone: true }),
    targetReadyAt: timestamp("target_ready_at", { withTimezone: true }),
    predictedReadyAt: timestamp("predicted_ready_at", { withTimezone: true }),
    predictionConfidence: text("prediction_confidence"),
    workSource: text("work_source").$type<WorkSource>().notNull().default("third_party"),
    assignedVendorOrgId: uuid("assigned_vendor_org_id"),
    verificationHash: text("verification_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("client_turns_property_status_idx").on(t.propertyId, t.status),
    index("client_turns_open_idx")
      .on(t.propertyId, t.actualVacateAt)
      .where(sql`${t.readyAt} IS NULL`),
    index("client_turns_org_idx").on(t.orgId),
    index("client_turns_unit_idx").on(t.unitId),
  ],
);

export const clientTurnStageEventsTable = pgTable(
  "client_turn_stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    stage: text("stage").$type<TurnStage>().notNull(),
    event: text("event").$type<StageEventKind>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    actorId: text("actor_id"),
    actorOrgId: uuid("actor_org_id"),
    source: text("source").notNull().default("app"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("client_turn_stage_events_turn_occurred_idx").on(t.turnId, t.occurredAt)],
);

export const clientStageOwnershipTable = pgTable("client_stage_ownership", {
  stage: text("stage").$type<TurnStage>().primaryKey(),
  owner: text("owner").$type<StageOwner>().notNull(),
});

/**
 * Materialized read model. Dashboards read this, never the raw event stream.
 * Refreshed on every stage-event write via trigger (Segment 2 also has an
 * outbox worker). days_vacant is DERIVED — do not write it onto client_turns.
 */
export const clientTurnMetricsMvTable = pgTable(
  "client_turn_metrics_mv",
  {
    turnId: uuid("turn_id").primaryKey(),
    propertyId: uuid("property_id").notNull(),
    daysVacant: integer("days_vacant").notNull().default(0),
    stageDurations: jsonb("stage_durations")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    clientOwnedHours: numeric("client_owned_hours", {
      precision: 12,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("0"),
    vendorOwnedHours: numeric("vendor_owned_hours", {
      precision: 12,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("0"),
    sharedOwnedHours: numeric("shared_owned_hours", {
      precision: 12,
      scale: 2,
      mode: "string",
    })
      .notNull()
      .default("0"),
    clientOwnedMs: bigint("client_owned_ms", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    vendorOwnedMs: bigint("vendor_owned_ms", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    overTargetDays: integer("over_target_days").notNull().default(0),
    vacancyCostCents: bigint("vacancy_cost_cents", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    isStalled: boolean("is_stalled").notNull().default(false),
    currentStage: text("current_stage").$type<TurnStage>(),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("client_turn_metrics_mv_property_idx").on(t.propertyId)],
);

export const clientPredictionLogTable = pgTable(
  "client_prediction_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    predictedReadyAt: timestamp("predicted_ready_at", { withTimezone: true }).notNull(),
    confidence: text("confidence").notNull(),
    predictedAt: timestamp("predicted_at", { withTimezone: true }).notNull().defaultNow(),
    actualReadyAt: timestamp("actual_ready_at", { withTimezone: true }),
    method: text("method"),
    sampleSize: integer("sample_size"),
  },
  (t) => [index("client_prediction_log_turn_idx").on(t.turnId, t.predictedAt)],
);

export type ClientTurnOutboxPayload = {
  from: TurnStage | null;
  to: TurnStage;
  occurredAt: string;
  eventIds: string[];
};

export const clientTurnOutboxTable = pgTable(
  "client_turn_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    orgId: uuid("org_id").notNull(),
    propertyId: uuid("property_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<ClientTurnOutboxPayload>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [
    index("client_turn_outbox_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.processedAt} IS NULL`),
  ],
);

// ── Evidence ───────────────────────────────────────────────────────────────

export type EvidenceIntegrityFlags = {
  device_clock_skew_seconds?: number;
  gps_outside_geofence?: boolean;
  exif_missing?: boolean;
  duplicate_hash?: boolean;
};

export const clientEvidenceItemsTable = pgTable(
  "client_evidence_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    kind: text("kind").notNull(),
    phase: text("phase").notNull(),
    room: text("room"),
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256").notNull(),
    mime: text("mime"),
    bytes: bigint("bytes", { mode: "bigint" }),
    deviceCapturedAt: timestamp("device_captured_at", { withTimezone: true }),
    serverReceivedAt: timestamp("server_received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deviceLat: doublePrecision("device_lat"),
    deviceLng: doublePrecision("device_lng"),
    gpsAccuracyM: doublePrecision("gps_accuracy_m"),
    exif: jsonb("exif"),
    capturedByUserId: text("captured_by_user_id"),
    integrityFlags: jsonb("integrity_flags").$type<EvidenceIntegrityFlags | null>(),
    tombstonedAt: timestamp("tombstoned_at", { withTimezone: true }),
  },
  (t) => [index("client_evidence_items_turn_phase_idx").on(t.turnId, t.phase)],
);

export const clientGpsEventsTable = pgTable(
  "client_gps_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    accuracyM: doublePrecision("accuracy_m"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    distanceFromUnitM: doublePrecision("distance_from_unit_m"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("client_gps_events_turn_occurred_idx").on(t.turnId, t.occurredAt)],
);

export const TURN_RECORD_VARIANTS = ["full", "move_out_condition"] as const;
export type TurnRecordVariant = (typeof TURN_RECORD_VARIANTS)[number];
export const TURN_RECORD_STATUSES = ["queued", "rendering", "ready", "failed"] as const;
export type TurnRecordStatus = (typeof TURN_RECORD_STATUSES)[number];

export const clientTurnRecordsTable = pgTable(
  "client_turn_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id").notNull(),
    orgId: uuid("org_id").notNull(),
    variant: text("variant").$type<TurnRecordVariant>().notNull(),
    status: text("status").$type<TurnRecordStatus>().notNull().default("queued"),
    storageKey: text("storage_key"),
    sha256: text("sha256"),
    bytes: bigint("bytes", { mode: "bigint" }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp("ready_at", { withTimezone: true }),
  },
  (t) => [index("client_turn_records_turn_idx").on(t.turnId, t.createdAt)],
);

// ── Pricing / scopes / invoices (cents; not office price_items/invoices) ───

export const clientPriceListsTable = pgTable("client_price_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  revision: text("revision").notNull(),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  sourceSopDocId: text("source_sop_doc_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientPriceListItemsTable = pgTable(
  "client_price_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    priceListId: uuid("price_list_id").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    category: text("category"),
    uom: text("uom").notNull().default("ea"),
    unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
    tier: text("tier"),
    isBidOnly: boolean("is_bid_only").notNull().default(false),
    minChargeCents: bigint("min_charge_cents", { mode: "bigint" }),
  },
  (t) => [index("client_price_list_items_list_idx").on(t.priceListId)],
);

export const clientScopesTable = pgTable("client_scopes", {
  id: uuid("id").primaryKey().defaultRandom(),
  turnId: uuid("turn_id").notNull(),
  status: text("status").notNull().default("draft"),
  createdBy: text("created_by"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientScopeLinesTable = pgTable(
  "client_scope_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeId: uuid("scope_id").notNull(),
    priceItemId: uuid("price_item_id"),
    description: text("description").notNull(),
    qty: integer("qty").notNull().default(1),
    uom: text("uom").notNull().default("ea"),
    unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
    extendedCents: bigint("extended_cents", { mode: "bigint" }).notNull(),
    compliance: text("compliance").notNull().default("matched"),
    varianceReason: text("variance_reason"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [index("client_scope_lines_scope_compliance_idx").on(t.scopeId, t.compliance)],
);

export const clientTurnInvoicesTable = pgTable("client_turn_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  turnId: uuid("turn_id").notNull(),
  scopeId: uuid("scope_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  poNumber: text("po_number"),
  status: text("status").notNull().default("draft"),
  subtotalCents: bigint("subtotal_cents", { mode: "bigint" }).notNull(),
  taxCents: bigint("tax_cents", { mode: "bigint" }).notNull().default(sql`0`),
  totalCents: bigint("total_cents", { mode: "bigint" }).notNull(),
  complianceScore: text("compliance_score"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  entrataExportAt: timestamp("entrata_export_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientTurnInvoiceLinesTable = pgTable("client_turn_invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id").notNull(),
  priceItemId: uuid("price_item_id"),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  uom: text("uom").notNull().default("ea"),
  unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
  extendedCents: bigint("extended_cents", { mode: "bigint" }).notNull(),
  compliance: text("compliance").notNull(),
  glCode: text("gl_code"),
  unitNumber: text("unit_number"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ── Bids (vendor-neutral; not office pipeline `bids`) ──────────────────────

export const clientBidRequestsTable = pgTable("client_bid_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  turnId: uuid("turn_id").notNull(),
  scopeId: uuid("scope_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientBidInvitationsTable = pgTable("client_bid_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  bidRequestId: uuid("bid_request_id").notNull(),
  vendorOrgId: uuid("vendor_org_id").notNull(),
  status: text("status").notNull().default("invited"),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),
});

export const clientVendorBidsTable = pgTable("client_vendor_bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  bidRequestId: uuid("bid_request_id").notNull(),
  vendorOrgId: uuid("vendor_org_id").notNull(),
  totalCents: bigint("total_cents", { mode: "bigint" }).notNull(),
  earliestStartAt: timestamp("earliest_start_at", { withTimezone: true }),
  promisedDays: integer("promised_days"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  score: integer("score"),
});

export const clientVendorBidLinesTable = pgTable("client_vendor_bid_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  bidId: uuid("bid_id").notNull(),
  priceItemCode: text("price_item_code").notNull(),
  description: text("description").notNull(),
  qty: integer("qty").notNull().default(1),
  unitPriceCents: bigint("unit_price_cents", { mode: "bigint" }).notNull(),
});

export const clientVendorScorecardsTable = pgTable("client_vendor_scorecards", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendorOrgId: uuid("vendor_org_id").notNull(),
  propertyId: uuid("property_id").notNull(),
  onTimePct: integer("on_time_pct").notNull().default(0),
  reworkRate: integer("rework_rate").notNull().default(0),
  avgTurnDays: numeric("avg_turn_days", { precision: 8, scale: 2, mode: "string" }),
  disputesCount: integer("disputes_count").notNull().default(0),
  capacityUnitsPerWeek: integer("capacity_units_per_week").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
});

// ── Forecasting ────────────────────────────────────────────────────────────

export const clientCapacityDeclarationsTable = pgTable(
  "client_capacity_declarations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorOrgId: uuid("vendor_org_id").notNull(),
    trade: text("trade").notNull(),
    weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
    unitsCapacity: integer("units_capacity").notNull(),
  },
  (t) => [
    uniqueIndex("client_capacity_declarations_uq").on(
      t.vendorOrgId,
      t.trade,
      t.weekStart,
    ),
  ],
);

export const clientTurnForecastsTable = pgTable("client_turn_forecasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id").notNull(),
  weekStart: timestamp("week_start", { withTimezone: true }).notNull(),
  projectedUnits: integer("projected_units").notNull(),
  projectedSpendCents: bigint("projected_spend_cents", { mode: "bigint" }).notNull(),
  confidence: text("confidence").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Cross-cutting ──────────────────────────────────────────────────────────

export const clientAuditLogTable = pgTable("client_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  actorId: text("actor_id"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  before: jsonb("before"),
  after: jsonb("after"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  ip: text("ip"),
  userAgent: text("user_agent"),
});

export const clientPortfolioNotificationsTable = pgTable(
  "client_portfolio_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    payload: jsonb("payload"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export const clientSavedViewsTable = pgTable("client_saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").notNull().default({}),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const clientIdempotencyKeysTable = pgTable(
  "client_idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("client_idempotency_keys_org_key_uq").on(t.orgId, t.key)],
);

export type ClientOrg = typeof clientOrgsTable.$inferSelect;
export type ClientUnit = typeof clientUnitsTable.$inferSelect;
export type ClientTurn = typeof clientTurnsTable.$inferSelect;
export type ClientTurnStageEvent = typeof clientTurnStageEventsTable.$inferSelect;
export type ClientTurnMetrics = typeof clientTurnMetricsMvTable.$inferSelect;
