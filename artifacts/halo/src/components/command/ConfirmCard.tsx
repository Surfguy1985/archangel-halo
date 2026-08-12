/**
 * ConfirmCard — inline action-confirmation card rendered in the HaloCommand
 * thread after the voice/text parser returns a set of proposed actions.
 *
 * Mirrors the review step in VoiceCaptureSheet but lives in the thread,
 * keeping the conversation flow unbroken.
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useConfirmVoice,
  getListJobsQueryKey,
  getListCrewsQueryKey,
  getListPropertiesQueryKey,
  getGetTodayQueryKey,
  getGetMoneySummaryQueryKey,
  type VoiceAction,
} from "@workspace/api-client-react";
import {
  Check,
  X,
  Loader2,
  Building2,
  UserPlus,
  Wrench,
  CalendarClock,
  Receipt,
  TrendingUp,
  StickyNote,
  CheckCheck,
  FileText,
  Truck,
  PackagePlus,
  Boxes,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Tool metadata ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; Icon: LucideIcon; color: string }> = {
  create_property:      { label: "New property",    Icon: Building2,     color: "#6366F1" },
  create_crew:          { label: "New crew member", Icon: UserPlus,      color: "#22C55E" },
  create_job:           { label: "New job",          Icon: Wrench,        color: "#F59E0B" },
  schedule_job:         { label: "Schedule job",     Icon: CalendarClock, color: "#3B82F6" },
  log_expense:          { label: "Log expense",      Icon: Receipt,       color: "#E11D48" },
  create_lead:          { label: "New lead",         Icon: TrendingUp,    color: "#8B5CF6" },
  create_bid:           { label: "New bid",          Icon: Sparkles,      color: "#B4FF44" },
  add_note:             { label: "Note",             Icon: StickyNote,    color: "#6B7280" },
  complete_job:         { label: "Complete job",     Icon: CheckCheck,    color: "#10B981" },
  create_invoice:       { label: "Draft invoice",    Icon: FileText,      color: "#F59E0B" },
  create_vendor:        { label: "New vendor",       Icon: Truck,         color: "#64748B" },
  add_inventory_item:   { label: "Track material",   Icon: PackagePlus,   color: "#0EA5E9" },
  adjust_inventory:     { label: "Stock update",     Icon: Boxes,         color: "#64748B" },
};

function formatField(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (key === "amount" || key === "unitCost") return `$${value}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ConfirmCardProps {
  logId: string;
  actions: VoiceAction[];
  onConfirmed: (result: string) => void;
  onCancelled: () => void;
}

export function ConfirmCard({ logId, actions, onConfirmed, onCancelled }: ConfirmCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const confirm = useConfirmVoice();
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const handleConfirm = async () => {
    try {
      await confirm.mutateAsync({
        data: {
          logId,
          selectedTools: actions.map(a => a.tool),
        },
      });
      qc.invalidateQueries({ queryKey: getListJobsQueryKey() });
      qc.invalidateQueries({ queryKey: getListCrewsQueryKey() });
      qc.invalidateQueries({ queryKey: getListPropertiesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
      qc.invalidateQueries({ queryKey: getGetMoneySummaryQueryKey() });

      setDismissed(true);
      onConfirmed(`Done — ${actions.map(a => TOOL_META[a.tool]?.label ?? a.tool).join(", ")}`);
    } catch (err) {
      toast({
        title: "Couldn't complete that",
        description: (err as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleCancel = () => {
    setDismissed(true);
    onCancelled();
  };

  return (
    <div className="w-full rounded-[18px] overflow-hidden bg-[#0D1E33] border border-[#B4FF44]/20 mb-3 shadow-[0_6px_24px_rgba(0,0,0,0.3)]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-white/8 flex items-center gap-2">
        <div className="w-7 h-7 rounded-[9px] bg-[#B4FF44]/15 border border-[#B4FF44]/30 grid place-items-center">
          <Sparkles className="w-3.5 h-3.5 text-[#B4FF44]" />
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-[0.15em] uppercase text-[#B4FF44]/80">
            HALO Proposal
          </div>
          <div className="text-[12px] text-white/50">
            {actions.length} action{actions.length !== 1 ? "s" : ""} to confirm
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 space-y-2">
        {actions.map((action, i) => {
          const meta = TOOL_META[action.tool] ?? { label: action.tool, Icon: Sparkles, color: "#B4FF44" };
          const { Icon } = meta;
          const fields = Object.entries(action.fields ?? {})
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .slice(0, 4);

          return (
            <div key={i} className="flex items-start gap-3 bg-white/4 rounded-[13px] p-3">
              <div
                className="w-7 h-7 rounded-[9px] grid place-items-center shrink-0 mt-0.5"
                style={{ background: `${meta.color}20`, border: `1px solid ${meta.color}40` }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white/90 mb-1">{meta.label}</div>
                {fields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {fields.map(([k, v]) => {
                      const formatted = formatField(k, v);
                      if (!formatted) return null;
                      return (
                        <span
                          key={k}
                          className="text-[11px] bg-white/8 text-white/60 rounded-full px-2 py-0.5 font-medium"
                        >
                          {formatted}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={confirm.isPending}
          className="flex-1 flex items-center justify-center gap-2 rounded-[12px] bg-[#B4FF44] text-black font-bold text-[13.5px] py-[11px] active:scale-[0.97] transition-transform disabled:opacity-60"
        >
          {confirm.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" strokeWidth={2.5} />
          )}
          {confirm.isPending ? "Working…" : "Confirm"}
        </button>
        <button
          onClick={handleCancel}
          disabled={confirm.isPending}
          className="flex-[0.45] flex items-center justify-center gap-2 rounded-[12px] bg-white/8 border border-white/12 text-white/60 font-bold text-[13.5px] py-[11px] active:scale-[0.97] transition-colors hover:text-white/80 disabled:opacity-60"
        >
          <X className="w-4 h-4" strokeWidth={2} />
          Cancel
        </button>
      </div>
    </div>
  );
}
