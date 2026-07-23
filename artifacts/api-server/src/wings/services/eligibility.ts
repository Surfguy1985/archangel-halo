import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  crewsTable,
  jobsTable,
  wingMembersTable,
  wingIncidentsTable,
  wingAssignmentsTable,
} from "@workspace/db";
import { evaluateEligibility } from "../core/eligibility-engine";
import type { CertificationRecord, EligibilityResult } from "../core/types";
import { getWingConfig } from "./config";

export type CandidateResult = EligibilityResult & {
  crewId: string;
  crewName: string;
  haloScore: number;
  tier: string;
  founderStatus: string;
};

/**
 * Live First Flight evaluation of all active crews for one job.
 * Deterministic engine output; nothing is persisted (windows are re-evaluated
 * whenever the job board or dashboard asks).
 */
export async function candidatesForJob(jobId: string): Promise<CandidateResult[]> {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) throw new Error("Job not found.");
  const config = await getWingConfig();

  const crews = await db
    .select()
    .from(crewsTable)
    .where(eq(crewsTable.active, true));
  if (!crews.length) return [];
  const crewIds = crews.map((c) => c.id);
  const [members, openIncidents, activeAssignments] = await Promise.all([
    db
      .select()
      .from(wingMembersTable)
      .where(inArray(wingMembersTable.crewId, crewIds)),
    db
      .select()
      .from(wingIncidentsTable)
      .where(isNull(wingIncidentsTable.resolvedAt)),
    db
      .select({
        crewId: jobsTable.crewLeaderId,
        id: jobsTable.id,
      })
      .from(jobsTable)
      .where(eq(jobsTable.status, "open")),
  ]);

  const requiredScore =
    job.grossProfit != null && job.grossProfit >= 1500 ? 85 : 0;
  const priority =
    job.grossProfit != null && job.grossProfit >= 1500
      ? ("PREMIUM" as const)
      : ("STANDARD" as const);

  const results: CandidateResult[] = [];
  for (const crew of crews) {
    const member = members.find((m) => m.crewId === crew.id);
    if (!member) continue;
    const activeJobCount = activeAssignments.filter(
      (a) => a.crewId === crew.id,
    ).length;
    const unresolvedCritical = openIncidents.filter(
      (i) =>
        i.crewId === crew.id &&
        i.severity >= config.eligibility.criticalIncidentSeverity &&
        ["SAFETY", "DAMAGE", "CUSTOMER_COMPLAINT"].includes(i.type),
    ).length;

    const result = evaluateEligibility(
      {
        status: "ACTIVE",
        founderStatus: member.founderStatus as never,
        haloScore: member.haloScore,
        tier: member.tier as never,
        tradeSkills: (member.tradeSkills as string[] | null) ?? [],
        certifications:
          (member.certifications as CertificationRecord[] | null) ?? [],
        activeJobCount,
        maxConcurrentJobs: member.maxConcurrentJobs,
        isAvailable: member.isAvailable,
        unresolvedCriticalIncidentCount: unresolvedCritical,
        draftTokens: member.draftTokens,
      },
      {
        requiredHaloScore: requiredScore,
        requiredSkills: job.category ? [] : [],
        requiredCertifications: [],
        priority,
      },
    );
    results.push({
      ...result,
      crewId: crew.id,
      crewName: crew.name,
      haloScore: member.haloScore,
      tier: member.tier,
      founderStatus: member.founderStatus,
    });
  }

  return results.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.rankScore - a.rankScore;
  });
}
