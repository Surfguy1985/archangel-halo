/**
 * Falkon Network page — /falkon-network
 *
 * Shows:
 *  • Phase indicator strip (Phases 1–6)
 *  • HALO business identity card
 *  • "Ask Falkon" CTA
 *  • Connected peers (UR Founders gets special card)
 *  • Cross-business request list (tabs: Outbound / Inbound)
 */

import { useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  Network,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Wifi,
  WifiOff,
  XCircle,
} from "lucide-react";
import {
  useFalkonHealth,
  useFalkonIdentity,
  useFalkonPeers,
  useFalkonRequests,
  useFalkonPhases,
  useApproveRequest,
  useRejectRequest,
  useCancelRequest,
  useRetryRequest,
  useRefreshPeer,
  healthColor,
  stateLabel,
  stateBadgeClass,
  fmtRelative,
  type FalkonPeer,
  type FalkonRequest,
} from "@/lib/falkonNetwork";
import { AskFalkonSheet } from "@/components/AskFalkonSheet";
import { FalkonStatusTimeline } from "@/components/FalkonStatusTimeline";
import { useToast } from "@/hooks/use-toast";
import falkonLogo from "@/assets/falkon-logo.png";

// ---------------------------------------------------------------------------
// Phase indicator strip
// ---------------------------------------------------------------------------

function PhaseStrip({ phases }: { phases: Array<{ phase: number; name: string; enabled: boolean }> }) {
  return (
    <div className="flex gap-[6px] overflow-x-auto pb-[2px] scrollbar-none">
      {phases.map((p) => (
        <div
          key={p.phase}
          className={`shrink-0 flex items-center gap-[5px] px-[10px] py-[5px] rounded-full border text-[11px] font-semibold whitespace-nowrap transition-all ${
            p.enabled
              ? "bg-[rgba(180,255,68,0.12)] border-[rgba(180,255,68,0.3)] text-[var(--gold)]"
              : p.phase === 2
              ? "bg-[var(--paper)] border-[var(--hairline)] text-[var(--faint)]"
              : "bg-transparent border-transparent text-[var(--faint)] opacity-50"
          }`}
        >
          {p.enabled ? (
            <CheckCircle2 className="w-[10px] h-[10px]" strokeWidth={2.5} />
          ) : (
            <Clock className="w-[10px] h-[10px]" strokeWidth={2} />
          )}
          <span>P{p.phase}</span>
          {p.enabled && <span className="text-[9px] font-bold tracking-[0.05em]">ACTIVE</span>}
          {!p.enabled && p.phase === 2 && (
            <span className="text-[9px] tracking-[0.04em] opacity-70">soon</span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Identity card
// ---------------------------------------------------------------------------

function IdentityCard() {
  const { data: identity, isLoading } = useFalkonIdentity();
  const { data: health } = useFalkonHealth();

  if (isLoading) {
    return (
      <div className="bg-card border border-[var(--hairline)] rounded-[16px] p-[16px] flex items-center gap-[10px]">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />
        <span className="text-[13px] text-[var(--muted)]">Loading identity…</span>
      </div>
    );
  }

  const modeLabel: Record<string, string> = {
    OFF: "Gateway Off",
    ASSISTED: "Assisted Mode",
    LIVE: "Live Mode",
  };

  return (
    <div className="bg-[#07101E] rounded-[16px] p-[16px] text-white relative overflow-hidden">
      {/* Background glow */}
      <div className="absolute top-0 right-0 w-[180px] h-[180px] bg-[radial-gradient(circle,rgba(180,255,68,0.08)_0%,transparent_70%)] pointer-events-none" />

      <div className="flex items-start gap-[12px] relative">
        <div className="w-[44px] h-[44px] rounded-[11px] bg-[rgba(180,255,68,0.1)] border border-[rgba(180,255,68,0.25)] grid place-items-center shrink-0">
          <img src={falkonLogo} alt="Falkon" className="w-[30px] h-[30px] object-contain brightness-0 invert" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold truncate">
            {identity?.businessName ?? "Archangel Ventures LLC"}
          </div>
          <div className="text-[11px] text-[rgba(255,255,255,0.5)] mt-[2px] font-mono truncate">
            {identity?.partnerId ?? "archangel-halo"}
          </div>
        </div>

        <div className="flex flex-col items-end gap-[4px] shrink-0">
          {/* Identity active dot */}
          <div className="flex items-center gap-[5px]">
            <span
              className="w-[7px] h-[7px] rounded-full"
              style={{ backgroundColor: identity?.identityActive ? "#B4FF44" : "#435A7D" }}
            />
            <span className="text-[10px] text-[rgba(255,255,255,0.5)]">
              {identity?.identityActive ? "Identity active" : "No identity"}
            </span>
          </div>
          <span className="text-[10px] font-semibold px-[8px] py-[2px] rounded-full bg-[rgba(180,255,68,0.12)] text-[#B4FF44] border border-[rgba(180,255,68,0.2)]">
            Phase {identity?.currentPhase ?? 1}
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex gap-[12px] mt-[14px] pt-[12px] border-t border-[rgba(255,255,255,0.08)]">
        <div className="flex items-center gap-[6px]">
          <Network className="w-[12px] h-[12px] text-[rgba(255,255,255,0.4)]" strokeWidth={2} />
          <span className="text-[11px] text-[rgba(255,255,255,0.5)]">
            {health?.peers.length ?? 0} peer{(health?.peers.length ?? 0) !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-[6px]">
          <Wifi className="w-[12px] h-[12px] text-[rgba(255,255,255,0.4)]" strokeWidth={2} />
          <span className="text-[11px] text-[rgba(255,255,255,0.5)]">
            {modeLabel[identity?.gatewayMode ?? "OFF"] ?? identity?.gatewayMode}
          </span>
        </div>
        {identity?.trustDocUrl && (
          <a
            href={identity.trustDocUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex items-center gap-[4px] text-[10px] text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.7)] transition-colors"
          >
            Trust doc
            <ArrowUpRight className="w-[10px] h-[10px]" />
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peer card
// ---------------------------------------------------------------------------

const UR_FOUNDERS_DOMAIN = "urfounders.com";
const UR_CAP_CHIPS = ["Entity Formation", "Compliance", "LLC / Corp Setup"];

function PeerCard({
  peer,
  onAsk,
}: {
  peer: FalkonPeer;
  onAsk: (peerId: string) => void;
}) {
  const refresh = useRefreshPeer();
  const { toast } = useToast();
  const isURFounders = peer.domain === UR_FOUNDERS_DOMAIN;
  const healthState = peer.health_state;
  const dot = healthColor(healthState);
  const isConnected = healthState === "connected";
  const isPending = healthState === "pending_peer";

  const handleRefresh = () => {
    refresh.mutate(peer.id, {
      onSuccess: (r) => {
        toast({ title: `${peer.name} health: ${stateLabel(r.newState)}` });
      },
      onError: () => toast({ title: "Refresh failed", variant: "destructive" }),
    });
  };

  const capChips = isURFounders
    ? UR_CAP_CHIPS
    : (peer.capabilities_data?.capabilities?.slice(0, 3).map((c) => c.name) ?? []);

  return (
    <div className="bg-card border border-[var(--hairline)] rounded-[16px] p-[14px]">
      <div className="flex items-start gap-[12px]">
        {/* Logo / icon */}
        <div
          className={`w-[42px] h-[42px] rounded-[11px] border grid place-items-center shrink-0 ${
            isConnected
              ? "bg-[rgba(180,255,68,0.08)] border-[rgba(180,255,68,0.2)]"
              : "bg-[var(--paper)] border-[var(--hairline)]"
          }`}
        >
          {isURFounders ? (
            <img src={falkonLogo} alt="UR Founders" className="w-[28px] h-[28px] object-contain brightness-0" />
          ) : (
            <Globe className="w-[18px] h-[18px] text-[var(--muted)]" strokeWidth={1.8} />
          )}
        </div>

        {/* Name + health */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[7px]">
            <span className="text-[14px] font-bold text-[var(--ink)] truncate">{peer.name}</span>
            <span
              className={`shrink-0 text-[10px] font-semibold px-[7px] py-[2px] rounded-full ${stateBadgeClass(healthState)}`}
            >
              {stateLabel(healthState)}
            </span>
          </div>
          <div className="text-[11px] text-[var(--muted)] mt-[2px] truncate">{peer.domain}</div>
        </div>

        {/* Health dot + refresh */}
        <div className="flex items-center gap-[8px] shrink-0">
          <div className="relative">
            <span
              className="w-[9px] h-[9px] rounded-full block"
              style={{ backgroundColor: dot }}
            />
            {isConnected && (
              <span
                className="absolute inset-0 rounded-full animate-ping opacity-50"
                style={{ backgroundColor: dot }}
              />
            )}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refresh.isPending}
            className="w-[28px] h-[28px] rounded-full bg-[var(--paper)] border border-[var(--hairline)] grid place-items-center text-[var(--muted)] hover:bg-[var(--hairline)] transition-colors disabled:opacity-50"
            title="Refresh health"
          >
            {refresh.isPending ? (
              <Loader2 className="w-[11px] h-[11px] animate-spin" />
            ) : (
              <RefreshCw className="w-[11px] h-[11px]" />
            )}
          </button>
        </div>
      </div>

      {/* Capabilities */}
      {capChips.length > 0 && (
        <div className="flex gap-[6px] flex-wrap mt-[10px]">
          {capChips.map((chip) => (
            <span
              key={chip}
              className="text-[10px] font-medium bg-[var(--paper)] border border-[var(--hairline)] text-[var(--muted)] px-[8px] py-[2px] rounded-full"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {/* Pending peer connecting animation */}
      {isPending && (
        <div className="mt-[10px] pt-[10px] border-t border-[var(--hairline)] flex items-center gap-[8px] text-[11px] text-[var(--muted)]">
          <div className="flex gap-[3px]">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="w-[4px] h-[4px] rounded-full bg-[var(--faint)] animate-bounce"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
          Attempting to connect…
        </div>
      )}

      {/* Action row */}
      <div className="mt-[10px] pt-[10px] border-t border-[var(--hairline)] flex items-center justify-between">
        <div className="text-[10px] text-[var(--faint)]">
          {peer.last_health_check_at
            ? `Checked ${fmtRelative(peer.last_health_check_at)}`
            : "Not yet checked"}
        </div>
        <button
          type="button"
          onClick={() => onAsk(peer.id)}
          className={`flex items-center gap-[5px] text-[12px] font-semibold px-[12px] py-[6px] rounded-full transition-all ${
            isConnected
              ? "bg-[var(--gold-light)] text-black hover:scale-[1.03]"
              : "bg-[var(--paper)] border border-[var(--hairline)] text-[var(--muted)] opacity-60 cursor-not-allowed"
          }`}
          disabled={!isConnected && !isPending}
        >
          Ask {peer.name.split(" ")[0]}
          <ChevronRight className="w-[12px] h-[12px]" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Request list
// ---------------------------------------------------------------------------

function RequestRow({
  req,
  onDetail,
}: {
  req: FalkonRequest;
  onDetail: (id: string) => void;
}) {
  const { toast } = useToast();
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const cancel = useCancelRequest();
  const retry = useRetryRequest();

  const s = req.approval_state;
  const isInbound = req.direction === "inbound";
  const canApprove = isInbound && s === "awaiting_approval";
  const canReject = isInbound && s === "awaiting_approval";
  const canCancel = ["pending_delivery", "sent"].includes(s);
  const canRetry = s === "delivery_failed";

  const act = (fn: () => Promise<unknown>, label: string) => {
    fn()
      .then(() => toast({ title: label }))
      .catch(() => toast({ title: "Action failed", variant: "destructive" }));
  };

  return (
    <div className="bg-card border border-[var(--hairline)] rounded-[14px] p-[13px]">
      <div className="flex items-start gap-[10px]">
        <div
          className={`w-[8px] h-[8px] rounded-full shrink-0 mt-[5px]`}
          style={{ backgroundColor: healthColor(s) }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[7px] flex-wrap">
            <span className="text-[13px] font-semibold text-[var(--ink)] truncate">
              {req.capability_name ?? req.capability_id}
            </span>
            <span className={`text-[10px] font-semibold px-[7px] py-[2px] rounded-full ${stateBadgeClass(s)}`}>
              {stateLabel(s)}
            </span>
          </div>
          <div className="text-[11px] text-[var(--muted)] mt-[2px] line-clamp-1">
            {req.peer_name ?? "Unknown peer"} · {fmtRelative(req.created_at)}
          </div>
          {req.summary && (
            <div className="text-[11px] text-[var(--faint)] mt-[4px] line-clamp-2">
              {req.summary}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-[6px] mt-[10px] justify-end">
        <button
          type="button"
          onClick={() => onDetail(req.id)}
          className="text-[11px] font-medium text-[var(--muted)] hover:text-[var(--ink)] transition-colors px-[10px] py-[5px] rounded-[8px] bg-[var(--paper)] border border-[var(--hairline)]"
        >
          Details
        </button>

        {canApprove && (
          <button
            type="button"
            onClick={() => act(() => approve.mutateAsync(req.id), "Request approved")}
            disabled={approve.isPending}
            className="flex items-center gap-[5px] text-[11px] font-semibold text-[var(--gold)] bg-[rgba(180,255,68,0.1)] border border-[rgba(180,255,68,0.25)] px-[10px] py-[5px] rounded-[8px] hover:bg-[rgba(180,255,68,0.2)] transition-colors disabled:opacity-50"
          >
            {approve.isPending ? <Loader2 className="w-[10px] h-[10px] animate-spin" /> : <ThumbsUp className="w-[10px] h-[10px]" strokeWidth={2} />}
            Approve
          </button>
        )}

        {canReject && (
          <button
            type="button"
            onClick={() => act(() => reject.mutateAsync({ id: req.id }), "Request rejected")}
            disabled={reject.isPending}
            className="flex items-center gap-[5px] text-[11px] font-semibold text-[#E11D48] bg-[rgba(225,29,72,0.07)] border border-[rgba(225,29,72,0.18)] px-[10px] py-[5px] rounded-[8px] hover:bg-[rgba(225,29,72,0.14)] transition-colors disabled:opacity-50"
          >
            {reject.isPending ? <Loader2 className="w-[10px] h-[10px] animate-spin" /> : <ThumbsDown className="w-[10px] h-[10px]" strokeWidth={2} />}
            Decline
          </button>
        )}

        {canCancel && (
          <button
            type="button"
            onClick={() => act(() => cancel.mutateAsync(req.id), "Request cancelled")}
            disabled={cancel.isPending}
            className="flex items-center gap-[5px] text-[11px] font-medium text-[var(--muted)] bg-[var(--paper)] border border-[var(--hairline)] px-[10px] py-[5px] rounded-[8px] hover:bg-[var(--hairline)] transition-colors disabled:opacity-50"
          >
            {cancel.isPending ? <Loader2 className="w-[10px] h-[10px] animate-spin" /> : <XCircle className="w-[10px] h-[10px]" />}
            Cancel
          </button>
        )}

        {canRetry && (
          <button
            type="button"
            onClick={() => act(() => retry.mutateAsync(req.id), "Queued for retry")}
            disabled={retry.isPending}
            className="flex items-center gap-[5px] text-[11px] font-medium text-[#2563EB] bg-[rgba(37,99,235,0.07)] border border-[rgba(37,99,235,0.18)] px-[10px] py-[5px] rounded-[8px] hover:bg-[rgba(37,99,235,0.14)] transition-colors disabled:opacity-50"
          >
            {retry.isPending ? <Loader2 className="w-[10px] h-[10px] animate-spin" /> : <RotateCcw className="w-[10px] h-[10px]" />}
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail sheet (shows full timeline + shared data)
// ---------------------------------------------------------------------------

function DetailSheet({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[4px]" onClick={onClose} />
      <div className="relative w-full max-h-[80dvh] bg-white rounded-t-[24px] overflow-y-auto p-[20px] pb-[40px]">
        <div className="w-[36px] h-[4px] bg-[var(--hairline)] rounded-full mx-auto mb-[20px]" />
        <FalkonStatusTimeline requestId={requestId} />
        <button
          type="button"
          onClick={onClose}
          className="mt-[20px] w-full h-[46px] rounded-[14px] bg-[var(--paper)] border border-[var(--hairline)] text-[var(--ink)] font-semibold text-[14px]"
        >
          Close
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function FalkonNetwork() {
  const { data: health, isLoading: healthLoading } = useFalkonHealth();
  const { data: peersData, isLoading: peersLoading } = useFalkonPeers();
  const { data: phasesData } = useFalkonPhases();
  const { data: outboundData } = useFalkonRequests({ direction: "outbound" });
  const { data: inboundData } = useFalkonRequests({ direction: "inbound" });

  const [askOpen, setAskOpen] = useState(false);
  const [askPeerId, setAskPeerId] = useState<string | undefined>(undefined);
  const [requestTab, setRequestTab] = useState<"outbound" | "inbound">("outbound");
  const [detailId, setDetailId] = useState<string | null>(null);

  const peers = peersData?.peers ?? [];
  const phases = phasesData?.phases ?? [];
  const outbound = outboundData?.requests ?? [];
  const inbound = inboundData?.requests ?? [];
  const pending = inbound.filter((r) => r.approval_state === "awaiting_approval").length;

  const handleAsk = (peerId: string) => {
    setAskPeerId(peerId);
    setAskOpen(true);
  };

  return (
    <div className="flex flex-col gap-[20px] pt-[4px]">
      {/* Section header */}
      <div className="flex items-center gap-[10px]">
        <div className="w-[34px] h-[34px] rounded-[10px] bg-[#07101E] border border-[rgba(180,255,68,0.25)] grid place-items-center shrink-0">
          <Network className="w-[16px] h-[16px] text-[#B4FF44]" strokeWidth={1.8} />
        </div>
        <div>
          <div className="text-[16px] font-bold text-[var(--ink)]">Falkon Network</div>
          <div className="text-[11px] text-[var(--muted)]">
            {healthLoading
              ? "Checking network…"
              : health?.overallHealth === "healthy"
              ? `${health.peers.length} peer${health.peers.length !== 1 ? "s" : ""} connected`
              : "Building connections"}
          </div>
        </div>

        {/* Overall health indicator */}
        <div className="ml-auto flex items-center gap-[5px] text-[11px] font-medium">
          {health?.overallHealth === "healthy" ? (
            <Wifi className="w-[14px] h-[14px] text-[var(--gold)]" strokeWidth={2} />
          ) : health?.overallHealth === "no_peers" ? (
            <WifiOff className="w-[14px] h-[14px] text-[var(--muted)]" strokeWidth={2} />
          ) : (
            <Loader2 className="w-[14px] h-[14px] text-[var(--muted)] animate-spin" strokeWidth={2} />
          )}
        </div>
      </div>

      {/* Phase strip */}
      {phases.length > 0 && (
        <div>
          <PhaseStrip phases={phases} />
          <div className="text-[10px] text-[var(--faint)] mt-[6px]">
            Phase 2 — Connected Companies coming next
          </div>
        </div>
      )}

      {/* Identity card */}
      <IdentityCard />

      {/* Ask Falkon CTA */}
      <button
        type="button"
        onClick={() => {
          setAskPeerId(undefined);
          setAskOpen(true);
        }}
        className="w-full h-[52px] rounded-[16px] bg-[var(--gold-light)] text-black font-bold text-[14px] flex items-center justify-center gap-[8px] shadow-[0_0_24px_rgba(180,255,68,0.3)] hover:scale-[1.01] active:scale-[0.99] transition-transform"
      >
        <Sparkles className="w-[16px] h-[16px]" strokeWidth={2} />
        Ask Falkon
      </button>

      {/* Peers */}
      <div>
        <div className="text-[11px] font-bold tracking-[0.07em] uppercase text-[var(--muted)] mb-[10px]">
          Connected Businesses
        </div>

        {peersLoading && (
          <div className="flex items-center gap-[8px] text-[var(--muted)] py-[16px]">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-[13px]">Loading peers…</span>
          </div>
        )}

        {!peersLoading && peers.length === 0 && (
          <div className="bg-card border border-[var(--hairline)] rounded-[14px] p-[16px] text-center">
            <Globe className="w-[24px] h-[24px] text-[var(--faint)] mx-auto mb-[8px]" strokeWidth={1.5} />
            <div className="text-[13px] text-[var(--muted)]">No peers registered yet</div>
            <div className="text-[11px] text-[var(--faint)] mt-[4px]">
              Peers are added from the Falkon Network desktop control center
            </div>
          </div>
        )}

        <div className="flex flex-col gap-[10px]">
          {peers.map((peer) => (
            <PeerCard key={peer.id} peer={peer} onAsk={handleAsk} />
          ))}
        </div>
      </div>

      {/* Requests */}
      <div>
        <div className="flex items-center justify-between mb-[10px]">
          <div className="text-[11px] font-bold tracking-[0.07em] uppercase text-[var(--muted)]">
            Cross-Business Requests
          </div>
          {pending > 0 && (
            <span className="text-[10px] font-bold px-[7px] py-[2px] rounded-full bg-[rgba(225,29,72,0.1)] text-[#E11D48] border border-[rgba(225,29,72,0.2)]">
              {pending} pending
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-[6px] mb-[12px]">
          {(["outbound", "inbound"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setRequestTab(tab)}
              className={`flex items-center gap-[5px] px-[12px] py-[6px] rounded-full text-[12px] font-semibold transition-all ${
                requestTab === tab
                  ? "bg-[var(--ink)] text-white"
                  : "bg-card border border-[var(--hairline)] text-[var(--muted)] hover:bg-[var(--paper)]"
              }`}
            >
              {tab === "outbound" ? (
                <Send className="w-[10px] h-[10px]" strokeWidth={2} />
              ) : (
                <ShieldCheck className="w-[10px] h-[10px]" strokeWidth={2} />
              )}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === "inbound" && pending > 0 && (
                <span className="w-[16px] h-[16px] rounded-full bg-[#E11D48] text-white text-[9px] font-bold grid place-items-center">
                  {pending}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Request rows */}
        {(() => {
          const list = requestTab === "outbound" ? outbound : inbound;
          if (list.length === 0) {
            return (
              <div className="bg-card border border-[var(--hairline)] rounded-[14px] p-[16px] text-center">
                {requestTab === "outbound" ? (
                  <Send className="w-[20px] h-[20px] text-[var(--faint)] mx-auto mb-[8px]" strokeWidth={1.5} />
                ) : (
                  <CheckCircle2 className="w-[20px] h-[20px] text-[var(--faint)] mx-auto mb-[8px]" strokeWidth={1.5} />
                )}
                <div className="text-[13px] text-[var(--muted)]">
                  No {requestTab} requests yet
                </div>
                {requestTab === "outbound" && (
                  <div className="text-[11px] text-[var(--faint)] mt-[4px]">
                    Use Ask Falkon to send your first cross-business request
                  </div>
                )}
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-[8px]">
              {list.slice(0, 10).map((req) => (
                <RequestRow key={req.id} req={req} onDetail={setDetailId} />
              ))}
            </div>
          );
        })()}
      </div>

      {/* Powered by footer */}
      <div className="flex flex-col items-center gap-[6px] py-[8px] pb-[4px] opacity-50">
        <span className="text-[9px] font-mono tracking-widest uppercase text-[var(--faint)]">Powered by</span>
        <img src={falkonLogo} alt="Falkon" className="h-[12px] object-contain brightness-0" />
      </div>

      {/* Sheets / overlays */}
      <AskFalkonSheet
        open={askOpen}
        onOpenChange={setAskOpen}
        peerId={askPeerId}
      />

      {detailId && (
        <DetailSheet requestId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}
