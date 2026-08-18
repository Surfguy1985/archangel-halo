/**
 * Reading and writing crew-link instruction acknowledgements.
 *
 * Acceptance is ALWAYS attributed through the crew resolved from a link token —
 * crew links are unauthenticated bearer tokens, so a crew id in the request
 * body is never trusted. Rows are append-only: every acceptance is kept, so a
 * supervisor reviewing pay can cite who agreed, when, through which link, and
 * the exact wording shown.
 */

import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, crewLinkAcksTable } from "@workspace/db";
import { crewAckSchemaReady } from "./ensureCrewAckSchema";
import {
  CREW_ACK_TTL_MS,
  CREW_INSTRUCTIONS_VERSION,
  crewInstructionsText,
  normalizeInstructionsLang,
  type CrewLinkKind,
} from "./crewInstructions";

export type CrewAckRow = typeof crewLinkAcksTable.$inferSelect;

export type CrewAckState = {
  acknowledged: boolean;
  agreedAt: string | null;
  agreedBy: string | null;
  linkKind: string | null;
  lang: string | null;
  version: string | null;
  /** True while the acceptance is inside the TTL the check-in gate enforces. */
  current: boolean;
};

export const NO_ACK: CrewAckState = {
  acknowledged: false,
  agreedAt: null,
  agreedBy: null,
  linkKind: null,
  lang: null,
  version: null,
  current: false,
};

type ReqLike = {
  headers: Record<string, unknown>;
  socket?: { remoteAddress?: string };
};

function ipHashOf(req: ReqLike | undefined): string | null {
  if (!req) return null;
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    (typeof forwarded === "string" ? forwarded.split(",")[0]?.trim() : null) ??
    req.socket?.remoteAddress ??
    null;
  if (!ip) return null;
  return createHash("sha256").update(`halo-ip:${ip}`).digest("hex").slice(0, 32);
}

function userAgentOf(req: ReqLike | undefined): string | null {
  const raw = req?.headers["user-agent"];
  return typeof raw === "string" ? raw.slice(0, 300) : null;
}

function toState(row: CrewAckRow | undefined, now: Date): CrewAckState {
  if (!row) return NO_ACK;
  return {
    acknowledged: true,
    agreedAt: row.agreedAt.toISOString(),
    agreedBy: row.agreedBy,
    linkKind: row.linkKind,
    lang: row.lang,
    version: row.version,
    current: now.getTime() - row.agreedAt.getTime() <= CREW_ACK_TTL_MS,
  };
}

export async function latestCrewAck(crewId: string): Promise<CrewAckRow | undefined> {
  await crewAckSchemaReady();
  const [row] = await db
    .select()
    .from(crewLinkAcksTable)
    .where(eq(crewLinkAcksTable.crewId, crewId))
    .orderBy(desc(crewLinkAcksTable.agreedAt))
    .limit(1);
  return row;
}

export async function crewAckState(crewId: string, now = new Date()): Promise<CrewAckState> {
  return toState(await latestCrewAck(crewId), now);
}

/** Latest acknowledgement per crew, for office views that list several crews. */
export async function crewAckStates(
  crewIds: string[],
  now = new Date(),
): Promise<Map<string, CrewAckState>> {
  const out = new Map<string, CrewAckState>();
  const ids = [...new Set(crewIds.filter(Boolean))];
  if (ids.length === 0) return out;
  await crewAckSchemaReady();
  const rows = await db
    .select()
    .from(crewLinkAcksTable)
    .where(inArray(crewLinkAcksTable.crewId, ids))
    .orderBy(desc(crewLinkAcksTable.agreedAt));
  for (const row of rows) {
    if (!out.has(row.crewId)) out.set(row.crewId, toState(row, now));
  }
  for (const id of ids) if (!out.has(id)) out.set(id, NO_ACK);
  return out;
}

/**
 * The gate the check-in endpoints enforce. An acceptance older than the TTL
 * does not count — a crew opening a link on a new day agrees again.
 */
export async function hasCurrentCrewAck(crewId: string, now = new Date()): Promise<boolean> {
  await crewAckSchemaReady();
  const [row] = await db
    .select({ id: crewLinkAcksTable.id })
    .from(crewLinkAcksTable)
    .where(
      and(
        eq(crewLinkAcksTable.crewId, crewId),
        gte(crewLinkAcksTable.agreedAt, new Date(now.getTime() - CREW_ACK_TTL_MS)),
      ),
    )
    .limit(1);
  return !!row;
}

export type RecordCrewAckInput = {
  crewId: string;
  crewName: string;
  linkKind: CrewLinkKind;
  lang?: unknown;
  linkId?: string | null;
  tokenPrefix?: string | null;
  req?: ReqLike;
};

/**
 * The row values for one acceptance. Exported so the join claim can write the
 * acknowledgement inside its own transaction — the crew row and the proof it
 * agreed are created together or not at all.
 */
export function buildCrewAckValues(input: RecordCrewAckInput): typeof crewLinkAcksTable.$inferInsert {
  const lang = normalizeInstructionsLang(input.lang);
  return {
    crewId: input.crewId,
    linkKind: input.linkKind,
    linkId: input.linkId ?? null,
    tokenPrefix: input.tokenPrefix ?? null,
    lang,
    version: CREW_INSTRUCTIONS_VERSION,
    // Snapshot: re-wording the gate later must not rewrite this row.
    termsText: crewInstructionsText(lang),
    agreedBy: input.crewName,
    ipHash: ipHashOf(input.req),
    userAgent: userAgentOf(input.req),
  };
}

export async function recordCrewAck(input: RecordCrewAckInput): Promise<CrewAckRow> {
  await crewAckSchemaReady();
  const [row] = await db.insert(crewLinkAcksTable).values(buildCrewAckValues(input)).returning();
  return row!;
}

/**
 * The 428 body every crew surface understands: "you are not blocked by an
 * error, you are blocked by the instructions page — go back and agree".
 */
export const INSTRUCTIONS_REQUIRED = {
  code: "instructions_required" as const,
  error: "Read and agree to the crew instructions before you check in.",
};
