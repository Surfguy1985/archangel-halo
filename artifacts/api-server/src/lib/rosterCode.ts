/**
 * The one shared crew roster code.
 *
 * A single unguessable string behind /roster/:code. Everyone on the crew scans
 * the same QR, picks their name, and the page hands them their own portal link.
 * The code is a capability, not a password: whoever holds it can claim any name
 * on the list, which is the trade-off the office chose over per-person codes.
 *
 * The code is meant to outlive everything around it — it is printed, laminated
 * and hung in a shop, and a crew standing in a stairwell has no way to get a new
 * one. So two rules hold here:
 *
 *   1. Every code ever issued is recorded in crew_roster_codes and stays valid
 *      until somebody revokes it on purpose. business_settings holds the code
 *      the office hands out today; this table decides what still opens the door.
 *   2. Nothing mints a replacement behind the office's back. If the settings
 *      value goes missing (a restore, a wipe, a bad migration), the newest
 *      un-revoked code is adopted back rather than a fresh one generated —
 *      otherwise the printed QR dies for a reason no one can see.
 *
 * Revoking is therefore a deliberate act, and the only thing that can ever make
 * a scan read "this code isn't active".
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
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

/** Add a code to the acceptance list. Idempotent, and never un-revokes. */
async function rememberCode(code: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO crew_roster_codes (code) VALUES (${code})
    ON CONFLICT (code) DO NOTHING
  `);
}

/** Codes that still open the roster, newest first. */
async function acceptedCodes(): Promise<string[]> {
  const rows = await db.execute<{ code: string }>(sql`
    SELECT code FROM crew_roster_codes
    WHERE revoked_at IS NULL
    ORDER BY created_at DESC
  `);
  const list = (rows as unknown as { rows?: { code: string }[] }).rows ?? (rows as unknown as { code: string }[]);
  return Array.isArray(list) ? list.map((r) => r.code).filter((c) => typeof c === "string") : [];
}

async function storeCurrent(code: string, row: { id: string } | null): Promise<string> {
  await rememberCode(code);
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

/**
 * The code the office hands out, minting one only the very first time.
 *
 * Concurrent first calls can race; the loser re-reads rather than overwriting,
 * so a code already handed out is never replaced by accident. If the settings
 * value is missing but codes have been issued before, the newest one is adopted
 * back — a QR in someone's truck outranks a clean slate.
 */
export async function getOrCreateRosterCode(): Promise<string> {
  await ensureCrewRosterSchema();
  const row = await settingsRow();
  if (row?.crewRosterCode) {
    // Cheap self-heal: keeps the acceptance list in step with a value that was
    // written before this table existed, or restored underneath us.
    await rememberCode(row.crewRosterCode);
    return row.crewRosterCode;
  }

  const [previous] = await acceptedCodes();
  if (previous) return storeCurrent(previous, row);

  const code = mintRosterCode();
  await rememberCode(code);
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

/**
 * Start handing out a new code.
 *
 * The old one keeps working by default — rotating is usually "print a fresh
 * card", not "strand everyone who scanned the old one". Pass revokePrevious
 * when the point is to cut off a code that leaked; that is the only path that
 * kills a printed QR.
 */
export async function rotateRosterCode(
  { revokePrevious = false }: { revokePrevious?: boolean } = {},
): Promise<string> {
  await ensureCrewRosterSchema();
  const row = await settingsRow();
  const old = row?.crewRosterCode ?? null;
  const code = mintRosterCode();
  const stored = await storeCurrent(code, row);
  if (revokePrevious && old && old !== stored) await revokeRosterCode(old);
  return stored;
}

/** Kills one code for good. The live code can't be revoked out from under itself. */
export async function revokeRosterCode(code: string): Promise<boolean> {
  await ensureCrewRosterSchema();
  const row = await settingsRow();
  if (row?.crewRosterCode && rosterCodeMatches(code, row.crewRosterCode)) return false;
  await db.execute(sql`
    UPDATE crew_roster_codes SET revoked_at = now()
    WHERE code = ${code} AND revoked_at IS NULL
  `);
  return true;
}

/**
 * True for the live code and for any earlier code that was never revoked.
 * Never mints — an unknown code must 404.
 */
export async function isActiveRosterCode(candidate: string): Promise<boolean> {
  if (rosterCodeShape(candidate) === "malformed") return false;
  await ensureCrewRosterSchema();
  const trimmed = candidate.trim();

  const row = await settingsRow();
  if (row?.crewRosterCode && rosterCodeMatches(trimmed, row.crewRosterCode)) return true;

  for (const code of await acceptedCodes()) {
    if (rosterCodeMatches(trimmed, code)) return true;
  }
  return false;
}

/** @deprecated name kept for older call sites; accepts every un-revoked code. */
export const isCurrentRosterCode = isActiveRosterCode;
