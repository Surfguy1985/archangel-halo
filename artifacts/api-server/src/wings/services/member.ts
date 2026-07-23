import { eq, inArray, notInArray, and } from "drizzle-orm";
import {
  db,
  crewsTable,
  wingMembersTable,
  wingScoreSnapshotsTable,
} from "@workspace/db";
import { calculateHaloScore } from "../core/score-engine";
import { getWingConfig } from "./config";
import { buildScoreInput } from "./metrics";
import { logWingAudit } from "./audit";

/** Create wing member rows for any active crews that lack one. */
export async function ensureWingMembers(): Promise<number> {
  const crews = await db
    .select({ id: crewsTable.id, trade: crewsTable.trade })
    .from(crewsTable)
    .where(eq(crewsTable.active, true));
  if (!crews.length) return 0;
  const existing = await db
    .select({ crewId: wingMembersTable.crewId })
    .from(wingMembersTable);
  const have = new Set(existing.map((m) => m.crewId));
  const missing = crews.filter((c) => !have.has(c.id));
  for (const crew of missing) {
    await db
      .insert(wingMembersTable)
      .values({
        crewId: crew.id,
        tradeSkills: crew.trade ? [crew.trade] : [],
        certifications: [],
      })
      .onConflictDoNothing();
  }
  return missing.length;
}

export async function recalculateCrewScore(
  crewId: string,
  actorType = "SYSTEM",
) {
  const [member] = await db
    .select()
    .from(wingMembersTable)
    .where(eq(wingMembersTable.crewId, crewId));
  if (!member) throw new Error(`No wing member for crew ${crewId}`);
  const config = await getWingConfig();
  const input = await buildScoreInput(crewId, config.score.lookbackDays);
  const result = calculateHaloScore(input, config);

  await db.transaction(async (tx) => {
    await tx
      .update(wingMembersTable)
      .set({
        haloScore: result.totalScore,
        tier: result.tier,
        scoreConfidence: result.confidence,
        scoreUpdatedAt: new Date(),
      })
      .where(eq(wingMembersTable.crewId, crewId));
    await tx.insert(wingScoreSnapshotsTable).values({
      crewId,
      totalScore: result.totalScore,
      tier: result.tier,
      confidence: result.confidence,
      points: result.points,
      sampleSize: result.sampleSize,
      reasons: result.reasons,
    });
  });

  await logWingAudit({
    actorType,
    action: "HALO_SCORE_RECALCULATED",
    entityType: "crew",
    entityId: crewId,
    before: {
      score: member.haloScore,
      tier: member.tier,
      confidence: member.scoreConfidence,
    },
    after: {
      score: result.totalScore,
      tier: result.tier,
      confidence: result.confidence,
      points: result.points,
    },
    reason: result.reasons.join(" ") || "Scheduled score refresh.",
  });

  return result;
}

export async function refreshStaleScores(
  maxMembers: number,
  staleAfterHours: number,
): Promise<number> {
  const staleBefore = new Date(Date.now() - staleAfterHours * 60 * 60 * 1000);
  const members = await db.select().from(wingMembersTable);
  const activeCrews = await db
    .select({ id: crewsTable.id })
    .from(crewsTable)
    .where(eq(crewsTable.active, true));
  const activeSet = new Set(activeCrews.map((c) => c.id));
  const stale = members
    .filter(
      (m) =>
        activeSet.has(m.crewId) &&
        (!m.scoreUpdatedAt || m.scoreUpdatedAt < staleBefore),
    )
    .slice(0, maxMembers);
  let count = 0;
  for (const m of stale) {
    try {
      await recalculateCrewScore(m.crewId);
      count += 1;
    } catch {
      // Skip crews that fail; next run retries.
    }
  }
  return count;
}
