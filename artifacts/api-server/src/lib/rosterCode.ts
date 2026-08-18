/**
 * The one shared crew roster code.
 *
 * A single unguessable string behind /roster/:code. Everyone on the crew scans
 * the same QR, picks their name, and the page hands them their own portal link.
 * The code is a capability, not a password: whoever holds it can claim any name
 * on the list, which is the trade-off the office chose over per-person codes.
 * Rotating it is therefore how you cut off a code that leaked.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, businessSettingsTable } from "@workspace/db";
import { ensureCrewRosterSchema } from "./ensureCrewRosterSchema";

const CODE_BYTES = 12;

export function mintRosterCode(): string {
  return randomBytes(CODE_BYTES).toString("base64url");
}

export function rosterCodeShape(raw: unknown): "ok" | "malformed" {
  if (typeof raw !== "string") return "malformed";
  const c = raw.trim();
  if (c.length < 8 || c.length > 64) return "malformed";
  return /^[A-Za-z0-9_-]+$/.test(c) ? "ok" : "malformed";
}

/** Constant-time so the code can't be recovered a character at a time. */
export function rosterCodeMatches(candidate: string, stored: string): boolean {
  const a = Buffer.from(candidate);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function settingsRow() {
  const [row] = await db.select().from(businessSettingsTable).limit(1);
  return row ?? null;
}

/**
 * The current code, minting one on first use. Concurrent first calls can race;
 * the loser re-reads rather than overwriting, so a code already handed out is
 * never replaced by accident.
 */
export async function getOrCreateRosterCode(): Promise<string> {
  await ensureCrewRosterSchema();
  const row = await settingsRow();
  if (row?.crewRosterCode) return row.crewRosterCode;

  const code = mintRosterCode();
  if (row) {
    // Conditional on still being null: two first-time views racing must not
    // both write, or the second silently retires the QR the first just handed
    // out. The loser's update matches nothing and re-reads the winner's code.
    const [updated] = await db
      .update(businessSettingsTable)
      .set({ crewRosterCode: code })
      .where(and(eq(businessSettingsTable.id, row.id), isNull(businessSettingsTable.crewRosterCode)))
      .returning();
    if (updated?.crewRosterCode) return updated.crewRosterCode;
    const current = await settingsRow();
    return current?.crewRosterCode ?? code;
  }
  const [created] = await db
    .insert(businessSettingsTable)
    .values({ crewRosterCode: code })
    .returning();
  return created?.crewRosterCode ?? code;
}

/** Retires the old code immediately — every QR printed from it stops working. */
export async function rotateRosterCode(): Promise<string> {
  await ensureCrewRosterSchema();
  const code = mintRosterCode();
  const row = await settingsRow();
  if (!row) {
    const [created] = await db
      .insert(businessSettingsTable)
      .values({ crewRosterCode: code })
      .returning();
    return created?.crewRosterCode ?? code;
  }
  const [updated] = await db
    .update(businessSettingsTable)
    .set({ crewRosterCode: code })
    .where(eq(businessSettingsTable.id, row.id))
    .returning();
  return updated?.crewRosterCode ?? code;
}

/** True only for the live code. Never mints — an unknown code must 404. */
export async function isCurrentRosterCode(candidate: string): Promise<boolean> {
  if (rosterCodeShape(candidate) === "malformed") return false;
  await ensureCrewRosterSchema();
  const row = await settingsRow();
  if (!row?.crewRosterCode) return false;
  return rosterCodeMatches(candidate.trim(), row.crewRosterCode);
}
