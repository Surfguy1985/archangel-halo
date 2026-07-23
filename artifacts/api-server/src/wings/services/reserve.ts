import { and, eq, lte } from "drizzle-orm";
import {
  db,
  jobsTable,
  wingIncidentsTable,
  wingOverridesTable,
  wingReserveAccountsTable,
  wingReserveTxnsTable,
} from "@workspace/db";
import { settleGuardianReserve } from "../core/guardian-reserve";
import { decimalToCents } from "../core/math";
import { getWingConfig } from "./config";
import { logWingAudit } from "./audit";

const BLOCKING_TYPES = ["CALLBACK", "REWORK", "DAMAGE", "CUSTOMER_COMPLAINT"];

export async function settleDueGuardianReserves(now = new Date()) {
  const config = await getWingConfig();
  const due = await db
    .select()
    .from(wingOverridesTable)
    .where(
      and(
        eq(wingOverridesTable.status, "HELD"),
        lte(wingOverridesTable.qualityWindowEndsAt, now),
      ),
    );

  const results: Array<{ overrideId: string; status: string }> = [];
  for (const accrual of due) {
    const incidents = await db
      .select()
      .from(wingIncidentsTable)
      .where(eq(wingIncidentsTable.jobId, accrual.jobId));

    const unresolved = incidents.filter(
      (i) => BLOCKING_TYPES.includes(i.type) && !i.resolvedAt,
    );
    if (unresolved.length) {
      results.push({
        overrideId: accrual.id,
        status: "WAITING_ON_INCIDENT_RESOLUTION",
      });
      continue;
    }

    // Only incidents linked to the applicable recruit create automatic debits.
    const eligibleReworkCostCents = incidents
      .filter(
        (i) =>
          i.crewId === accrual.recruitCrewId &&
          ["CALLBACK", "REWORK", "DAMAGE"].includes(i.type),
      )
      .reduce((sum, i) => sum + (i.cost ? decimalToCents(i.cost) : 0), 0);

    const settlement = settleGuardianReserve({
      reserveAmountCents: decimalToCents(accrual.reserveAmount),
      eligibleReworkCostCents,
      qualityBonusPercent: config.overrides.qualityBonusPercentOfReserve,
    });

    let settled = false;
    await db.transaction(async (tx) => {
      // Concurrency guard: claim the override while it is still HELD. If a
      // parallel sweep already settled it, this returns no rows and we skip.
      const claimed = await tx
        .update(wingOverridesTable)
        .set({
          status: settlement.debitCents > 0 ? "ADJUSTED" : "AVAILABLE",
          reserveBonus: settlement.bonusCents / 100,
          reserveDebit: settlement.debitCents / 100,
          reserveReleasedAt: now,
        })
        .where(
          and(
            eq(wingOverridesTable.id, accrual.id),
            eq(wingOverridesTable.status, "HELD"),
          ),
        )
        .returning({ id: wingOverridesTable.id });
      if (!claimed.length) return;

      const [account] = await tx
        .select()
        .from(wingReserveAccountsTable)
        .where(eq(wingReserveAccountsTable.crewId, accrual.sponsorCrewId));
      if (!account) throw new Error("Reserve account missing.");
      const heldCents = Math.max(
        0,
        decimalToCents(account.heldBalance) -
          decimalToCents(accrual.reserveAmount),
      );
      const releasedCents =
        decimalToCents(account.releasedBalance) + settlement.totalAvailableCents;
      const debitedCents =
        decimalToCents(account.debitedBalance) + settlement.debitCents;

      await tx
        .update(wingReserveAccountsTable)
        .set({
          heldBalance: heldCents / 100,
          releasedBalance: releasedCents / 100,
          debitedBalance: debitedCents / 100,
        })
        .where(eq(wingReserveAccountsTable.id, account.id));

      const txns: Array<{ type: string; amount: number; note: string }> = [];
      if (settlement.debitCents > 0)
        txns.push({
          type: "REWORK_DEBIT",
          amount: -settlement.debitCents / 100,
          note: "Guardian Reserve quality adjustment for verified corrective work.",
        });
      if (settlement.releaseCents > 0)
        txns.push({
          type: "RELEASE",
          amount: settlement.releaseCents / 100,
          note: "Guardian Reserve released after the quality window.",
        });
      if (settlement.bonusCents > 0)
        txns.push({
          type: "QUALITY_BONUS",
          amount: settlement.bonusCents / 100,
          note: "No-callback Quality Kicker.",
        });
      for (const t of txns) {
        await tx.insert(wingReserveTxnsTable).values({
          accountId: account.id,
          crewId: accrual.sponsorCrewId,
          overrideId: accrual.id,
          type: t.type,
          amount: t.amount,
          balanceAfter: heldCents / 100,
          note: t.note,
        });
      }

      settled = true;
    });

    if (!settled) {
      results.push({ overrideId: accrual.id, status: "ALREADY_SETTLED" });
      continue;
    }

    await logWingAudit({
      action: "GUARDIAN_RESERVE_SETTLED",
      entityType: "wing_override",
      entityId: accrual.id,
      after: settlement,
      reason:
        settlement.debitCents > 0
          ? "Verified corrective work existed."
          : "Quality window passed without eligible rework cost.",
    });
    results.push({ overrideId: accrual.id, status: "SETTLED" });
  }
  return results;
}
