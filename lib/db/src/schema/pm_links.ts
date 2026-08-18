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
  /** Legacy plaintext or `h:<token_hash>` placeholder — never the live bearer for new rows. */
  token: text("token").unique().notNull(),
  tokenHash: text("token_hash").unique(),
  tokenPrefix: text("token_prefix"),
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
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
});

export const pmLinkAuditTable = pgTable("pm_link_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull(),
  action: text("action").notNull(), // created | accessed | chat | revoked | denied
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  ipHash: text("ip_hash"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
});

// ─── Crew Check-in Links ──────────────────────────────────────────────────────

export const crewCheckinLinksTable = pgTable("crew_checkin_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Legacy plaintext or `h:<token_hash>` placeholder — never the live bearer for new rows. */
  token: text("token").unique().notNull(),
  tokenHash: text("token_hash").unique(),
  tokenPrefix: text("token_prefix"),
  crewId: uuid("crew_id").notNull(),
  /** e.g. "Marcus — check-in link" */
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }),
});

// ─── Crew Join Links ──────────────────────────────────────────────────────────

/**
 * A foreman-minted, single-use QR invite. The scanner types their own name and
 * becomes a crew member reporting to `foremanCrewId`, with their own paycard.
 * Single-use: `claimedAt` is set by a guarded UPDATE so two people scanning the
 * same printed code can never both claim it.
 */
export const crewJoinLinksTable = pgTable("crew_join_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tokenHash: text("token_hash").unique().notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  /** The foreman who minted it — the new member's leaderId. */
  foremanCrewId: uuid("foreman_crew_id").notNull(),
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedCrewId: uuid("claimed_crew_id"),
  claimedName: text("claimed_name"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const crewCheckinAuditTable = pgTable("crew_checkin_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  linkId: uuid("link_id").notNull(),
  action: text("action").notNull(), // created | accessed | checkin | checkout | location | revoked | denied
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  ipHash: text("ip_hash"),
  detail: jsonb("detail").$type<Record<string, unknown>>(),
});
