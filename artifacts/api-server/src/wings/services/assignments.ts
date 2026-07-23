import { and, inArray, isNotNull } from "drizzle-orm";
import { db, jobsTable, wingAssignmentsTable } from "@workspace/db";

function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Idempotent sweep: every completed job with a crew leader gets exactly one
 * wing assignment. onTime compares the local completion date against the
 * scheduled date (or flex due-by). Attendance is true because HALO only marks
 * jobs complete after crews perform the work.
 */
export async function ensureAssignmentsForCompletedJobs(): Promise<number> {
  const jobs = await db
    .select()
    .from(jobsTable)
    .where(
      and(
        inArray(jobsTable.status, ["complete", "closed"]),
        isNotNull(jobsTable.completedAt),
        isNotNull(jobsTable.crewLeaderId),
      ),
    );
  if (!jobs.length) return 0;

  const existing = await db
    .select({ jobId: wingAssignmentsTable.jobId })
    .from(wingAssignmentsTable)
    .where(
      inArray(
        wingAssignmentsTable.jobId,
        jobs.map((j) => j.id),
      ),
    );
  const have = new Set(existing.map((e) => e.jobId));

  let created = 0;
  for (const job of jobs) {
    if (have.has(job.id) || !job.crewLeaderId || !job.completedAt) continue;
    const dueDate = job.flexDueBy ?? job.scheduledOn ?? null;
    const onTime = dueDate ? localYmd(job.completedAt) <= dueDate : null;
    await db
      .insert(wingAssignmentsTable)
      .values({
        jobId: job.id,
        crewId: job.crewLeaderId,
        onTime,
        attended: true,
        completedAt: job.completedAt,
      })
      .onConflictDoNothing();
    created += 1;
  }
  return created;
}
