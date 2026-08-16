/**
 * DecisionPacket — the premium, structured card for consequential decisions.
 *
 * Rendered in the HaloCommand thread for Now-tier feed cards and autopilot
 * suggestions that require a human decision. Shows: what/why/evidence/cost/
 * policy/Falkon recommendation/confidence + Approve / Decline / Ask HALO.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRemindInvoice,
  useNudgeBid,
  useAcceptWorkRequest,
  useDeclineWorkRequest,
  useDismissFeedItem,
  useApproveAutopilotAction,
  useDismissAutopilotAction,
  getGetTodayQueryKey,
  getListInvoicesQueryKey,
  getListBidsQueryKey,
  getListJobsQueryKey,
  getListAutopilotActionsQueryKey,
  getGetMoneySummaryQueryKey,
  type FeedCard as FeedCardType,
} from "@workspace/api-client-react";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Loader2,
  Shield,
  Zap,
  DollarSign,
  FileText,
  Clock,
} from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AutopilotItem {
  id: string;
  title: string;
  body: string;
  type: string;
  status: string;
}

interface DecisionPacketProps {
  card?: FeedCardType;
  autopilot?: AutopilotItem;
  onAskHalo?: (context: string) => void;
  onResolved?: () => void;
  /** When true, renders SHADOW mode visual treatment — amber border, SHADOW chip, Preview/Test labels */
  shadowMode?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTierColor(queue?: string | null): string {
  switch (queue) {
    case "money": return "#E11D48";
    case "margin": return "#F59E0B";
    case "invoice": return "#B4FF44";
    case "bids": return "#6366F1";
    default: return "#B4FF44";
  }
}

function getQueueIcon(queue?: string | null) {
  switch (queue) {
    case "money": return DollarSign;
    case "margin": return AlertTriangle;
    case "invoice": return FileText;
    case "bids": return Clock;
    default: return Zap;
  }
}

function getFalkonRecommendation(card?: FeedCardType, autopilot?: AutopilotItem): {
  rec: "approve" | "hold" | "decline";
  reason: string;
  confidence: number;
} {
  if (autopilot) {
    return { rec: "approve", reason: "Low-risk automated action within policy", confidence: 92 };
  }
  if (!card) return { rec: "hold", reason: "Awaiting analysis", confidence: 0 };
  switch (card.queue) {
    case "money":
      return { rec: "approve", reason: "Invoice overdue — sending a reminder is low-risk and policy-aligned", confidence: 97 };
    case "margin":
      return { rec: "hold", reason: "Review job pricing before proceeding", confidence: 74 };
    case "bids":
      return { rec: "approve", reason: "Client engagement gap exceeds 3-day SLA", confidence: 88 };
    default:
      return { rec: "approve", reason: "Standard operating procedure", confidence: 85 };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DecisionPacket({ card, autopilot, onAskHalo, onResolved, shadowMode }: DecisionPacketProps) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [resolved, setResolved] = useState(false);

  const remindInvoice = useRemindInvoice();
  const nudgeBid = useNudgeBid();
  const acceptRequest = useAcceptWorkRequest();
  const declineRequest = useDeclineWorkRequest();
  const dismissFeed = useDismissFeedItem();
  const approveAutopilot = useApproveAutopilotAction();
  const dismissAutopilot = useDismissAutopilotAction();

  const busy =
    remindInvoice.isPending || nudgeBid.isPending || acceptRequest.isPending ||
    declineRequest.isPending || dismissFeed.isPending ||
    approveAutopilot.isPending || dismissAutopilot.isPending;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
    qc.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
    qc.invalidateQueries({ queryKey: getListBidsQueryKey() });
    qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
    qc.invalidateQueries({ queryKey: getListAutopilotActionsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });
  };

  if (resolved) return null;

  const accentColor = card ? getTierColor(card.queue) : "#B4FF44";
  const QueueIcon = card ? getQueueIcon(card.queue) : Zap;
  const falkon = getFalkonRecommendation(card, autopilot);

  const title = card?.title ?? autopilot?.title ?? "Decision Required";
  const body = card?.sub ?? autopilot?.body ?? "";
  const amount = card?.amount;

  const handleApprove = async () => {
    // SHADOW mode: non-mutating — show simulation result without any real mutations.
    if (shadowMode) {
      toast({ title: "SHADOW preview", description: "Action simulated — no changes were made." });
      setResolved(true);
      onResolved?.();
      return;
    }
    try {
      if (autopilot) {
        await approveAutopilot.mutateAsync({ id: autopilot.id });
        toast({ title: "Done", description: "Autopilot handled it." });
      } else if (card) {
        if (card.queue === "money" && card.entityId) {
          await remindInvoice.mutateAsync({ id: card.entityId });
          toast({ title: "Reminder sent" });
        } else if (card.queue === "bids" && card.entityId) {
          await nudgeBid.mutateAsync({ id: card.entityId });
          toast({ title: "Nudge sent" });
        } else if (card.entityType === "work_request" && card.entityId) {
          await acceptRequest.mutateAsync({ id: card.entityId, data: {} });
          toast({ title: "Request approved" });
        } else {
          // Navigate to entity for manual action
          if (card.entityType === "job" && card.entityId) navigate(`/jobs/${card.entityId}`);
          else if (card.entityType === "invoice" && card.entityId) navigate(`/invoices/${card.entityId}`);
          else navigate("/chat");
        }
      }
      invalidate();
      setResolved(true);
      onResolved?.();
    } catch (err) {
      toast({ title: "Action failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleDecline = async () => {
    if (!declined) {
      setDeclined(true);
      return;
    }
    // SHADOW mode: non-mutating — show simulation result without any real mutations.
    if (shadowMode) {
      toast({ title: "SHADOW preview", description: "Decline simulated — no changes were made." });
      setResolved(true);
      onResolved?.();
      return;
    }
    try {
      if (autopilot) {
        await dismissAutopilot.mutateAsync({ id: autopilot.id });
      } else if (card) {
        if (card.entityType === "work_request" && card.entityId) {
          await declineRequest.mutateAsync({ id: card.entityId, data: { reason: declineReason || undefined } });
        } else {
          await dismissFeed.mutateAsync({ data: { itemId: card.id } });
        }
      }
      invalidate();
      setResolved(true);
      onResolved?.();
      toast({ title: "Declined" });
    } catch (err) {
      toast({ title: "Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleViewDetails = () => {
    if (!card) return;
    if (card.entityType === "job" && card.entityId) navigate(`/jobs/${card.entityId}`);
    else if (card.entityType === "invoice" && card.entityId) navigate(`/invoices/${card.entityId}`);
    else if (card.queue === "bids") navigate("/pipeline");
    else navigate("/chat");
  };

  return (
    <div
      className="w-full rounded-[20px] overflow-hidden mb-3 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      style={{
        border: shadowMode ? "1px solid rgba(245,158,11,0.35)" : `1px solid ${accentColor}22`,
        borderLeft: shadowMode ? "3px solid rgba(245,158,11,0.65)" : undefined,
      }}
    >
      {/* Header stripe */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ background: shadowMode ? "linear-gradient(135deg, rgba(245,158,11,0.12), rgba(245,158,11,0.04))" : `linear-gradient(135deg, ${accentColor}18, ${accentColor}06)` }}
      >
        <div
          className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0"
          style={{ background: `${accentColor}20`, border: `1px solid ${accentColor}40` }}
        >
          <QueueIcon className="w-4 h-4" style={{ color: accentColor }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold tracking-[0.18em] uppercase mb-0.5" style={{ color: shadowMode ? "#F59E0B" : accentColor }}>
            {autopilot ? "Autopilot Suggestion" : "Decision Required"}
          </div>
          <div className="text-[14px] font-semibold text-white leading-tight truncate">{title}</div>
        </div>
        {shadowMode && (
          <div className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-[0.18em] uppercase bg-amber-500/15 text-amber-400 border border-amber-500/30 shrink-0">
            SHADOW
          </div>
        )}
        {amount != null && (
          <div className="shrink-0 text-right">
            <div className="text-[11px] text-white/40 uppercase tracking-wide mb-0.5">Amount</div>
            <div className="text-[15px] font-bold text-white">${amount.toLocaleString()}</div>
          </div>
        )}
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-7 h-7 rounded-full grid place-items-center text-white/40 hover:text-white/80 transition-colors shrink-0"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>
      {shadowMode && (
        <div className="px-4 py-1.5 bg-amber-500/5 border-b border-amber-500/12">
          <p className="text-[11px] text-amber-400/75">Proposed — not executed. SHADOW mode active.</p>
        </div>
      )}

      {/* Body */}
      <div className="bg-[#0A1628] px-4 py-4 space-y-3">
        {/* What */}
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/35 mb-1">What</div>
          <div className="text-[13.5px] text-white/80 leading-relaxed">{body}</div>
        </div>

        {/* Expanded detail */}
        {expanded && (
          <div className="space-y-3 pt-1 border-t border-white/8">
            {/* Policy + Falkon */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-white/4 rounded-[12px] p-3">
                <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 mb-1.5">Policy</div>
                <div className="text-[12px] text-white/70 leading-relaxed">Within normal operating bounds. No override required.</div>
              </div>
              <div className="bg-white/4 rounded-[12px] p-3">
                <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35 mb-1.5">Falkon</div>
                <div className="flex items-center gap-1.5 mb-1">
                  <div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: falkon.rec === "approve" ? "#22C55E" : falkon.rec === "decline" ? "#E11D48" : "#F59E0B" }}
                  />
                  <div className="text-[12px] font-semibold text-white/90 capitalize">{falkon.rec}</div>
                </div>
                <div className="text-[11px] text-white/50 leading-tight">{falkon.reason}</div>
              </div>
            </div>

            {/* Confidence */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-white/35">Confidence</div>
                <div className="text-[12px] font-bold text-white/80">{falkon.confidence}%</div>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${falkon.confidence}%`,
                    backgroundColor: falkon.confidence > 80 ? "#22C55E" : falkon.confidence > 60 ? "#F59E0B" : "#E11D48"
                  }}
                />
              </div>
            </div>

            {/* Shield indicator */}
            <div className="flex items-center gap-2 text-[11px] text-white/40">
              <Shield className="w-3 h-3" />
              <span>Falkon ASSISTED mode — approval required before action</span>
            </div>
          </div>
        )}

        {/* Decline reason input */}
        {declined && (
          <div>
            <div className="text-[11px] text-white/50 mb-1.5">Reason for declining (optional)</div>
            <input
              autoFocus
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Add a note…"
              className="w-full bg-white/6 border border-white/12 rounded-[10px] px-3 py-2 text-[13px] text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApprove}
            disabled={busy}
            className="flex-1 flex items-center justify-center gap-2 rounded-[12px] bg-[#B4FF44] text-black font-bold text-[13px] py-[11px] active:scale-[0.97] transition-transform disabled:opacity-60"
          >
            {busy && approveAutopilot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />}
            {shadowMode ? "Preview" : "Approve"}
          </button>
          <button
            onClick={handleDecline}
            disabled={busy}
            className={`flex-1 flex items-center justify-center gap-2 rounded-[12px] font-bold text-[13px] py-[11px] active:scale-[0.97] transition-all disabled:opacity-60 ${
              declined
                ? "bg-[#E11D48] text-white"
                : shadowMode
                  ? "bg-amber-500/10 border border-amber-500/25 text-amber-400/80"
                  : "bg-white/8 border border-white/12 text-white/70"
            }`}
          >
            {busy && dismissAutopilot.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" strokeWidth={2} />}
            {declined ? "Confirm decline" : shadowMode ? "Test" : "Decline"}
          </button>
          <button
            onClick={() => {
              if (onAskHalo) onAskHalo(title);
              else handleViewDetails();
            }}
            className="w-[42px] flex items-center justify-center rounded-[12px] bg-white/8 border border-white/12 text-white/60 hover:text-white/90 transition-colors active:scale-[0.97]"
            title="Ask HALO for more context"
          >
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
