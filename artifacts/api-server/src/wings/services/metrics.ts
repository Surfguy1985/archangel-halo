import { and, eq, gte, inArray } from "drizzle-orm";
import {
  db,
  wingAssignmentsTable,
  wingIncidentsTable,
  wingMembersTable,
  wingQualitySubmissionsTable,
  wingQualityReviewsTable,
} from "@workspace/db";
import type { ScoreInput } from "../core/types";

export async function buildScoreInput(
  crewId: string,
  lookbackDays: number,
): Promise<ScoreInput> {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const [assignments, incidents, recruits] = await Promise.all([
    db
      .select()
      .from(wingAssignmentsTable)
      .where(
        and(
          eq(wingAssignmentsTable.crewId, crewId),
          gte(wingAssignmentsTable.createdAt, since),
        ),
      ),
    db
      .select()
      .from(wingIncidentsTable)
      .where(
        and(
          eq(wingIncidentsTable.crewId, crewId),
          gte(wingIncidentsTable.occurredAt, since),
        ),
      ),
    db
      .select()
      .from(wingMembersTable)
      .where(eq(wingMembersTable.sponsorCrewId, crewId)),
  ]);

  const completed = assignments.filter((a) => a.completedAt != null);
  const jobIds = completed.map((a) => a.jobId);
  let reviews: { finalScore: number; safetyScore: number }[] = [];
  if (jobIds.length) {
    const subs = await db
      .select()
      .from(wingQualitySubmissionsTable)
      .where(inArray(wingQualitySubmissionsTable.jobId, jobIds));
    const subIds = subs.map((s) => s.id);
    if (subIds.length) {
      reviews = await db
        .select({
          finalScore: wingQualityReviewsTable.finalScore,
          safetyScore: wingQualityReviewsTable.safetyScore,
        })
        .from(wingQualityReviewsTable)
        .where(inArray(wingQualityReviewsTable.submissionId, subIds));
    }
  }

  const activeQualityRecruitCount = recruits.filter(
    (r) => r.haloScore >= 85,
  ).length;

  return {
    inspectionScores: reviews.map((r) => r.finalScore),
    customerRatings: [],
    callbackCount: incidents.filter(
      (i) => i.type === "CALLBACK" || i.type === "REWORK",
    ).length,
    damageCount: incidents.filter((i) => i.type === "DAMAGE").length,
    completedJobCount: completed.length,
    acceptedAssignmentCount: assignments.length,
    onTimeCount: assignments.filter((a) => a.onTime === true).length,
    onTimeMeasuredCount: assignments.filter((a) => a.onTime != null).length,
    attendedCount: assignments.filter((a) => a.attended === true).length,
    attendanceMeasuredCount: assignments.filter((a) => a.attended != null)
      .length,
    communicationRatings: assignments
      .map((a) => a.communicationRating)
      .filter((v): v is number => v != null),
    professionalismRatings: assignments
      .map((a) => a.professionalismRating)
      .filter((v): v is number => v != null),
    safetyScores: reviews.map((r) => r.safetyScore),
    safetyIncidentCount: incidents.filter((i) => i.type === "SAFETY").length,
    activeQualityRecruitCount,
    completedRescueMissionCount: 0,
  };
}
