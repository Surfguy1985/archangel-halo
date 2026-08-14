/**
 * ReminderCard — inline reminder confirmation and due-reminder surfacing.
 *
 * Two modes:
 * 1. Post-confirm: "Reminder set: follow up on Job 247, Tuesday 9 am"
 * 2. Due-reminder resurfacing: shows entity badge, text, time, Dismiss/Snooze
 *
 * Primary CTA: white / black. Ghost cancel.
 */

import { useState, useCallback } from "react";
import { Bell, Clock, X, AlarmClock, CheckCircle2, Building2, FileText, Users, Loader2 } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReminderData {
  id: string;
  text: string;
  dueAt: string | null;
  entityType?: string | null;
  entityLabel?: string | null;
  /** "set" = just created, "due" = surfaced because it's due */
  mode: "set" | "due";
}

interface ReminderCardProps {
  reminder: ReminderData;
  onDismiss: (id: string) => Promise<void>;
  onSnooze?: (id: string) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getEntityIcon(entityType?: string | null) {
  switch (entityType) {
    case "property": return Building2;
    case "invoice":  return FileText;
    case "crew":     return Users;
    default:         return Bell;
  }
}

function formatDue(dueAt: string | null): string {
  if (!dueAt) return "No date set";
  try {
    const d = new Date(dueAt);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 0) return `Overdue by ${Math.abs(diffMin)} min`;
    if (diffMin < 60) return `In ${diffMin} min`;
    if (diffMin < 1440) return `Today at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return dueAt;
  }
}

// ─── ReminderCard ─────────────────────────────────────────────────────────────

export function ReminderCard({ reminder, onDismiss, onSnooze }: ReminderCardProps) {
  const [actionState, setActionState] = useState<"idle" | "dismissing" | "snoozing" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const Icon = getEntityIcon(reminder.entityType);
  const isDue = reminder.mode === "due";

  const handleDismiss = useCallback(async () => {
    setActionState("dismissing");
    setErrorMsg("");
    try {
      await onDismiss(reminder.id);
      // Parent replaces the card on success — no local setDismissed needed
    } catch {
      setActionState("error");
      setErrorMsg("Couldn't dismiss — tap to retry.");
    }
  }, [onDismiss, reminder.id]);

  const handleSnooze = useCallback(async () => {
    if (!onSnooze) return;
    setActionState("snoozing");
    setErrorMsg("");
    try {
      await onSnooze(reminder.id);
    } catch {
      setActionState("error");
      setErrorMsg("Couldn't snooze — tap to retry.");
    }
  }, [onSnooze, reminder.id]);

  if (reminder.mode === "set") {
    return (
      <div
        className="flex items-start gap-3 rounded-[16px] px-4 py-3.5 mb-3"
        style={{
          background: "rgba(180,255,68,0.05)",
          border: "1px solid rgba(180,255,68,0.14)",
          animation: "hcFadeUp 0.2s ease-out both",
        }}
      >
        <div
          className="w-7 h-7 rounded-[8px] grid place-items-center shrink-0 mt-0.5"
          style={{ background: "rgba(180,255,68,0.12)", border: "1px solid rgba(180,255,68,0.22)" }}
        >
          <Bell className="w-3.5 h-3.5" style={{ color: "#B4FF44" }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase mb-0.5" style={{ color: "rgba(180,255,68,0.65)" }}>
            Reminder Set
          </div>
          <div className="text-[13px] text-white/82 font-medium leading-snug">{reminder.text}</div>
          {reminder.entityLabel && (
            <div className="flex items-center gap-1.5 mt-1">
              <Icon className="w-3 h-3 text-white/30" strokeWidth={1.5} />
              <span className="text-[11px] text-white/38">{reminder.entityLabel}</span>
            </div>
          )}
          {reminder.dueAt && (
            <div className="flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3 h-3 text-white/30" strokeWidth={1.5} />
              <span className="text-[11px] text-white/38">{formatDue(reminder.dueAt)}</span>
            </div>
          )}
          {actionState === "error" && (
            <div className="text-[10px] text-[#E11D48]/75 mt-1">{errorMsg}</div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleDismiss()}
          disabled={actionState === "dismissing"}
          aria-label={actionState === "dismissing" ? "Dismissing…" : "Dismiss reminder"}
          className="w-6 h-6 grid place-items-center text-white/22 hover:text-white/55 transition-colors shrink-0 disabled:opacity-40"
        >
          {actionState === "dismissing"
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : actionState === "error"
              ? <X className="w-3.5 h-3.5 text-[#E11D48]/60" />
              : <X className="w-3.5 h-3.5" />
          }
        </button>
      </div>
    );
  }

  // "due" mode — more prominent, actionable
  return (
    <div
      className="w-full rounded-[18px] overflow-hidden mb-3"
      style={{
        background: "rgba(8,13,22,0.96)",
        border: isDue ? "1px solid rgba(245,158,11,0.3)" : "1px solid rgba(255,255,255,0.07)",
        borderLeft: isDue ? "3px solid rgba(245,158,11,0.65)" : undefined,
        boxShadow: isDue ? "0 8px 32px rgba(245,158,11,0.08)" : "0 8px 32px rgba(0,0,0,0.3)",
        animation: "hcFadeUp 0.2s ease-out both",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 border-b border-white/[0.04] flex items-center gap-3"
        style={{ background: isDue ? "rgba(245,158,11,0.05)" : undefined }}
      >
        <div
          className="w-7 h-7 rounded-[8px] grid place-items-center shrink-0"
          style={{
            background: isDue ? "rgba(245,158,11,0.12)" : "rgba(180,255,68,0.10)",
            border: isDue ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(180,255,68,0.20)",
          }}
        >
          <Bell className="w-3.5 h-3.5" style={{ color: isDue ? "#F59E0B" : "#B4FF44" }} strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[10px] font-bold tracking-[0.18em] uppercase mb-0.5"
            style={{ color: isDue ? "rgba(245,158,11,0.75)" : "rgba(180,255,68,0.65)" }}
          >
            {isDue ? "Reminder Due" : "Reminder Set"}
          </div>
          <div className="text-[13.5px] font-semibold text-white/88 leading-tight">{reminder.text}</div>
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        {reminder.entityLabel && (
          <div className="flex items-center gap-2 text-[12px] text-white/45">
            <Icon className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
            <span>{reminder.entityLabel}</span>
          </div>
        )}
        {reminder.dueAt && (
          <div className="flex items-center gap-2 text-[12px] text-white/45">
            <Clock className="w-3.5 h-3.5 shrink-0" strokeWidth={1.5} />
            <span>{formatDue(reminder.dueAt)}</span>
          </div>
        )}

        {/* Error */}
        {actionState === "error" && (
          <div className="text-[11px] text-[#E11D48]/80 pt-0.5">{errorMsg}</div>
        )}

        {/* CTAs */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={() => void handleDismiss()}
            disabled={actionState === "dismissing" || actionState === "snoozing"}
            aria-label={actionState === "dismissing" ? "Dismissing reminder…" : "Mark reminder done"}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white text-[#0A0F1A] font-bold text-[12.5px] py-[10px] rounded-[12px] hover:bg-white/92 active:scale-[0.97] transition-all disabled:opacity-55 focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
          >
            {actionState === "dismissing"
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5" strokeWidth={2.5} />
            }
            {actionState === "dismissing" ? "Dismissing…" : "Done"}
          </button>
          {onSnooze && (
            <button
              type="button"
              onClick={() => void handleSnooze()}
              disabled={actionState === "dismissing" || actionState === "snoozing"}
              aria-label={actionState === "snoozing" ? "Snoozing reminder…" : "Snooze reminder 1 hour"}
              className="flex items-center justify-center gap-1.5 px-4 py-[10px] rounded-[12px] text-[12.5px] font-medium text-white/45 active:scale-[0.97] transition-all disabled:opacity-55 focus-visible:ring-2 focus-visible:ring-white/40 outline-none"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {actionState === "snoozing"
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Clock className="w-3.5 h-3.5" strokeWidth={2} />
              }
              +1h
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
