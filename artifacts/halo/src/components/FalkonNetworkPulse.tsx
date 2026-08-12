/**
 * FalkonNetworkPulse — a small animated health indicator for the Layout header.
 *
 * Shows a Network icon button with a coloured dot (lime = healthy, amber =
 * degraded, grey = disconnected/no peers). Clicking navigates to /falkon-network.
 */

import { Link } from "wouter";
import { Network } from "lucide-react";
import { useFalkonHealth, healthColor } from "@/lib/falkonNetwork";

export function FalkonNetworkPulse() {
  const { data: health, isLoading } = useFalkonHealth();

  const state = health?.overallHealth ?? (isLoading ? "loading" : "no_peers");
  const dotColor = healthColor(state);
  const isHealthy = state === "healthy";
  const pendingCount = health?.pendingInboundRequests ?? 0;

  return (
    <Link href="/falkon-network">
      <button
        className="relative w-[40px] h-[40px] rounded-full grid place-items-center bg-card border border-[var(--hairline)] hover:bg-[var(--gold-tint)] transition-colors"
        aria-label="Falkon Network"
        title="Falkon Network"
      >
        <Network className="w-[17px] h-[17px] text-[var(--muted)]" strokeWidth={1.8} />

        {/* Health dot */}
        <span
          className="absolute -top-[2px] -right-[2px] w-[10px] h-[10px] rounded-full border-[2px] border-white"
          style={{ backgroundColor: dotColor }}
        />

        {/* Pulse ring when healthy */}
        {isHealthy && (
          <span
            className="absolute -top-[2px] -right-[2px] w-[10px] h-[10px] rounded-full animate-ping opacity-60"
            style={{ backgroundColor: dotColor }}
          />
        )}

        {/* Pending inbound badge */}
        {pendingCount > 0 && (
          <span className="absolute -bottom-[3px] -right-[3px] min-w-[14px] h-[14px] px-[3px] rounded-[7px] bg-[#E11D48] text-white text-[9px] font-bold grid place-items-center shadow">
            {pendingCount}
          </span>
        )}
      </button>
    </Link>
  );
}
