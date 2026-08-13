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
   * Falkon's dedicated event-ingestion endpoint (preferred over webhookUrl
   * for outbox delivery when available). Populated via /falkon/connect.
   */
  eventIngestUrl: text("event_ingest_url"),
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
  /** Human-readable connection status: connected | verified | disconnected */
  status: text("status").default("connected"),
  /** Per-step result snapshots for the five-step verification flow. */
  verificationSteps: jsonb("verification_steps"),
  /** Falkon-assigned client ID mirrored from their trust response. */
  partnerClientId: text("partner_client_id"),
  /** Falkon-assigned tenant string. */
  partnerTenant: text("partner_tenant"),
  /** Timestamp of the most recent successful trust-document verification with Falkon. */
  trustDocVerifiedAt: timestamp("trust_doc_verified_at", { withTimezone: true }),
  /**
   * Timestamp set when HALO successfully pushes the capability registry to the
   * Falkon gateway. Required for the "Capabilities Registered" eligibility gate.
   * Cleared on reconnect/disconnect.
   */
  capabilitiesRegisteredAt: timestamp("capabilities_registered_at", { withTimezone: true }),
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

// ── Falkon Network — Peer Registry ───────────────────────────────────────────

export const falkonPeersTable = pgTable(
  "falkon_peers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Bare domain (no protocol) — unique key. */
    domain: text("domain").notNull(),
    trustDocUrl: text("trust_doc_url").notNull(),
    capabilitiesUrl: text("capabilities_url").notNull(),
    /** pending_peer | connected | degraded | disconnected */
    healthState: text("health_state").notNull().default("pending_peer"),
    lastHealthCheckAt: timestamp("last_health_check_at", { withTimezone: true }),
    /** Cached trust document JSON from last poll. */
    trustDocData: jsonb("trust_doc_data"),
    /** Cached capabilities JSON from last poll. */
    capabilitiesData: jsonb("capabilities_data"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("falkon_peers_domain_uq").on(t.domain)],
);

// ── Falkon Network — Cross-Business Request Model ────────────────────────────

export const falkonCrossRequestsTable = pgTable(
  "falkon_cross_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** inbound | outbound */
    direction: text("direction").notNull(),
    peerId: uuid("peer_id"),
    peerName: text("peer_name"),
    capabilityId: text("capability_id").notNull(),
    capabilityName: text("capability_name"),
    /** Idempotency key — unique. */
    correlationId: text("correlation_id").notNull(),
    /** Peer's internal reference (for their tracking). */
    externalRef: text("external_ref"),
    /**
     * State machine:
     *   Inbound:  awaiting_approval → approved | rejected
     *   Outbound: pending_delivery → sent | delivery_failed
     *   Both:     → cancelled | fulfilled
     */
    approvalState: text("approval_state").notNull().default("pending_delivery"),
    summary: text("summary"),
    /** Data snapshot the approval is bound to — prevents bait-and-switch. */
    sharedDataSnapshot: jsonb("shared_data_snapshot"),
    requesterIdentity: jsonb("requester_identity"),
    providerIdentity: jsonb("provider_identity"),
    /** Append-only event history array [{ts, event, detail, attempt?}]. */
    requestEvents: jsonb("request_events").default([]),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("falkon_cross_requests_correlation_uq").on(t.correlationId)],
);

// ── Falkon Network — Phase Gate Activation State ─────────────────────────────

export const falkonPhaseGatesTable = pgTable(
  "falkon_phase_gates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 1–6. */
    phase: integer("phase").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    activatedBy: text("activated_by"),
    /** Phase number this gate was rolled back from, for audit trail. */
    rollbackTo: integer("rollback_to"),
    readinessSnapshot: jsonb("readiness_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("falkon_phase_gates_phase_uq").on(t.phase)],
);

// ── Falkon Network — Append-Only Audit Log ───────────────────────────────────

export const falkonAuditLogTable = pgTable("falkon_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  /** office | system */
  actor: text("actor").notNull().default("system"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull(),
  /** Structured payload — no secrets ever stored here. */
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only policy decisions for every gated mutation. */
export const falkonPolicyDecisionsTable = pgTable("falkon_policy_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  correlationId: text("correlation_id").notNull(),
  mode: text("mode").notNull(),
  action: text("action").notNull(),
  decision: text("decision").notNull(),
  actorChannel: text("actor_channel").notNull(),
  actor: text("actor"),
  role: text("role"),
  tenantId: text("tenant_id"),
  capability: text("capability"),
  targetType: text("target_type"),
  targetId: text("target_id"),
  policyGranted: boolean("policy_granted").notNull().default(false),
  reason: text("reason").notNull(),
  approvalId: uuid("approval_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Durable pending approvals created in ASSISTED mode. */
export const falkonPendingApprovalsTable = pgTable("falkon_pending_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  actor: text("actor"),
  role: text("role"),
  tenantId: text("tenant_id"),
  capability: text("capability"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"),
  decisionId: uuid("decision_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ── Falkon Exchange — Phase 3 tables ─────────────────────────────────────────
//
// All Exchange data is in DRAFT state until Phase 3 is commercially activated.
// Activation requires LIVE mode + ≥5 fulfilled cross-business requests + merchant
// agreement — enforced at the /exchange/activate endpoint, never bypassed here.

/**
 * Canonical workflow products HALO can license via the Falkon Exchange.
 * Five products are seeded on server boot (idempotent). Additional products
 * may be created by operators via POST /exchange/products.
 */
export const falkonExchangeProductsTable = pgTable("falkon_exchange_products", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Stable slug identifier — unique, URL-safe, e.g. "make-ready-pipeline". */
  productKey: text("product_key").notNull().unique(),
  name: text("name").notNull(),
  /** "workflow" | "api" | "platform" */
  category: text("category").notNull().default("workflow"),
  /** "per_job" | "per_unit" | "monthly" | "per_call" */
  pricingModel: text("pricing_model").notNull().default("per_job"),
  /** Price in cents. NULL = custom/negotiated pricing. */
  pricePerUnit: doublePrecision("price_per_unit"),
  /** Service-level agreement in hours. */
  slaHours: integer("sla_hours").notNull().default(24),
  /** "available" | "limited" | "unavailable" */
  availability: text("availability").notNull().default("available"),
  description: text("description"),
  /** Array of capability descriptor strings. */
  capabilities: jsonb("capabilities").notNull().default([]),
  /** "draft" | "active" | "archived". All products start as draft. */
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Exchange Listing — the public-facing card for a product on the Exchange.
 * Listings are always created as "draft" and may only be promoted to "live"
 * after Exchange commercial activation (all prerequisites met).
 */
export const falkonExchangeListingsTable = pgTable("falkon_exchange_listings", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  /** Human-readable price string, e.g. "$450 / job". */
  priceDisplay: text("price_display"),
  /** Human-readable SLA string, e.g. "24-hour turnaround". */
  slaSummary: text("sla_summary"),
  /** "available" | "limited" | "unavailable" */
  availabilityStatus: text("availability_status").notNull().default("available"),
  /** "draft" | "pending_review" | "live" | "archived". Starts as draft always. */
  visibility: text("visibility").notNull().default("draft"),
  draftedAt: timestamp("drafted_at", { withTimezone: true }).notNull().defaultNow(),
  /** Set only when promoted to live after activation. */
  publishedAt: timestamp("published_at", { withTimezone: true }),
  /** Arbitrary metadata (tags, categories, featured flag, etc.). */
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Partner entitlement — grants a named partner organization access to a product.
 * Created by operators via POST /exchange/entitlements (boundary-gated).
 */
export const falkonExchangeEntitlementsTable = pgTable("falkon_exchange_entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull(),
  /** Falkon org identifier of the partner receiving access. */
  partnerOrg: text("partner_org").notNull(),
  /** Optional API key record linked to this entitlement. */
  apiKeyId: uuid("api_key_id"),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** NULL = unlimited. */
  usageLimit: integer("usage_limit"),
  usageCount: integer("usage_count").notNull().default(0),
  /** "active" | "revoked" | "expired" */
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Metered usage log — one row per usage event (batch or single call).
 * Used to compute billing, enforce quotas, and produce revenue records.
 */
export const falkonExchangeUsageTable = pgTable("falkon_exchange_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  entitlementId: uuid("entitlement_id"),
  productId: uuid("product_id").notNull(),
  apiKeyId: uuid("api_key_id"),
  /** Endpoint or capability invoked, e.g. "/make-ready/create". */
  endpoint: text("endpoint"),
  callCount: integer("call_count").notNull().default(1),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Revenue metadata — draft revenue records per entitlement per billing period.
 * In draft/inactive Exchange state, status is always "draft".
 * Real settlement requires Exchange to be commercially activated.
 */
export const falkonExchangeRevenueTable = pgTable("falkon_exchange_revenue", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull(),
  entitlementId: uuid("entitlement_id"),
  /** Billing period in YYYY-MM format. */
  period: text("period").notNull(),
  /** Amount in cents. */
  amount: doublePrecision("amount").notNull().default(0),
  currency: text("currency").notNull().default("USD"),
  /** "draft" | "pending" | "settled". Always "draft" until Exchange activates. */
  status: text("status").notNull().default("draft"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Partner API keys for programmatic consumption of Exchange products.
 * keyHash stores a bcrypt/scrypt hash — the raw key is never persisted.
 * In draft Exchange state, no external partner calls are accepted.
 */
export const falkonApiKeysTable = pgTable(
  "falkon_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Scrypt/bcrypt hash of the raw API key — never stored raw. */
    keyHash: text("key_hash").notNull(),
    partnerOrg: text("partner_org").notNull(),
    /** Array of scope strings, e.g. ["make-ready:read", "billing:read"]. */
    scopes: jsonb("scopes").notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** "active" | "revoked" | "expired" */
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("falkon_api_keys_hash_uq").on(t.keyHash)],
);

/**
 * Exchange activation singleton — tracks activation state and prerequisites.
 * Enforced as a singleton at the DB level via a UNIQUE constraint on
 * `singleton_key` (always "singleton"). `ensureActivationRow()` uses
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING` to atomically insert-or-read
 * the row, eliminating any concurrent-insert race.
 *
 * Operators use PATCH /exchange/activation/merchant-agreement to accept the
 * merchant agreement (one of the three activation prerequisites), then POST
 * /exchange/activate — which evaluates all prerequisites first, then applies
 * the Falkon boundary gate only when all are met.
 */
export const falkonExchangeActivationTable = pgTable(
  "falkon_exchange_activation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Singleton enforcer — always "singleton". The UNIQUE index on this column
     * prevents more than one row from ever existing in the table.
     */
    singletonKey: text("singleton_key").notNull().default("singleton"),
    /** "draft" | "pending" | "active". Starts as draft. */
    state: text("state").notNull().default("draft"),
    /** Last evaluated prerequisite snapshot (for display). */
    prerequisitesMet: jsonb("prerequisites_met").notNull().default({}),
    activationAttemptedAt: timestamp("activation_attempted_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    merchantAgreementAccepted: boolean("merchant_agreement_accepted").notNull().default(false),
    merchantAgreementAt: timestamp("merchant_agreement_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("falkon_exchange_activation_singleton_uq").on(t.singletonKey)],
);

// ── Type Exports ─────────────────────────────────────────────────────────────

export type FalkonConnection = typeof falkonConnectionsTable.$inferSelect;
export type FalkonEvent = typeof falkonEventsTable.$inferSelect;
export type FalkonPolicy = typeof falkonPoliciesTable.$inferSelect;
export type FalkonUnit = typeof falkonUnitsTable.$inferSelect;
export type FalkonPeer = typeof falkonPeersTable.$inferSelect;
export type FalkonCrossRequest = typeof falkonCrossRequestsTable.$inferSelect;
export type FalkonPhaseGate = typeof falkonPhaseGatesTable.$inferSelect;
export type FalkonAuditLog = typeof falkonAuditLogTable.$inferSelect;
export type FalkonPolicyDecision = typeof falkonPolicyDecisionsTable.$inferSelect;
export type FalkonPendingApproval = typeof falkonPendingApprovalsTable.$inferSelect;
export type FalkonExchangeProduct = typeof falkonExchangeProductsTable.$inferSelect;
export type FalkonExchangeListing = typeof falkonExchangeListingsTable.$inferSelect;
export type FalkonExchangeEntitlement = typeof falkonExchangeEntitlementsTable.$inferSelect;
export type FalkonExchangeUsage = typeof falkonExchangeUsageTable.$inferSelect;
export type FalkonExchangeRevenue = typeof falkonExchangeRevenueTable.$inferSelect;
export type FalkonApiKey = typeof falkonApiKeysTable.$inferSelect;
export type FalkonExchangeActivation = typeof falkonExchangeActivationTable.$inferSelect;
