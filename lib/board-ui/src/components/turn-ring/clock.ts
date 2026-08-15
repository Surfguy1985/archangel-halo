/** Keep identical to lib/db/src/turnMetrics.ts `formatStageClock`. */
export function formatStageClock(ms: bigint | number): string {
  const n = typeof ms === "bigint" ? Number(ms) : ms;
  if (!Number.isFinite(n) || n <= 0) return "0 minutes";
  const days = Math.floor(n / 86_400_000);
  const hours = Math.floor((n % 86_400_000) / 3_600_000);
  const minutes = Math.floor((n % 3_600_000) / 60_000);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (parts.length === 0) parts.push(`${Math.max(1, minutes)} minute${minutes === 1 ? "" : "s"}`);
  return parts.join(", ");
}

export function actorLabel(actorId: string | null | undefined): string {
  if (!actorId) return "—";
  if (actorId === "office") return "Office";
  if (actorId.startsWith("client:")) return "Client";
  if (actorId.startsWith("test:")) return "System";
  return actorId;
}

export function ownerLabel(owner: string): string {
  if (owner === "client") return "yours";
  if (owner === "vendor") return "vendor";
  return "shared";
}
