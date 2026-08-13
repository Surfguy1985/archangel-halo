/**
 * PM Live Links — secure, short-lived, property-scoped links the office
 * can text to a property manager. Replaced by token-validated live views.
 *
 * Crew Check-in Links — permanent (revocable) tokens texted to each crew
 * member. Opening the link in a mobile browser shows one button: Check In
 * or Check Out. No app, no login, no navigation.
 */
import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── PM Live Links ────────────────────────────────────────────────────────────

export const pmLiveLinksTable = pgTable("pm_live_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").unique().notNull(),
  propertyId: uuid("property_id").notNull(),
  /** { map: boolean, kanban: boolean, money: boolean } */
  permissions: jsonb("permissions")
    .$type<{ map: boolean; kanban: boolean; money: boolean }>()
    .default({ map: true, kanban: true, money: false })
    .notNull(),
  /** Human note: "sent to Dana · Aug 13" */
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

// ─── Crew Check-in Links ──────────────────────────────────────────────────────

export const crewCheckinLinksTable = pgTable("crew_checkin_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  token: text("token").unique().notNull(),
  crewId: uuid("crew_id").notNull(),
  /** e.g. "Marcus — check-in link" */
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
