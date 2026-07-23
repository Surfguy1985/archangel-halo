import { desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  crewsTable,
  jobsTable,
  wingAutomationRunsTable,
  wingIncidentsTable,
  wingMembersTable,
  wingOverridesTable,
  wingQualitySubmissionsTable,
} from "@workspace/db";
import { logger } from "../../lib/logger";
import { createOperatorBrief } from "../ai/operator";
import { getWingConfig } from "./config";
import { ensureWingMembers, refreshStaleScores } from "./member";
import { ensureAssignmentsForCompletedJobs } from "./assignments";
import {
  ensureQualitySubmissions,
  reviewQualitySubmission,
} from "./quality";
import { accrueReadyJobOverrides } from "./overrides";
import { settleDueGuardianReserves } from "./reserve";

let running = false;

export async function runWingsAutomation(options?: {
  withBrief?: boolean;
}): Promise<{ runId: string; status: string; actionsRun: number }> {
  if (running) return { runId: "", status: "ALREADY_RUNNING", actionsRun: 0 };
  running = true;
  const [run] = await db
    .insert(wingAutomationRunsTable)
    .values({ kind: "DAILY_FOUNDING_WINGS", status: "RUNNING" })
    .returning();
  const result: Record<string, unknown> = {};
  let actionsRun = 0;

  try {
    const config = await getWingConfig();

    result.newMembers = await ensureWingMembers();
    actionsRun += result.newMembers as number;

    result.newAssignments = await ensureAssignmentsForCompletedJobs();
    actionsRun += result.newAssignments as number;

    result.newSubmissions = await ensureQualitySubmissions();
    actionsRun += result.newSubmissions as number;

    // AI quality reviews for pending submissions.
    const pending = await db
      .select({ id: wingQualitySubmissionsTable.id })
      .from(wingQualitySubmissionsTable)
      .where(eq(wingQualitySubmissionsTable.reviewStatus, "PENDING"))
      .limit(config.automation.maxQualityReviewsPerRun);
    let reviewed = 0;
    for (const sub of pending) {
      try {
        await reviewQualitySubmission(sub.id);
        reviewed += 1;
        actionsRun += 1;
      } catch (err) {
        logger.warn(`wings: quality review failed for ${sub.id}: ${err}`);
      }
    }
    result.qualityReviews = reviewed;

    result.scoreRefreshes = await refreshStaleScores(
      config.automation.maxMembersPerRun,
      config.score.staleAfterHours,
    );
    actionsRun += result.scoreRefreshes as number;

    result.overrideJobsProcessed = await accrueReadyJobOverrides(
      config.automation.maxJobsPerRun,
    );
    actionsRun += result.overrideJobsProcessed as number;

    const settlements = await settleDueGuardianReserves();
    result.reserveSettlements = settlements;
    actionsRun += settlements.length;

    if (options?.withBrief && config.automation.enableAiOperator) {
      try {
        const [members, pendingCount, openJobs, heldOverrides, incidents] =
          await Promise.all([
            db
              .select({
                crewId: wingMembersTable.crewId,
                haloScore: wingMembersTable.haloScore,
                tier: wingMembersTable.tier,
                founderStatus: wingMembersTable.founderStatus,
                confidence: wingMembersTable.scoreConfidence,
              })
              .from(wingMembersTable)
              .limit(100),
            db
              .select({ id: wingQualitySubmissionsTable.id })
              .from(wingQualitySubmissionsTable)
              .where(
                inArray(wingQualitySubmissionsTable.reviewStatus, [
                  "PENDING",
                  "NEEDS_REVIEW",
                ]),
              ),
            db
              .select({
                jobNo: jobsTable.jobNo,
                category: jobsTable.category,
                boardStatus: jobsTable.boardStatus,
              })
              .from(jobsTable)
              .where(eq(jobsTable.status, "open"))
              .limit(50),
            db
              .select()
              .from(wingOverridesTable)
              .where(eq(wingOverridesTable.status, "HELD")),
            db
              .select()
              .from(wingIncidentsTable)
              .where(isNull(wingIncidentsTable.resolvedAt))
              .limit(30),
          ]);
        const crewNames = await db
          .select({ id: crewsTable.id, name: crewsTable.name })
          .from(crewsTable);
        const nameOf = new Map(crewNames.map((c) => [c.id, c.name]));
        result.operatorBrief = await createOperatorBrief({
          members: members.map((m) => ({
            ...m,
            name: nameOf.get(m.crewId) ?? "Crew",
          })),
          pendingReviews: pendingCount.length,
          openJobs,
          heldReserveTotal: heldOverrides.reduce(
            (sum, o) => sum + o.reserveAmount,
            0,
          ),
          incidents,
        });
        actionsRun += 1;
      } catch (err) {
        logger.warn(`wings: operator brief failed: ${err}`);
        result.operatorBriefError = String(err);
      }
    }

    await db
      .update(wingAutomationRunsTable)
      .set({
        status: "SUCCEEDED",
        completedAt: new Date(),
        actionsRun,
        result: result as object,
      })
      .where(eq(wingAutomationRunsTable.id, run.id));
    return { runId: run.id, status: "SUCCEEDED", actionsRun };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown automation error";
    await db
      .update(wingAutomationRunsTable)
      .set({
        status: actionsRun > 0 ? "PARTIAL" : "FAILED",
        completedAt: new Date(),
        actionsRun,
        result: result as object,
        error: message,
      })
      .where(eq(wingAutomationRunsTable.id, run.id));
    return { runId: run.id, status: "FAILED", actionsRun };
  } finally {
    running = false;
  }
}

export async function recentAutomationRuns(limit = 20) {
  return db
    .select()
    .from(wingAutomationRunsTable)
    .orderBy(desc(wingAutomationRunsTable.startedAt))
    .limit(limit);
}
