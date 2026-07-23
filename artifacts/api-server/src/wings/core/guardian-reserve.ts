export interface GuardianReserveSettlementInput {
  reserveAmountCents: number;
  eligibleReworkCostCents: number;
  qualityBonusPercent: number;
}

export interface GuardianReserveSettlement {
  debitCents: number;
  releaseCents: number;
  bonusCents: number;
  totalAvailableCents: number;
}

export function settleGuardianReserve(input: GuardianReserveSettlementInput): GuardianReserveSettlement {
  const debitCents = Math.min(
    Math.max(0, Math.round(input.eligibleReworkCostCents)),
    Math.max(0, Math.round(input.reserveAmountCents))
  );
  const releaseCents = Math.max(0, Math.round(input.reserveAmountCents) - debitCents);
  const bonusCents = debitCents === 0 ? Math.round(releaseCents * Math.max(0, input.qualityBonusPercent)) : 0;

  return {
    debitCents,
    releaseCents,
    bonusCents,
    totalAvailableCents: releaseCents + bonusCents
  };
}
