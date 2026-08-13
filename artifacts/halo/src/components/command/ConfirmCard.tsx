/**
 * ConfirmCard — inline action-confirmation card rendered in the HaloCommand
 * thread after the voice/text parser returns a set of proposed actions.
 *
 * Primary CTA: white / black (consistent with the new Halo One design system).
 * Secondary (cancel): quiet ghost button.
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
        } as any,
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
    <div
      className="w-full rounded-[20px] overflow-hidden mb-3"
      style={{
        background: "linear-gradient(160deg, #080F1E 0%, #060C18 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.04)",
      }}
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/[0.05] flex items-center gap-3">
        <div className="w-7 h-7 rounded-[9px] bg-white/8 border border-white/12 grid place-items-center">
          <Sparkles className="w-3.5 h-3.5 text-white/70" />
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-white/55">
            HALO Proposal
          </div>
          <div className="text-[12.5px] text-white/75 font-medium">
            {actions.length} action{actions.length !== 1 ? "s" : ""} ready to confirm
          </div>
        </div>
      </div>

      {/* Actions list */}
      <div className="px-4 py-3.5 space-y-2">
        {actions.map((action, i) => {
          const meta = TOOL_META[action.tool] ?? { label: action.tool, Icon: Sparkles, color: "#B4FF44" };
          const { Icon } = meta;
          const fields = Object.entries(action.fields ?? {})
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .slice(0, 4);

          return (
            <div key={i} className="flex items-start gap-3 bg-white/[0.038] rounded-[13px] p-3.5">
              <div
                className="w-7 h-7 rounded-[9px] grid place-items-center shrink-0 mt-0.5"
                style={{ background: `${meta.color}18`, border: `1px solid ${meta.color}35` }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: meta.color }} strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white/88 mb-1.5">{meta.label}</div>
                {fields.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {fields.map(([k, v]) => {
                      const formatted = formatField(k, v);
                      if (!formatted) return null;
                      return (
                        <span
                          key={k}
                          className="text-[11px] bg-white/7 border border-white/[0.07] text-white/55 rounded-full px-2.5 py-0.5 font-medium"
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

      {/* CTA — white/black primary, ghost cancel */}
      <div className="px-4 pb-4 pt-1 flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={confirm.isPending}
          className="flex-1 flex items-center justify-center gap-2 rounded-[13px] bg-white text-[#0A0F1A] font-bold text-[13.5px] py-[11px] hover:bg-white/92 active:scale-[0.97] transition-all shadow-[0_2px_12px_rgba(255,255,255,0.12)] disabled:opacity-55"
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
          className="flex-[0.42] flex items-center justify-center gap-1.5 rounded-[13px] bg-white/5 border border-white/8 text-white/45 font-medium text-[13px] py-[11px] hover:text-white/65 hover:bg-white/8 active:scale-[0.97] transition-all disabled:opacity-55"
        >
          <X className="w-3.5 h-3.5" strokeWidth={2} />
          Cancel
        </button>
      </div>
    </div>
  );
}
