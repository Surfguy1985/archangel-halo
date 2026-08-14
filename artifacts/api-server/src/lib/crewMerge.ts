/**
 * Crew de-duplication: near-duplicate report + safe merge.
 *
 * Background: the Base44/Work App sync matches crews by exact name, so a
 * spelling variant ("Bryce Beck" vs "Bryce Back") creates a second row. Jobs
 * then point at the phone-less twin and SMS pings silently go nowhere.
 *
 * mergeCrews() repoints every crew-referencing table at the surviving row,
 * fills the survivor's blank contact fields from the losing row, remaps the
 * Base44 sync map (halo_id is TEXT — cast explicitly), records the losing
 * name as an alias so the sync never re-creates it, and deletes the loser —
 * all in one transaction.
 */

import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { db, crewsTable, crewAliasesTable } from "@workspace/db";
import { logger } from "./logger";

/** Lowercase, trim, collapse whitespace — the canonical alias/name key. */
export function normalizeCrewName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n];
}

export interface DuplicateCrewRow {
  id: string;
  name: string;
  phone: string | null;
  active: boolean | null;
  jobCount: number;
  base44Id: string | null;
}

export interface DuplicatePair {
  reason: string;
  a: DuplicateCrewRow;
  b: DuplicateCrewRow;
  /** Suggested surviving row: prefers the one with a phone, then more jobs. */
  suggestedKeepId: string;
}

/**
 * Two names are near-duplicates when their normalized forms are equal,
 * within edit distance 2, or one is a strict first-token extension of the
 * other ("Jose" vs "Jose Ramirez").
 */
export function namesLookAlike(a: string, b: string): string | null {
  const na = normalizeCrewName(a);
  const nb = normalizeCrewName(b);
  if (!na || !nb) return null;
  if (na === nb) return "same name (normalized)";
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (long.startsWith(`${short} `)) return "first-name extension";
  const dist = levenshtein(na, nb);
  if (dist <= 2 && Math.min(na.length, nb.length) >= 4) {
    return `spelling variant (edit distance ${dist})`;
  }
  return null;
}

export async function listCrewsWithCounts(): Promise<DuplicateCrewRow[]> {
  const rows = await db.execute(sql`
    SELECT c.id::text AS id, c.name, c.phone, c.active,
      (SELECT count(*)::int FROM jobs j WHERE j.crew_leader_id = c.id) AS job_count,
      (SELECT m.base44_id FROM base44_sync_map m
        WHERE m.resource = 'crews' AND m.halo_id = c.id::text LIMIT 1) AS base44_id
    FROM crews c
    ORDER BY c.name
  `);
  return (rows.rows as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone ?? null,
    active: r.active ?? null,
    jobCount: Number(r.job_count ?? 0),
    base44Id: r.base44_id ?? null,
  }));
}

export async function findDuplicateCrews(): Promise<{
  pairs: DuplicatePair[];
  missingPhone: DuplicateCrewRow[];
}> {
  const crews = await listCrewsWithCounts();
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < crews.length; i++) {
    for (let j = i + 1; j < crews.length; j++) {
      const reason = namesLookAlike(crews[i].name, crews[j].name);
      if (!reason) continue;
      const a = crews[i];
      const b = crews[j];
      const keep =
        (a.phone ? 1 : 0) !== (b.phone ? 1 : 0)
          ? a.phone
            ? a
            : b
          : a.jobCount >= b.jobCount
            ? a
            : b;
      pairs.push({ reason, a, b, suggestedKeepId: keep.id });
    }
  }
  const missingPhone = crews.filter((c) => c.jobCount > 0 && !c.phone);
  return { pairs, missingPhone };
}

/** Fields copied onto the survivor when the survivor's value is NULL/blank. */
const FILL_COLUMNS = [
  "phone",
  "email",
  "trade",
  "role",
  "hire_date",
  "payment_terms",
  "preferred_payment_method",
  "payment_details",
  "selfie_path",
  "push_token",
  "leader_id",
  "services",
] as const;

/**
 * Tables whose crew-reference columns are simply repointed loser → keeper.
 * Kept explicit so a typo can't touch an unrelated column.
 */
const SIMPLE_REPOINTS: Array<[table: string, column: string]> = [
  ["calendar_events", "crew_id"],
  ["crew_checkins", "crew_id"],
  ["crew_checkin_links", "crew_id"],
  ["crew_documents", "crew_id"],
  ["crew_invoices", "crew_id"],
  ["crew_messages", "crew_id"],
  ["crew_packets", "crew_id"],
  ["crew_payments", "crew_id"],
  ["crew_photos", "crew_id"],
  ["crew_track_points", "crew_id"],
  ["emergency_ping_targets", "crew_id"],
  ["emergency_pings", "filled_by_crew_id"],
  ["halo_sms_messages", "crew_id"],
  ["halo_voice_eod_calls", "crew_id"],
  ["job_line_items", "assigned_crew_id"],
  ["job_line_items", "completed_by_crew_id"],
  ["jobs", "crew_leader_id"],
  ["photo_shares", "crew_id"],
  ["schedules", "crew_leader_id"],
  ["crews", "leader_id"],
  ["wing_incidents", "crew_id"],
  ["wing_quality_submissions", "crew_id"],
  ["wing_score_snapshots", "crew_id"],
  ["wing_reserve_txns", "crew_id"],
  ["wing_overrides", "sponsor_crew_id"],
  ["wing_overrides", "recruit_crew_id"],
  ["wing_members", "sponsor_crew_id"],
];

/**
 * Tables with a UNIQUE index involving the crew column: rows on the losing
 * crew that would collide with an existing keeper row are deleted first,
 * then the remainder are repointed. [table, crewColumn, otherUniqueCols[]]
 */
const UNIQUE_REPOINTS: Array<[string, string, string[]]> = [
  ["job_broadcasts", "crew_id", ["job_id"]],
  ["job_agreements", "crew_id", ["job_id"]],
  ["job_checklists", "crew_id", ["job_id", "checklist_type"]],
  ["cleaning_checklists", "crew_id", ["job_id"]],
  ["crew_route_plans", "crew_id", ["day"]],
  ["crew_dispatch_assignments", "member_id", ["day", "job_id"]],
  ["wing_assignments", "crew_id", ["job_id"]],
  ["wing_members", "crew_id", []],
  ["wing_reserve_accounts", "crew_id", []],
  ["crew_bank_accounts", "crew_id", []],
  ["crew_payouts", "crew_id", ["job_id"]],
  ["crew_pay_holds", "crew_id", ["job_id"]],
];

export interface MergeResult {
  keptId: string;
  mergedId: string;
  keptName: string;
  mergedName: string;
  phone: string | null;
  repointed: Record<string, number>;
}

export async function mergeCrews(keepId: string, mergeId: string): Promise<MergeResult> {
  if (keepId === mergeId) throw new Error("keepId and mergeId must differ");
  return db.transaction(async (tx) => {
    const [keep] = await tx.select().from(crewsTable).where(eq(crewsTable.id, keepId));
    const [lose] = await tx.select().from(crewsTable).where(eq(crewsTable.id, mergeId));
    if (!keep) throw new Error("keep crew not found");
    if (!lose) throw new Error("merge crew not found");

    const repointed: Record<string, number> = {};

    for (const [table, column] of SIMPLE_REPOINTS) {
      const res = await tx.execute(sql`
        UPDATE ${sql.identifier(table)}
        SET ${sql.identifier(column)} = ${keepId}::uuid
        WHERE ${sql.identifier(column)} = ${mergeId}::uuid
      `);
      const n = Number((res as any).rowCount ?? 0);
      if (n) repointed[`${table}.${column}`] = n;
    }

    for (const [table, column, others] of UNIQUE_REPOINTS) {
      // Drop losing rows that would collide with an existing keeper row.
      const collisionWhere = others.length
        ? sql.join(
            others.map(
              (c) => sql`k.${sql.identifier(c)} = t.${sql.identifier(c)}`,
            ),
            sql` AND `,
          )
        : sql`TRUE`;
      await tx.execute(sql`
        DELETE FROM ${sql.identifier(table)} t
        WHERE t.${sql.identifier(column)} = ${mergeId}::uuid
          AND EXISTS (
            SELECT 1 FROM ${sql.identifier(table)} k
            WHERE k.${sql.identifier(column)} = ${keepId}::uuid AND ${collisionWhere}
          )
      `);
      const res = await tx.execute(sql`
        UPDATE ${sql.identifier(table)}
        SET ${sql.identifier(column)} = ${keepId}::uuid
        WHERE ${sql.identifier(column)} = ${mergeId}::uuid
      `);
      const n = Number((res as any).rowCount ?? 0);
      if (n) repointed[`${table}.${column}`] = n;
    }

    // Fill blank contact/profile fields on the survivor from the losing row.
    const fills = sql.join(
      FILL_COLUMNS.map(
        (c) =>
          sql`${sql.identifier(c)} = COALESCE(k.${sql.identifier(c)}, l.${sql.identifier(c)})`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE crews k SET ${fills}
      FROM crews l
      WHERE k.id = ${keepId}::uuid AND l.id = ${mergeId}::uuid
    `);

    // Repoint the Base44 sync map so future syncs update the survivor.
    // NOTE: base44_sync_map.halo_id is TEXT — compare/assign as text.
    await tx.execute(sql`
      UPDATE base44_sync_map
      SET halo_id = ${keepId}::text
      WHERE resource = 'crews' AND halo_id = ${mergeId}::text
    `);

    // Remember the losing spelling so the sync never re-creates it.
    const aliases = new Set([normalizeCrewName(lose.name)]);
    for (const alias of aliases) {
      if (!alias || alias === normalizeCrewName(keep.name)) continue;
      await tx
        .insert(crewAliasesTable)
        .values({ id: randomUUID(), crewId: keepId, alias })
        .onConflictDoNothing();
    }
    // Any aliases that pointed at the losing row follow the survivor.
    await tx
      .update(crewAliasesTable)
      .set({ crewId: keepId })
      .where(eq(crewAliasesTable.crewId, mergeId));

    await tx.delete(crewsTable).where(eq(crewsTable.id, mergeId));

    const [after] = await tx
      .select({ phone: crewsTable.phone })
      .from(crewsTable)
      .where(eq(crewsTable.id, keepId));

    logger.info(
      { keepId, mergeId, keptName: keep.name, mergedName: lose.name, repointed },
      "crew merge complete",
    );
    return {
      keptId: keepId,
      mergedId: mergeId,
      keptName: keep.name,
      mergedName: lose.name,
      phone: after?.phone ?? null,
      repointed,
    };
  });
}

/** Resolve a crew id by exact-normalized name or recorded alias. */
export async function resolveCrewByNameOrAlias(name: string): Promise<string | null> {
  const norm = normalizeCrewName(name);
  if (!norm) return null;
  const byName = await db.execute(sql`
    SELECT id::text AS id FROM crews
    WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = ${norm}
    LIMIT 1
  `);
  if ((byName.rows as any[])[0]?.id) return (byName.rows as any[])[0].id;
  const byAlias = await db
    .select({ crewId: crewAliasesTable.crewId })
    .from(crewAliasesTable)
    .where(eq(crewAliasesTable.alias, norm))
    .limit(1);
  return byAlias[0]?.crewId ?? null;
}
