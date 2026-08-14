/**
 * DispatchCard — inline dispatch confirmation card.
 *
 * Shows current crew (if any) → proposed crew arrow layout,
 * job title, property, scheduled date.
 * White Confirm / Cancel buttons.
 * On confirm: calls dispatch endpoint, emits success state.
 *
 * Primary CTA: white / black. Ghost cancel.
 */

import { useState } from "react";
import { ArrowRight, CheckCircle2, X, Loader2, Users, CalendarDays, Building2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DispatchData {
  jobId: string;
  jobTitle: string;
  jobNo?: string | null;
  propertyName?: string | null;
  scheduledOn?: string | null;
  currentCrewName?: string | null;
  proposedCrewId: string;
  proposedCrewName: string;
  proposedCrewTrade?: string | null;
}

interface DispatchCardProps {
  data: DispatchData;
  onConfirm: (data: DispatchData) => Promise<void>;
  onCancel: () => void;
}

type DispatchState = "pending" | "confirming" | "done" | "error";

// ─── DispatchCard ─────────────────────────────────────────────────────────────

export function DispatchCard({ data, onConfirm, onCancel }: DispatchCardProps) {
  const [state, setState] = useState<DispatchState>("pending");
  const [errorMsg, setErrorMsg] = useState("");

  const handleConfirm = async () => {
    setState("confirming");
    try {
      await onConfirm(data);
      setState("done");
    } catch (err) {
      setErrorMsg((err as Error).message || "Dispatch failed");
      setState("error");
    }
  };

  if (state === "done") {
    return (
      <div
        className="flex items-center gap-3 rounded-[16px] px-4 py-3.5 mb-3"
        style={{
          background: "rgba(34,197,94,0.06)",
          border: "1px solid rgba(34,197,94,0.15)",
          animation: "hcFadeUp 0.2s ease-out both",
        }}
      >
        <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: "#22C55E" }} />
        <div>
          <div className="text-[13px] font-semibold" style={{ color: "rgba(34,197,94,0.9)" }}>
            {data.proposedCrewName} dispatched
          </div>
          <div className="text-[11px] text-white/38 mt-0.5">
            {data.jobTitle}{data.propertyName ? ` · ${data.propertyName}` : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-[18px] overflow-hidden mb-3"
      style={{
        background: "rgba(8,13,22,0.96)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
        animation: "hcFadeUp 0.2s ease-out both",
      }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/[0.04]">
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/35 mb-0.5">Dispatch Proposal</div>
        <div className="text-[14px] font-semibold text-white/88 leading-tight">{data.jobTitle}</div>
      </div>

      {/* Crew arrow */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-3 mb-4">
          {/* Current crew */}
          <div className="flex-1 rounded-[12px] px-3 py-2.5" style={{ background: "rgba(255,255,255,0.038)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-white/30 mb-1">Current Crew</div>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full grid place-items-center bg-white/8 text-[10px] text-white/45 shrink-0">
                {data.currentCrewName
                  ? data.currentCrewName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
                  : "—"}
              </div>
              <span className="text-[12px] text-white/55 font-medium">
                {data.currentCrewName ?? "Unassigned"}
              </span>
            </div>
          </div>

          {/* Arrow */}
          <ArrowRight className="w-4 h-4 shrink-0" style={{ color: "#B4FF44" }} strokeWidth={2.5} />

          {/* Proposed crew */}
          <div className="flex-1 rounded-[12px] px-3 py-2.5" style={{ background: "rgba(180,255,68,0.06)", border: "1px solid rgba(180,255,68,0.18)" }}>
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase mb-1" style={{ color: "rgba(180,255,68,0.55)" }}>Proposed</div>
            <div className="flex items-center gap-2">
              <div
                className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold shrink-0"
                style={{ background: "rgba(180,255,68,0.18)", border: "1px solid rgba(180,255,68,0.3)", color: "#B4FF44" }}
              >
                {data.proposedCrewName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-[12px] font-semibold text-white/85 truncate">{data.proposedCrewName}</div>
                {data.proposedCrewTrade && (
                  <div className="text-[10px] text-white/35 truncate">{data.proposedCrewTrade}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Job meta */}
        <div className="space-y-1.5 mb-4">
          {data.propertyName && (
            <div className="flex items-center gap-2 text-[11.5px] text-white/40">
              <Building2 className="w-3 h-3 shrink-0" strokeWidth={1.5} />
              <span>{data.propertyName}</span>
            </div>
          )}
          {data.scheduledOn && (
            <div className="flex items-center gap-2 text-[11.5px] text-white/40">
              <CalendarDays className="w-3 h-3 shrink-0" strokeWidth={1.5} />
              <span>{data.scheduledOn}</span>
            </div>
          )}
          {data.jobNo && (
            <div className="flex items-center gap-2 text-[11.5px] text-white/30">
              <span className="font-mono">#{data.jobNo}</span>
            </div>
          )}
        </div>

        {/* Error */}
        {state === "error" && (
          <div className="mb-3 text-[11.5px] text-[#E11D48]/80">{errorMsg}</div>
        )}

        {/* CTAs */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={state === "confirming"}
            className="flex-1 flex items-center justify-center gap-2 bg-white text-[#0A0F1A] font-bold text-[13px] py-[11px] rounded-[12px] hover:bg-white/92 active:scale-[0.97] transition-all disabled:opacity-55"
          >
            {state === "confirming"
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <CheckCircle2 className="w-4 h-4" strokeWidth={2.5} />
            }
            {state === "confirming" ? "Dispatching…" : "Confirm Dispatch"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={state === "confirming"}
            className="flex items-center justify-center px-4 py-[11px] rounded-[12px] text-[13px] text-white/40 font-medium active:scale-[0.97] transition-all"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
          >
            <X className="w-3.5 h-3.5" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
