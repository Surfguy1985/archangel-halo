/**
 * Invoice compliance — resolve every scope line against the active price list.
 * Overbilling is a service-layer impossibility, not a UI suggestion.
 *
 * Money is bigint cents. Tolerance is integer basis points (default 0).
 */

import { subCents, type Cents } from "./moneyCents";

export const DEFAULT_TOLERANCE_BPS = 0;
export const DEFAULT_VARIANCE_REVIEW_MINUTES = 12;

export type ScopeComplianceStatus =
  | "matched"
  | "variance_pending"
  | "variance_approved"
  | "off_schedule";

export type PriceListItemView = {
  id: string;
  code: string;
  tier: string | null;
  description: string;
  unitPriceCents: Cents;
};

export type ScopeLineView = {
  id?: string;
  code: string | null;
  tier: string | null;
  description: string;
  qty: number;
  unitPriceCents: Cents;
  priceItemId?: string | null;
  compliance?: ScopeComplianceStatus;
};

export type LineResolution = {
  compliance: Exclude<ScopeComplianceStatus, "variance_approved">;
  priceItemId: string | null;
  scheduleCode: string | null;
  scheduleDescription: string | null;
  scheduleTier: string | null;
  scheduleUnitPriceCents: Cents | null;
  deltaCents: Cents;
  reason: "exact" | "price_deviation" | "no_match";
};

export function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export function normalizeTier(tier: string | null | undefined): string {
  return (tier ?? "").trim().toLowerCase();
}

export function pickActivePriceList<T extends { effectiveFrom: Date; effectiveTo: Date | null }>(
  lists: T[],
  at: Date,
): T | null {
  const covering = lists.filter(
    (l) => l.effectiveFrom.getTime() <= at.getTime() && (l.effectiveTo == null || l.effectiveTo.getTime() > at.getTime()),
  );
  if (covering.length === 0) return null;
  return covering.reduce((best, row) =>
    row.effectiveFrom.getTime() > best.effectiveFrom.getTime() ? row : best,
  );
}

function exactItem(line: ScopeLineView, items: PriceListItemView[]): PriceListItemView | null {
  if (line.priceItemId) {
    const byId = items.find((i) => i.id === line.priceItemId);
    if (byId) return byId;
  }
  const code = normalizeCode(line.code);
  if (!code) return null;
  const tier = normalizeTier(line.tier);
  return (
    items.find((i) => normalizeCode(i.code) === code && normalizeTier(i.tier) === tier) ?? null
  );
}

export function nearestPriceItem(line: ScopeLineView, items: PriceListItemView[]): PriceListItemView | null {
  const code = normalizeCode(line.code);
  if (code) {
    const sameCode = items.filter((i) => normalizeCode(i.code) === code);
    if (sameCode.length) return sameCode[0]!;
  }
  const desc = line.description.trim().toLowerCase();
  if (!desc) return null;
  return (
    items.find((i) => i.description.trim().toLowerCase() === desc) ??
    items.find((i) => {
      const d = i.description.trim().toLowerCase();
      return d.includes(desc) || desc.includes(d);
    }) ??
    null
  );
}

function priceWithinTolerance(actual: Cents, schedule: Cents, toleranceBps: number): boolean {
  if (actual === schedule) return true;
  if (toleranceBps <= 0) return false;
  const delta = actual > schedule ? actual - schedule : schedule - actual;
  return delta * 10_000n <= schedule * BigInt(toleranceBps);
}

export function resolveScopeLine(
  line: ScopeLineView,
  items: PriceListItemView[],
  toleranceBps: number = DEFAULT_TOLERANCE_BPS,
): LineResolution {
  const match = exactItem(line, items);
  if (!match) {
    const near = nearestPriceItem(line, items);
    return {
      compliance: "off_schedule",
      priceItemId: near?.id ?? null,
      scheduleCode: near ? near.code : null,
      scheduleDescription: near ? near.description : null,
      scheduleTier: near?.tier ?? null,
      scheduleUnitPriceCents: near?.unitPriceCents ?? null,
      deltaCents: near ? subCents(line.unitPriceCents, near.unitPriceCents) : line.unitPriceCents,
      reason: "no_match",
    };
  }
  if (priceWithinTolerance(line.unitPriceCents, match.unitPriceCents, toleranceBps)) {
    return {
      compliance: "matched",
      priceItemId: match.id,
      scheduleCode: match.code,
      scheduleDescription: match.description,
      scheduleTier: match.tier,
      scheduleUnitPriceCents: match.unitPriceCents,
      deltaCents: 0n,
      reason: "exact",
    };
  }
  return {
    compliance: "variance_pending",
    priceItemId: match.id,
    scheduleCode: match.code,
    scheduleDescription: match.description,
    scheduleTier: match.tier,
    scheduleUnitPriceCents: match.unitPriceCents,
    deltaCents: subCents(line.unitPriceCents, match.unitPriceCents),
    reason: "price_deviation",
  };
}

export function invoiceBlockers(
  lines: Array<{ compliance: ScopeComplianceStatus; description: string }>,
): Array<{ description: string; compliance: ScopeComplianceStatus }> {
  return lines.filter((l) => l.compliance === "variance_pending" || l.compliance === "off_schedule");
}

export function canCreateInvoice(
  lines: Array<{ compliance: ScopeComplianceStatus }>,
): boolean {
  return lines.every((l) => l.compliance === "matched" || l.compliance === "variance_approved");
}

export function complianceBadgeText(args: {
  matched: number;
  total: number;
  revision: string;
  effectiveLabel: string;
}): string {
  return `${args.matched} of ${args.total} line items matched to your approved schedule (${args.revision}, effective ${args.effectiveLabel}).`;
}

/** Configured assumption — never present as a measured duration. */
export function assumedHoursSaved(blockedLineCount: number, minutesPerReview: number): number {
  if (blockedLineCount <= 0 || minutesPerReview <= 0) return 0;
  return Math.round(((blockedLineCount * minutesPerReview) / 60) * 10) / 10;
}

export function formatInvoiceNumber(args: {
  propertyCode: string;
  unitNumber: string;
  yymmdd: string;
  seq: number;
}): string {
  const code = args.propertyCode.replace(/[^A-Za-z0-9-]/g, "") || "PROP";
  const unit = args.unitNumber.replace(/[^A-Za-z0-9-]/g, "") || "UNIT";
  const seq = String(Math.max(1, args.seq)).padStart(3, "0");
  return `${code}-${unit}-${args.yymmdd}-${seq}`;
}

export function nextInvoiceSeq(existing: string[], prefix: string): number {
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`);
  for (const n of existing) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

export function blockingInvoiceMessage(args: {
  lines: Array<{ description: string; compliance: ScopeComplianceStatus }>;
  revision: string;
  effectiveLabel: string;
}): string {
  const blockers = invoiceBlockers(args.lines);
  const named = blockers.map((l) => `"${l.description}" (${l.compliance.replace("_", " ")})`).join(", ");
  return `Cannot invoice: ${named} against ${args.revision} (effective ${args.effectiveLabel}). Raise a variance request first.`;
}
