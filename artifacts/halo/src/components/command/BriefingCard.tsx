/**
 * BriefingCard — rich daily briefing injected as the first chat message.
 *
 * Renders greeting, attention items, approval queue (with inline approve/reject),
 * economics grid, and suggested prompts. SHADOW mode surfaces approval cards
 * with "SHADOW — would approve" labels instead of live buttons.
 */

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Briefcase,
  ChevronRight,
  X,
  Sparkles,
  Shield,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BriefingItem {
  id: string;
  label: string;
  subtext?: string;
  urgency: "critical" | "warn" | "info";
  action?: { label: string; url: string };
  entityType?: string;
  entityId?: string;
}

export interface BriefingSection {
  kind: "attention" | "approvals" | "active_jobs" | "health" | "exceptions" | "economics";
  title: string;
  badge?: number;
  items: BriefingItem[];
  summary?: string;
}

export interface BriefingData {
  greeting: string;
  date: string;
  sections: BriefingSection[];
  economics: {
    mtdRevenue: number;
    mtdCollected: number;
    openReceivables: number;
    activeJobCount: number;
    avgMarginPct: number;
    flaggedJobs: number;
  };
  suggestedPrompts: string[];
}

export interface ApprovalCard {
  id: string;
  kind: string;
  title: string;
  entityLabel: string;
  amount?: number;
  riskLevel: "low" | "medium" | "high";
  context: string;
  approveUrl: string;
  rejectUrl: string;
}

export interface AttentionItem extends BriefingItem {
  queue?: string;
  amount?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt$ = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${Math.round(n / 1_000)}K`
    : `$${Math.round(n).toLocaleString()}`;

const fmtDate = (iso: string) => {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
};

const URGENCY_DOT: Record<string, string> = {
  critical: "bg-[#E11D48]",
  warn: "bg-[#F59E0B]",
  info: "bg-[#60A5FA]",
};

const RISK_BADGE: Record<string, string> = {
  low: "text-[#22C55E] bg-[#22C55E]/10 border-[#22C55E]/25",
  medium: "text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/25",
  high: "text-[#E11D48] bg-[#E11D48]/10 border-[#E11D48]/25",
};

// ─── Approval row with inline approve/reject ──────────────────────────────────

function ApprovalRow({
  approval,
  shadowMode,
  onSettled,
}: {
  approval: ApprovalCard;
  shadowMode: boolean;
  onSettled: (id: string, action: "approved" | "rejected") => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const act = async (url: string, which: "approve" | "reject") => {
    if (busy) return;
    setBusy(which);
    setErr(null);
    try {
      const res = await fetch(url, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr((body as { error?: string }).error ?? `Failed (${res.status})`);
        setBusy(null);
        return;
      }
      onSettled(approval.id, which === "approve" ? "approved" : "rejected");
    } catch {
      setErr("Network error — try again");
      setBusy(null);
    }
  };

  return (
    <div className="py-2.5 border-b border-white/[0.06] last:border-b-0">
      <div className="flex items-start gap-2 mb-1.5">
        <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${URGENCY_DOT.warn}`} />
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] text-white/88 font-medium leading-tight">{approval.title}</div>
          {approval.context && (
            <div className="text-[11px] text-white/42 mt-0.5 leading-snug">{approval.context}</div>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[10px] font-medium border rounded-full px-1.5 py-px ${RISK_BADGE[approval.riskLevel]}`}>
              {approval.riskLevel} risk
            </span>
          </div>
        </div>
      </div>

      {err && (
        <div className="ml-3.5 mb-1 text-[10.5px] text-[#E11D48]/80">{err}</div>
      )}
      {shadowMode ? (
        <div className="ml-3.5 flex items-center gap-1.5 text-[10.5px] text-[#F59E0B]/80 bg-[#F59E0B]/6 border border-[#F59E0B]/18 rounded-[6px] px-2.5 py-1">
          <Shield className="w-3 h-3 shrink-0" />
          SHADOW — would approve in LIVE mode
        </div>
      ) : (
        <div className="ml-3.5 flex gap-1.5">
          <button
            onClick={() => act(approval.approveUrl, "approve")}
            disabled={!!busy}
            className="flex-1 text-[11px] font-medium bg-[#22C55E]/12 text-[#22C55E] border border-[#22C55E]/25 rounded-[7px] py-1.5 hover:bg-[#22C55E]/20 transition-colors disabled:opacity-40"
          >
            {busy === "approve" ? "…" : "Approve"}
          </button>
          <button
            onClick={() => act(approval.rejectUrl, "reject")}
            disabled={!!busy}
            className="flex-1 text-[11px] font-medium bg-white/5 text-white/55 border border-white/10 rounded-[7px] py-1.5 hover:bg-white/8 transition-colors disabled:opacity-40"
          >
            {busy === "reject" ? "…" : "Dismiss"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── BriefingCard (main export) ───────────────────────────────────────────────

export function BriefingCard({
  data,
  shadowMode = false,
  onPrompt,
}: {
  data: BriefingData;
  shadowMode?: boolean;
  onPrompt: (text: string) => void;
}) {
  const [dismissedApprovals, setDismissedApprovals] = useState<Set<string>>(new Set());
  const [allClear, setAllClear] = useState(false);

  const handleApprovalSettled = (id: string, _action: "approved" | "rejected") => {
    setDismissedApprovals(prev => {
      const next = new Set(prev);
      next.add(id);
      // Check if all approvals are settled
      const approvalSection = data.sections.find(s => s.kind === "approvals");
      const total = approvalSection?.items.length ?? 0;
      if (next.size >= total) setAllClear(true);
      return next;
    });
  };

  const attentionSection = data.sections.find(s => s.kind === "attention");
  const approvalSection = data.sections.find(s => s.kind === "approvals");
  const healthSection = data.sections.find(s => s.kind === "health");

  const eco = data.economics;
  const marginPct = Math.round((eco.avgMarginPct ?? 0) * 100);

  return (
    <div
      className="rounded-[14px] border border-white/[0.09] overflow-hidden mb-3 hc-msg"
      style={{ background: "rgba(12,18,34,0.92)", animation: "hcMsgIn 0.28s ease-out both" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.07]">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[14.5px] font-semibold text-white/92 leading-tight">{data.greeting}</div>
            <div className="text-[11.5px] text-white/38 mt-0.5">{fmtDate(data.date)}</div>
          </div>
          <div className="w-7 h-7 rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-[#B4FF44]" />
          </div>
        </div>
      </div>

      {/* ── Attention Section ────────────────────────────────────────────────── */}
      {attentionSection && attentionSection.items.length > 0 && (
        <div className="border-b border-white/[0.07]">
          <div className="px-4 pt-2.5 pb-1 flex items-center gap-2">
            <AlertTriangle className="w-[11px] h-[11px] text-[#F59E0B]" />
            <span className="text-[10.5px] font-semibold text-white/45 tracking-wide uppercase">{attentionSection.title}</span>
            {attentionSection.badge != null && attentionSection.badge > 0 && (
              <span className="ml-auto text-[10px] font-bold bg-[#E11D48] text-white rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
                {attentionSection.badge}
              </span>
            )}
          </div>
          <div className="px-4 pb-2.5">
            {attentionSection.items.map(item => (
              <div key={item.id} className="flex items-start gap-2 py-2 border-b border-white/[0.05] last:border-b-0">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${URGENCY_DOT[item.urgency]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] text-white/82 font-medium leading-tight">{item.label}</div>
                  {item.subtext && (
                    <div className="text-[11px] text-white/38 mt-0.5 leading-snug">{item.subtext}</div>
                  )}
                </div>
                {item.action && (
                  // Actions from computeQueues are command identifiers, not URLs.
                  // Route them through the chat composer so HALO handles them.
                  <button
                    onClick={() => onPrompt(`${item.action!.label}: ${item.label}`)}
                    className="text-[10.5px] text-[#B4FF44]/80 font-medium flex items-center gap-0.5 shrink-0 hover:text-[#B4FF44] transition-colors"
                  >
                    {item.action.label}
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Approvals Section ────────────────────────────────────────────────── */}
      {approvalSection && approvalSection.items.length > 0 && (
        <div className="border-b border-white/[0.07]">
          <div className="px-4 pt-2.5 pb-1 flex items-center gap-2">
            <CheckCircle2 className="w-[11px] h-[11px] text-[#60A5FA]" />
            <span className="text-[10.5px] font-semibold text-white/45 tracking-wide uppercase">{approvalSection.title}</span>
            {approvalSection.badge != null && approvalSection.badge > 0 && !allClear && (
              <span className="ml-auto text-[10px] font-bold bg-[#60A5FA] text-[#080D17] rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center">
                {approvalSection.badge - dismissedApprovals.size}
              </span>
            )}
          </div>
          <div className="px-4 pb-2.5">
            {allClear ? (
              <div className="flex items-center gap-2 py-2 text-[12px] text-[#22C55E]/80">
                <CheckCircle2 className="w-[13px] h-[13px] shrink-0" />
                All clear — nothing left waiting for you. 🎉
              </div>
            ) : (
              approvalSection.items
                .filter(item => !dismissedApprovals.has(item.id))
                .map(item => (
                  <ApprovalRow
                    key={item.id}
                    approval={{
                      id: item.id,
                      kind: item.entityType ?? "action",
                      title: item.label,
                      entityLabel: item.subtext ?? "",
                      riskLevel: "medium",
                      context: item.subtext ?? "",
                      approveUrl: `/api/autopilot/actions/${item.id}/approve`,
                      rejectUrl: `/api/autopilot/actions/${item.id}/dismiss`,
                    }}
                    shadowMode={shadowMode}
                    onSettled={handleApprovalSettled}
                  />
                ))
            )}
          </div>
        </div>
      )}

      {/* ── Economics Grid ───────────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.07]">
        <div className="px-4 pt-2.5 pb-1 flex items-center gap-2">
          <TrendingUp className="w-[11px] h-[11px] text-[#B4FF44]" />
          <span className="text-[10.5px] font-semibold text-white/45 tracking-wide uppercase">Business Health</span>
          {eco.flaggedJobs > 0 && (
            <span className="ml-auto text-[10px] font-medium text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/25 rounded-full px-1.5 py-px">
              {eco.flaggedJobs} at risk
            </span>
          )}
        </div>
        <div className="px-4 pb-3 grid grid-cols-2 gap-x-4 gap-y-2.5">
          <div>
            <div className="text-[10px] text-white/32 uppercase tracking-wide">MTD Revenue</div>
            <div className="text-[15px] font-semibold text-white/88 mt-0.5">{fmt$(eco.mtdRevenue)}</div>
          </div>
          <div>
            <div className="text-[10px] text-white/32 uppercase tracking-wide">Open Receivables</div>
            <div className="text-[15px] font-semibold text-white/88 mt-0.5">{fmt$(eco.openReceivables)}</div>
          </div>
          <div>
            <div className="text-[10px] text-white/32 uppercase tracking-wide">Avg Margin</div>
            <div className={`text-[15px] font-semibold mt-0.5 ${marginPct >= 25 ? "text-white/88" : "text-[#F59E0B]"}`}>
              {marginPct}%
            </div>
          </div>
          <div>
            <div className="text-[10px] text-white/32 uppercase tracking-wide">Active Jobs</div>
            <div className="text-[15px] font-semibold text-white/88 mt-0.5">{eco.activeJobCount}</div>
          </div>
        </div>
      </div>

      {/* ── Suggested Prompts ─────────────────────────────────────────────────── */}
      {data.suggestedPrompts.length > 0 && (
        <div className="px-4 py-3">
          <div className="text-[10px] text-white/28 uppercase tracking-wide mb-2">Ask me anything</div>
          <div className="flex flex-col gap-1.5">
            {data.suggestedPrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => onPrompt(p)}
                className="text-left text-[12px] text-white/55 bg-white/[0.04] border border-white/[0.07] rounded-[8px] px-3 py-2 hover:bg-white/[0.07] hover:text-white/75 transition-colors flex items-center justify-between gap-2"
              >
                <span>"{p}"</span>
                <ChevronRight className="w-3 h-3 shrink-0 opacity-40" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
