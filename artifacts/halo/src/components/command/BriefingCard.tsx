/**
 * BriefingCard — inline morning briefing / planning query result card.
 *
 * Rendered in the HALO Command thread whenever the user asks:
 * "Structure my day", "What needs me?", "Morning brief", etc.
 *
 * - Groups items by tier: Now / Today / This Week
 * - Each row: category badge · title · one-line body · amount · SLA flag · action button
 * - "Team vs personal" split mode renders two columns
 * - All primary CTAs: white bg / black text
 */

import { useState } from "react";
import { useGetToday } from "@workspace/api-client-react";
import {
  AlertCircle,
  Clock,
  DollarSign,
  FileText,
  Zap,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Users,
  CheckCircle2,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BriefItem {
  id: string;
  tier: "now" | "today" | "week";
  category: string;
  title: string;
  body: string;
  amount?: number | null;
  slaFlag?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  queue?: string | null;
  /** Suggested action label for the primary CTA */
  actionLabel?: string;
  /** Pre-filled command to inject into handleSubmit when action is clicked */
  actionCommand?: string;
}

interface BriefingCardProps {
  items: BriefItem[];
  /** "team-vs-personal" splits into two columns */
  mode?: "default" | "team-vs-personal";
  onAction: (command: string) => void;
  onDismiss?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_CONFIG = {
  now:   { label: "Now",       color: "#E11D48", bg: "rgba(225,29,72,0.09)",   border: "rgba(225,29,72,0.18)" },
  today: { label: "Today",     color: "#F59E0B", bg: "rgba(245,158,11,0.07)", border: "rgba(245,158,11,0.14)" },
  week:  { label: "This Week", color: "#6366F1", bg: "rgba(99,102,241,0.07)",  border: "rgba(99,102,241,0.14)" },
};

const CATEGORY_ICONS: Record<string, typeof AlertCircle> = {
  money:   DollarSign,
  invoice: FileText,
  margin:  AlertCircle,
  bids:    Zap,
  crew:    Users,
  job:     CheckCircle2,
  default: Clock,
};

function getCategoryIcon(cat?: string | null) {
  if (!cat) return CATEGORY_ICONS.default;
  return CATEGORY_ICONS[cat.toLowerCase()] ?? CATEGORY_ICONS.default;
}

function getCategoryColor(cat?: string | null): string {
  const map: Record<string, string> = {
    money: "#E11D48", invoice: "#B4FF44", margin: "#F59E0B",
    bids: "#6366F1", crew: "#22C55E", job: "#3B82F6",
  };
  return map[cat?.toLowerCase() ?? ""] ?? "#B4FF44";
}

function getActionLabel(item: BriefItem): string {
  if (item.actionLabel) return item.actionLabel;
  switch (item.queue ?? item.category?.toLowerCase()) {
    case "money":   return "Send Reminder";
    case "invoice": return "View Invoice";
    case "bids":    return "Nudge Client";
    case "margin":  return "Review Pricing";
    case "job":     return "Open Job";
    default:        return "Handle";
  }
}

function getActionCommand(item: BriefItem): string {
  if (item.actionCommand) return item.actionCommand;
  if (item.entityId && item.entityType === "invoice")
    return `Show invoice ${item.entityId}`;
  if (item.entityId && item.entityType === "job")
    return `Show job ${item.entityId}`;
  return `Tell me more about: ${item.title}`;
}

// ─── Single briefing row ──────────────────────────────────────────────────────

function BriefRow({ item, onAction }: { item: BriefItem; onAction: (cmd: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getCategoryIcon(item.queue ?? item.category);
  const iconColor = getCategoryColor(item.queue ?? item.category);
  const tierConf = TIER_CONFIG[item.tier];

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.055)" }}
    >
      <div className="px-3.5 py-3 flex items-start gap-3">
        {/* Icon */}
        <div
          className="w-7 h-7 rounded-[8px] grid place-items-center shrink-0 mt-0.5"
          style={{ background: `${iconColor}18`, border: `1px solid ${iconColor}30` }}
        >
          <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} strokeWidth={2} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            {/* Tier badge */}
            <span
              className="text-[8.5px] font-bold tracking-[0.15em] uppercase px-2 py-0.5 rounded-full"
              style={{ background: tierConf.bg, color: tierConf.color, border: `1px solid ${tierConf.border}` }}
            >
              {tierConf.label}
            </span>
            {/* Category badge */}
            <span className="text-[9px] text-white/30 uppercase tracking-wider font-semibold">
              {item.category ?? item.queue ?? "general"}
            </span>
            {/* SLA flag */}
            {item.slaFlag && (
              <span className="text-[9px] text-[#E11D48]/80 font-semibold">⚠ {item.slaFlag}</span>
            )}
          </div>

          <div className="text-[12.5px] text-white/85 font-semibold leading-snug">{item.title}</div>

          {/* Body — expandable */}
          <p className="text-[11.5px] text-white/45 leading-relaxed mt-0.5 line-clamp-2">
            {item.body}
          </p>

          {expanded && item.body.length > 80 && (
            <p className="text-[11.5px] text-white/45 leading-relaxed mt-0.5">{item.body}</p>
          )}

          {/* Amount + action row */}
          <div className="flex items-center gap-2 mt-2.5">
            {item.amount != null && (
              <span className="text-[12px] font-bold tabular-nums" style={{ color: iconColor }}>
                ${item.amount.toLocaleString()}
              </span>
            )}
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => onAction(getActionCommand(item))}
              className="flex items-center gap-1.5 px-3 py-[5px] rounded-[9px] bg-white text-[#07101E] text-[11.5px] font-bold hover:bg-white/92 active:scale-[0.97] transition-all"
            >
              {getActionLabel(item)}
              <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Expand chevron for long body */}
        {item.body.length > 80 && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="w-6 h-6 grid place-items-center shrink-0 text-white/25 hover:text-white/55 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Tier section ─────────────────────────────────────────────────────────────

function TierSection({ tier, items, onAction }: {
  tier: "now" | "today" | "week";
  items: BriefItem[];
  onAction: (cmd: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;
  const conf = TIER_CONFIG[tier];
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="flex items-center gap-2 w-full group"
      >
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: conf.color }} />
        <span
          className="text-[9px] font-bold tracking-[0.18em] uppercase"
          style={{ color: conf.color }}
        >
          {conf.label}
        </span>
        <span className="text-[9px] text-white/25 ml-1">({items.length})</span>
        <div className="flex-1" />
        {collapsed
          ? <ChevronDown className="w-3 h-3 text-white/25" />
          : <ChevronUp   className="w-3 h-3 text-white/25" />}
      </button>
      {!collapsed && (
        <div className="space-y-1.5">
          {items.map(item => <BriefRow key={item.id} item={item} onAction={onAction} />)}
        </div>
      )}
    </div>
  );
}

// ─── Team-vs-personal split ───────────────────────────────────────────────────

function TeamVsPersonalView({ items, onAction }: { items: BriefItem[]; onAction: (cmd: string) => void }) {
  // "Your attention": items needing decision/approval, financial threshold, SLA risk
  // "Team can handle": items assigned with active crew or below auto-threshold
  const myItems = items.filter(item =>
    item.tier === "now" ||
    (item.amount != null && item.amount > 1000) ||
    item.slaFlag != null ||
    ["money", "margin"].includes(item.queue ?? "")
  );
  const teamItems = items.filter(item => !myItems.includes(item));

  return (
    <div className="space-y-4">
      {/* Your attention */}
      <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid rgba(225,29,72,0.2)" }}>
        <div className="px-3.5 py-2.5 border-b border-white/[0.04]" style={{ background: "rgba(225,29,72,0.07)" }}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48] animate-pulse" />
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#E11D48]/85">Your attention required</span>
            <span className="text-[9px] text-white/25 ml-1">({myItems.length})</span>
          </div>
        </div>
        <div className="p-2.5 space-y-1.5">
          {myItems.length === 0
            ? <div className="text-[12px] text-white/35 py-2 text-center">Nothing needs you personally right now.</div>
            : myItems.map(item => <BriefRow key={item.id} item={item} onAction={onAction} />)
          }
        </div>
      </div>

      {/* Team can handle */}
      <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid rgba(34,197,94,0.2)" }}>
        <div className="px-3.5 py-2.5 border-b border-white/[0.04]" style={{ background: "rgba(34,197,94,0.06)" }}>
          <div className="flex items-center gap-2">
            <Users className="w-3 h-3 text-[#22C55E]/70" />
            <span className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#22C55E]/85">Team can handle</span>
            <span className="text-[9px] text-white/25 ml-1">({teamItems.length})</span>
          </div>
        </div>
        <div className="p-2.5 space-y-1.5">
          {teamItems.length === 0
            ? <div className="text-[12px] text-white/35 py-2 text-center">All items need your personal attention.</div>
            : teamItems.map(item => <BriefRow key={item.id} item={item} onAction={onAction} />)
          }
        </div>
      </div>
    </div>
  );
}

// ─── BriefingCard (main export) ───────────────────────────────────────────────

export function BriefingCard({ items, mode = "default", onAction, onDismiss }: BriefingCardProps) {
  const nowItems   = items.filter(i => i.tier === "now");
  const todayItems = items.filter(i => i.tier === "today");
  const weekItems  = items.filter(i => i.tier === "week");

  if (items.length === 0) {
    return (
      <div
        className="w-full rounded-[18px] overflow-hidden mb-3"
        style={{ background: "rgba(10,16,28,0.92)", border: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="px-4 py-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <span className="text-[13px] font-semibold text-white/80">You're clear</span>
          </div>
          <p className="text-[12.5px] text-white/45 leading-relaxed">
            No urgent items right now. The team looks good.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full rounded-[18px] overflow-hidden mb-3"
      style={{ background: "rgba(8,13,22,0.96)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}
    >
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-white/[0.04] flex items-center gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/35 mb-0.5">
            {mode === "team-vs-personal" ? "Priority Breakdown" : "Morning Brief"}
          </div>
          <div className="text-[13.5px] font-semibold text-white/88">
            {nowItems.length > 0 && (
              <span style={{ color: "#E11D48" }}>{nowItems.length} now</span>
            )}
            {nowItems.length > 0 && todayItems.length > 0 && <span className="text-white/30"> · </span>}
            {todayItems.length > 0 && (
              <span style={{ color: "#F59E0B" }}>{todayItems.length} today</span>
            )}
            {(nowItems.length > 0 || todayItems.length > 0) && weekItems.length > 0 && <span className="text-white/30"> · </span>}
            {weekItems.length > 0 && (
              <span style={{ color: "#6366F1" }}>{weekItems.length} this week</span>
            )}
          </div>
        </div>
        <div className="flex-1" />
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[11px] text-white/25 hover:text-white/50 transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Body */}
      <div className="px-4 py-3.5 space-y-4">
        {mode === "team-vs-personal" ? (
          <TeamVsPersonalView items={items} onAction={onAction} />
        ) : (
          <>
            <TierSection tier="now"   items={nowItems}   onAction={onAction} />
            <TierSection tier="today" items={todayItems} onAction={onAction} />
            <TierSection tier="week"  items={weekItems}  onAction={onAction} />
          </>
        )}
      </div>

      {/* Footer prompt chips */}
      <div className="px-4 pb-4 flex flex-wrap gap-2">
        {["What needs me personally?", "Run my morning", "Show unpaid invoices"].map(q => (
          <button
            key={q}
            type="button"
            onClick={() => onAction(q)}
            className="text-[11px] text-white/30 px-3 py-1.5 rounded-full transition-all hover:text-white/55"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Hook to convert Today feed to BriefItems ─────────────────────────────────

export function useBriefingItems(): { items: BriefItem[]; loading: boolean } {
  const { data: today, isLoading } = useGetToday();
  const feed = (today?.feed ?? []) as any[];
  const items: BriefItem[] = feed.map((card: any) => ({
    id: card.id ?? String(Math.random()),
    tier: (card.tier === "now" ? "now" : card.tier === "today" ? "today" : "week") as BriefItem["tier"],
    category: card.queue ?? "general",
    queue: card.queue,
    title: card.title ?? "—",
    body: card.sub ?? card.body ?? "",
    amount: card.amount ?? null,
    slaFlag: card.slaFlag ?? card.moveInRisk ?? null,
    entityId: card.entityId ?? null,
    entityType: card.entityType ?? null,
  }));
  return { items, loading: isLoading };
}

// ─── Compact "Now strip" for seed state ───────────────────────────────────────

export function NowStrip({ count, onExpand }: { count: number; onExpand: () => void }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex items-center gap-2.5 rounded-[12px] px-4 py-2.5 w-full active:scale-[0.98] transition-all"
      style={{ background: "rgba(225,29,72,0.07)", border: "1px solid rgba(225,29,72,0.18)" }}
    >
      <div className="w-2 h-2 rounded-full bg-[#E11D48] animate-pulse shrink-0" />
      <span className="text-[12.5px] font-semibold text-white/80 flex-1 text-left">
        <span className="text-[#E11D48]">{count} item{count !== 1 ? "s" : ""}</span> need your attention now
      </span>
      <span className="text-[11px] text-white/30 hover:text-white/55">See all →</span>
    </button>
  );
}

// ─── Loading state for BriefingCard ──────────────────────────────────────────

export function BriefingCardLoading() {
  return (
    <div
      className="w-full rounded-[18px] px-4 py-5 mb-3 flex items-center gap-3"
      style={{ background: "rgba(8,13,22,0.92)", border: "1px solid rgba(255,255,255,0.06)" }}
    >
      <Loader2 className="w-4 h-4 animate-spin shrink-0" style={{ color: "rgba(180,255,68,0.5)" }} />
      <span className="text-[13px] text-white/40">Loading your briefing…</span>
    </div>
  );
}
