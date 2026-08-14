import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/**
 * Twilio SMS log. Not a worker inbox UI.
 *
 * Outbound rows start at Twilio's accept status ("queued"/"accepted") and are
 * settled later by the delivery webhook. Twilio accepting a message says
 * nothing about whether a carrier delivered it — unregistered A2P/toll-free
 * traffic is accepted and then silently dropped — so the terminal status and
 * errorCode here are the only honest record of what reached a phone.
 */
export const haloSmsMessagesTable = pgTable(
  "halo_sms_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    direction: text("direction").notNull(),
    crewId: uuid("crew_id"),
    fromE164: text("from_e164").notNull(),
    toE164: text("to_e164").notNull(),
    body: text("body").notNull(),
    twilioSid: text("twilio_sid"),
    status: text("status").notNull().default("received"),
    /** Twilio delivery error (e.g. 30032 unverified toll-free, 30034 unregistered 10DLC). */
    errorCode: integer("error_code"),
    errorMessage: text("error_message"),
    /**
     * Unguessable per-message token embedded in the StatusCallback URL. The
     * connector authenticates with an API key and stores no auth token, so
     * Twilio request signatures cannot be verified; this nonce is what proves
     * a delivery callback belongs to a message we actually sent.
     */
    callbackNonce: text("callback_nonce"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("halo_sms_messages_sid_uq").on(t.twilioSid),
    uniqueIndex("halo_sms_messages_nonce_uq").on(t.callbackNonce),
    index("halo_sms_messages_crew_idx").on(t.crewId, t.createdAt),
  ],
);

/** Outbound Vapi EOD call log. */
export const haloVoiceEodCallsTable = pgTable(
  "halo_voice_eod_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    crewId: uuid("crew_id").notNull(),
    phone: text("phone").notNull(),
    vapiCallId: text("vapi_call_id"),
    status: text("status").notNull().default("queued"),
    transcript: text("transcript"),
    summary: text("summary"),
    structured: jsonb("structured").$type<Record<string, unknown>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("halo_voice_eod_calls_vapi_uq").on(t.vapiCallId)],
);

export const haloEstimateDraftsTable = pgTable("halo_estimate_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  propertyId: uuid("property_id"),
  walkId: uuid("walk_id"),
  source: text("source").notNull(),
  headline: text("headline").notNull(),
  lines: jsonb("lines").$type<unknown[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
