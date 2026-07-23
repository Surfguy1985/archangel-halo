import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  jobsTable,
  invoicesTable,
  wingAssignmentsTable,
  wingMembersTable,
  wingOverridesTable,
  wingReserveAccountsTable,
  wingReserveTxnsTable,
  wingQualitySubmissionsTable,
} from "@workspace/db";
import { calculateOverride } from "../core/override-engine";
import { decimalToCents, centsToDecimal, monthsBetween } from "../core/math";
import { getWingConfig } from "./config";
import { logWingAudit } from "./audit";

/** A job's revenue counts as collected when it has invoices, none unpaid. */
async function collectedAtForJob(jobId: string): Promise<Date | null> {
  const invoices = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.jobId, jobId));
  const real = invoices.filter((i) => i.status !== "draft");
  if (!real.length) return null;
  if (real.some((i) => i.status !== "paid")) return null;
  const paidDates = real
    .map((i) => i.paidAt)
    .filter((d): d is Date => d != null);
  if (!paidDates.length) return null;
  return new Date(Math.max(...paidDates.map((d) => d.getTime())));
}

export async function createJobOverrideAccruals(jobId: string) {
  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) throw new Error("Job not found.");
  if (job.grossProfit == null) {
    throw new Error("Overrides require computed gross profit.");
  }
  const collectedAt = await collectedAtForJob(jobId);
  if (!collectedAt) {
    throw new Error("Overrides require fully collected payment.");
  }
  const [submission] = await db
    .select()
    .from(wingQualitySubmissionsTable)
    .where(eq(wingQualitySubmissionsTable.jobId, jobId));
  if (!submission || submission.reviewStatus !== "PASS") {
    throw new Error("Overrides require a passed quality review.");
  }

  const config = await getWingConfig();
  const grossProfitCents = decimalToCents(job.grossProfit);
  if (grossProfitCents < config.overrides.minimumGrossProfitCents) return [];

  const assignments = await db
    .select()
    .from(wingAssignmentsTable)
    .where(
      and(
        eq(wingAssignmentsTable.jobId, jobId),
        isNotNull(wingAssignmentsTable.completedAt),
      ),
    );
  if (!assignments.length) return [];
  const totalWeight = assignments.reduce(
    (sum, a) => sum + Math.max(0, a.profitShareWeight),
    0,
  );
  if (totalWeight <= 0) return [];

  const members = await db
    .select()
    .from(wingMembersTable)
    .where(
      inArray(
        wingMembersTable.crewId,
        assignments.map((a) => a.crewId),
      ),
    );

  const created: (typeof wingOverridesTable.$inferSelect)[] = [];
  for (const assignment of assignments) {
    const recruit = members.find((m) => m.crewId === assignment.crewId);
    if (!recruit?.sponsorCrewId) continue;
    // Approval gate: both recruit and sponsor must be approved members.
    if (recruit.membershipStatus !== "ACTIVE") continue;
    const sponsorMember = await db
      .select({ membershipStatus: wingMembersTable.membershipStatus })
      .from(wingMembersTable)
      .where(eq(wingMembersTable.crewId, recruit.sponsorCrewId));
    if (sponsorMember[0]?.membershipStatus !== "ACTIVE") continue;
    const sponsorCrewId = recruit.sponsorCrewId;

    const allocatedCents = Math.round(
      grossProfitCents * (Math.max(0, assignment.profitShareWeight) / totalWeight),
    );
    const relationshipMonths = monthsBetween(
      recruit.sponsorSince ?? recruit.createdAt,
      collectedAt,
    );
    const override = calculateOverride(
      {
        allocatedGrossProfitCents: allocatedCents,
        sponsorRelationshipMonths: relationshipMonths,
        recruitHaloScore: recruit.haloScore,
        reservePercent: config.overrides.reservePercent,
      },
      config,
    );
    if (override.grossOverrideCents <= 0) continue;

    const qualityWindowEndsAt = new Date(
      collectedAt.getTime() +
        config.quality.defaultQualityWindowDays * 24 * 60 * 60 * 1000,
    );

    const row = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(wingOverridesTable)
        .values({
          jobId,
          sponsorCrewId,
          recruitCrewId: recruit.crewId,
          allocatedGrossProfit: allocatedCents / 100,
          baseRate: override.baseRate,
          qualityMultiplier: override.qualityMultiplier,
          grossOverride: override.grossOverrideCents / 100,
          immediateAmount: override.immediateAmountCents / 100,
          reserveAmount: override.reserveAmountCents / 100,
          status: "HELD",
          immediateStatus: "READY",
          qualityWindowEndsAt,
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) return null; // Already accrued: idempotent retry.
      const record = inserted[0];

      const [account] = await tx
        .insert(wingReserveAccountsTable)
        .values({
          crewId: sponsorCrewId,
          heldBalance: override.reserveAmountCents / 100,
        })
        .onConflictDoUpdate({
          target: wingReserveAccountsTable.crewId,
          set: {
            heldBalance: sql`${wingReserveAccountsTable.heldBalance} + ${override.reserveAmountCents / 100}`,
          },
        })
        .returning();

      await tx.insert(wingReserveTxnsTable).values({
        accountId: account.id,
        crewId: sponsorCrewId,
        overrideId: record.id,
        type: "HOLD",
        amount: override.reserveAmountCents / 100,
        balanceAfter: account.heldBalance,
        note: `Guardian Reserve hold for job ${job.jobNo}.`,
      });

      return record;
    });

    if (row) {
      await logWingAudit({
        action: "OVERRIDE_ACCRUED",
        entityType: "wing_override",
        entityId: row.id,
        after: {
          baseRate: override.baseRate,
          qualityMultiplier: override.qualityMultiplier,
          grossOverrideCents: override.grossOverrideCents,
          immediateAmountCents: override.immediateAmountCents,
          reserveAmountCents: override.reserveAmountCents,
        },
        reason: `Completed, collected, quality-approved recruit work on job ${job.jobNo}. Payout-ready entry created; money moves only through HALO's normal crew payment flow.`,
      });
      created.push(row);
    }
  }
  return created;
}

/** Sweep: accrue overrides for any eligible jobs that don't have them yet. */
export async function accrueReadyJobOverrides(maxJobs: number): Promise<number> {
  const passed = await db
    .select({ jobId: wingQualitySubmissionsTable.jobId })
    .from(wingQualitySubmissionsTable)
    .where(eq(wingQualitySubmissionsTable.reviewStatus, "PASS"));
  let processed = 0;
  for (const { jobId } of passed.slice(0, maxJobs)) {
    try {
      const created = await createJobOverrideAccruals(jobId);
      if (created.length) processed += 1;
    } catch {
      // Not collected yet or no sponsored recruits; retried next run.
    }
  }
  return processed;
}
