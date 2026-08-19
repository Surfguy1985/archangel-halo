export function dollars(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}
export function normalizeServiceCode(raw: string): string {
  const t = (raw || "").toLowerCase();
  if (/wall.*paint|full.?paint|unit.?paint/.test(t)) return "PAINT_WALL_FULL";
  if (/ceiling/.test(t)) return "PAINT_CEILING";
  if (/cabinet/.test(t)) return "PAINT_CABINET";
  if (/door|trim|baseboard/.test(t)) return "PAINT_DOORS_TRIM";
  if (/kilz|primer/.test(t)) return "PAINT_KILZ";
  if (/1.?x.?1|small.?patch/.test(t)) return "DRYWALL_SMALL";
  if (/2.?x.?2|medium.?patch/.test(t)) return "DRYWALL_MEDIUM";
  if (/3.?x.?3|large.?patch/.test(t)) return "DRYWALL_LARGE";
  if (/make.?ready|punch/.test(t)) return "MAKE_READY_PACKAGE";
  if (/toilet/.test(t)) return "TOILET_INSTALL";
  if (/vacant.?clean|housekeeping|clean/.test(t)) return "CLEAN_VACANT";
  if (/carpet/.test(t)) return "CARPET_BASIC";
  if (/tub|reglaze|shower|resurfac/.test(t)) return "RESURF_STD_TUB";
  return (raw || "UNKNOWN").toUpperCase().replace(/\s+/g, "_").slice(0, 40);
}
export type Severity = "critical" | "high" | "medium";
export function classifyLineVariance(opts: { actualCents: number; masterRateCents: number | null; masterUnitType?: string | null; }): { type: string; severity: Severity; varianceCents: number | null } | null {
  const { actualCents, masterRateCents, masterUnitType } = opts;
  if (masterRateCents == null || masterUnitType === "bid") {
    if (actualCents === 0) return { type: "bid_needs_price", severity: "critical", varianceCents: null };
    return null;
  }
  if (actualCents === 0) return { type: "zero_or_missing", severity: "critical", varianceCents: masterRateCents };
  const variance = actualCents - masterRateCents;
  if (variance === 0) return null;
  return { type: "invoice_variance", severity: Math.abs(variance) > 5000 ? "high" : "medium", varianceCents: variance };
}
export function validateResolveInput(opts: { mode: "apply" | "pending" | "dismiss"; reason: string; newInvoiceCents?: number | null; newPayoutCents?: number | null; currentStatus: string; }): { ok: true } | { ok: false; error: string } {
  if (opts.currentStatus !== "open" && opts.currentStatus !== "pending_review") return { ok: false, error: "Already resolved" };
  if (opts.mode === "dismiss" && !opts.reason.trim()) return { ok: false, error: "Reason required" };
  if (opts.mode === "apply") {
    if (!opts.reason.trim()) return { ok: false, error: "Reason required" };
    if (opts.newInvoiceCents == null && opts.newPayoutCents == null) return { ok: false, error: "Enter at least one amount" };
  }
  return { ok: true };
}
