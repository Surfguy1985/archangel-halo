import { eq, inArray } from "drizzle-orm";
import { db, invoicesTable, expensesTable, jobsTable } from "@workspace/db";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Recompute a job's grossProfit and marginPct from real money data:
 * revenue = non-draft invoices attached to the job, costs = crew rate +
 * expenses attached to the job. marginPct is a FRACTION (0.25 = 25%).
 * Jobs with no attached invoices keep their existing (possibly manual)
 * margin untouched unless they have costs, in which case grossProfit
 * reflects the loss so far.
 */
export async function recomputeJobFinancials(
  jobIds: string | string[],
): Promise<void> {
  const ids = (Array.isArray(jobIds) ? jobIds : [jobIds]).filter(Boolean);
  if (ids.length === 0) return;
  const [jobs, invoices, expenses] = await Promise.all([
    db.select().from(jobsTable).where(inArray(jobsTable.id, ids)),
    db.select().from(invoicesTable).where(inArray(invoicesTable.jobId, ids)),
    db.select().from(expensesTable).where(inArray(expensesTable.jobId, ids)),
  ]);
  for (const job of jobs) {
    const revenue = invoices
      .filter((i) => i.jobId === job.id && i.status !== "draft")
      .reduce((s, i) => s + i.amount, 0);
    const costs =
      (job.crewRate ?? 0) +
      (job.emergencyBonus ?? 0) +
      expenses
        .filter((e) => e.jobId === job.id && e.approvalStatus === "approved")
        .reduce((s, e) => s + e.amount, 0);
    if (revenue <= 0 && costs <= 0) continue;
    const grossProfit = round2(revenue - costs);
    const marginPct =
      revenue > 0 ? Math.round(((revenue - costs) / revenue) * 10000) / 10000 : null;
    await db
      .update(jobsTable)
      .set({ grossProfit, marginPct })
      .where(eq(jobsTable.id, job.id));
  }
}
