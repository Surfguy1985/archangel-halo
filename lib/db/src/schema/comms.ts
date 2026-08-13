import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

/** Twilio SMS log. Not a worker inbox UI. */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("halo_sms_messages_sid_uq").on(t.twilioSid),
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
