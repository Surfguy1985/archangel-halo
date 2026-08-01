// Single source of truth for when an emergency pay hold counts as settled.
//
// A hold is settled ONLY by its own money movement:
//   1. a paid crew payout for that crew + job, or
//   2. the canonical emergency same-day crew payment (identified by the
//      EMERGENCY_PAY_NOTE_PREFIX) marked completed.
// Ordinary base-rate crew payments must never settle a hold — the close-out
// checklist can require base pay completed before the hold even releases,
// so matching any completed payment would mark holds settled prematurely.
//
// Every surface that decides "is this hold still owed?" (portal earnings,
// the Today "Pay today" sweep, the payout queue) must go through these
// helpers so they can never disagree.

export const EMERGENCY_PAY_NOTE_PREFIX = "Emergency same-day pay";

type PayoutLike = { crewId: string; jobId: string; status: string };
type PaymentLike = {
  crewId: string;
  jobId: string | null;
  status: string;
  note?: string | null;
};

/** True when this crew payment is the canonical emergency settlement artifact. */
export function isEmergencySettlementPayment(p: PaymentLike): boolean {
  return (
    p.status === "completed" &&
    p.jobId != null &&
    (p.note ?? "").startsWith(EMERGENCY_PAY_NOTE_PREFIX)
  );
}

/**
 * Shared "emergency outstanding amount": how much of a hold is still owed
 * to a crew for a job, given ALL crew payments. Completed NON-emergency
 * payments (e.g. base pay marked paid before close-out) reduce the
 * obligation; emergency settlement payments and pending payments do not —
 * they ARE the remaining payable, tracked by the settled predicate instead.
 * Every surface that shows an amount owed for a hold (portal earnings,
 * Today "Pay today", payout queue) must use this so they can never disagree.
 */
export function outstandingHoldAmount(
  holdAmount: number,
  crewId: string,
  jobId: string,
  payments: PaymentLike[] & { amount?: number | null }[],
): number {
  const priorCompleted = (payments as (PaymentLike & { amount?: number | null })[])
    .filter(
      (p) =>
        p.crewId === crewId &&
        p.jobId === jobId &&
        p.status === "completed" &&
        !(p.note ?? "").startsWith(EMERGENCY_PAY_NOTE_PREFIX),
    )
    .reduce((s, p) => s + (p.amount ?? 0), 0);
  return Math.max(0, Math.round((holdAmount - priorCompleted) * 100) / 100);
}

/**
 * Build the set of "crewId|jobId" keys whose emergency obligation is settled.
 * Pass ALL payouts and ALL crew payments; filtering happens here.
 */
export function emergencySettledKeys(
  payouts: PayoutLike[],
  payments: PaymentLike[],
): Set<string> {
  return new Set([
    ...payouts
      .filter((p) => p.status === "paid")
      .map((p) => `${p.crewId}|${p.jobId}`),
    ...payments
      .filter(isEmergencySettlementPayment)
      .map((p) => `${p.crewId}|${p.jobId}`),
  ]);
}
