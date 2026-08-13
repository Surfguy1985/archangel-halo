import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Durable Base44 sync run history for diagnostics.
 * Never store tokens or raw Base44 credentials here.
 */
export const base44SyncRunsTable = pgTable(
  "base44_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    status: text("status").notNull(), // success | partial | failed | skipped
    errorCode: text("error_code"),
    freshness: text("freshness").notNull().default("unavailable"),
    totalCreated: integer("total_created").notNull().default(0),
    totalUpdated: integer("total_updated").notNull().default(0),
    totalStale: integer("total_stale").notNull().default(0),
    totalErrors: integer("total_errors").notNull().default(0),
    attempts: integer("attempts").notNull().default(1),
    resources: jsonb("resources").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("base44_sync_runs_attempted_idx").on(t.attemptedAt)],
);

export type Base44SyncRun = typeof base44SyncRunsTable.$inferSelect;

/**
 * Clean operational projection of Base44 facts HALO is allowed to know.
 * Typed fields only — never a raw JSON dump for model prompts.
 */
export const base44EvidenceTable = pgTable(
  "base44_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resource: text("resource").notNull(),
    base44Id: text("base44_id").notNull(),
    kind: text("kind").notNull(),
    propertyName: text("property_name"),
    unitLabel: text("unit_label"),
    title: text("title"),
    body: text("body"),
    mediaUrl: text("media_url"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    stale: boolean("stale").notNull().default(false),
    payloadHash: text("payload_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("base44_evidence_resource_id_uq").on(t.resource, t.base44Id),
    index("base44_evidence_property_idx").on(t.propertyName),
    index("base44_evidence_kind_idx").on(t.kind),
  ],
);

export type Base44Evidence = typeof base44EvidenceTable.$inferSelect;
