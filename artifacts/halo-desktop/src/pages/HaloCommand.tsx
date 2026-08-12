/**
 * HALO Command — Desktop conversational operating system.
 *
 * Rendered inside DesktopLayout (sidebar nav stays visible for expert access).
 * The main content area becomes a full-height conversational workspace.
 * Falkon-mode-aware, role-responsive, and backed by the same API as
 * the legacy Today screen.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Mic,
  Send,
  Footprints,
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  Plus,
  X,
  Zap,
} from "lucide-react";

import {
  useGetToday,
  useListAutopilotActions,
  useParseVoice,
  useGetMoneySummary,
  useListJobs,
  useListCrews,
  getGetTodayQueryKey,
  getListAutopilotActionsQueryKey,
  getGetMoneySummaryQueryKey,
  getListJobsQueryKey,
  type FeedCard as FeedCardType,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

import { HaloRing } from "@/components/HaloRing";
import { VoiceCaptureDialog } from "@/components/VoiceCaptureDialog";
import { DecisionPacket } from "@/components/command/DecisionPacket";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { LensCard, type LensType } from "@/components/command/LensCard";
import { WalkModeOverlay } from "@/components/command/WalkModeOverlay";
import { isFalkonFormationIntent, useFalkonHealth } from "@/lib/falkonNetwork";
import type { VoiceAction } from "@workspace/api-client-react";

// ─── Thread message types (same as mobile) ────────────────────────────────────

type TMsg =
  | { id: string; kind: "morning-brief" }
  | { id: string; kind: "decision-packet"; card: FeedCardType }
  | { id: string; kind: "autopilot-packet"; action: { id: string; title: string; body: string; type: string; status: string } }
  | { id: string; kind: "system-alert"; card: FeedCardType; tier: "today" | "week" }
  | { id: string; kind: "user-msg"; text: string }
  | { id: string; kind: "thinking" }
  | { id: string; kind: "halo-response"; text: string }
  | { id: string; kind: "lens"; lensType: LensType; query: string }
  | { id: string; kind: "confirmation"; logId: string; actions: VoiceAction[] }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string };

// ─── Intent detection (same logic as mobile) ──────────────────────────────────

const LENS_MAP: Array<{ keywords: string[]; lens: LensType }> = [
  { keywords: ["invoice", "payment", "money", "margin", "revenue", "budget", "overdue", "outstanding", "scope", "financial", "bill", "collect", "paid", "unpaid", "past due"], lens: "money" },
  { keywords: ["schedule", "timeline", "turn", "due this week", "late", "delay", "project", "sla", "unscheduled"], lens: "timeline" },
  { keywords: ["crew", "vendor", "on site", "available", "compliance", "coi", "contractor", "who is", "missing", "performance"], lens: "network" },
  { keywords: ["photo", "before", "after", "inspection", "evidence", "qc", "quality", "image", "picture"], lens: "evidence" },
  { keywords: ["portfolio", "properties", "executive", "brief me", "health", "overview", "all properties", "compare", "report"], lens: "portfolio" },
  { keywords: ["map", "location", "gps", "where", "route", "driving", "find another", "near", "miles"], lens: "map" },
];
const QUERY_STARTERS = ["show", "which", "find", "who", "what", "how many", "list", "give me", "brief me", "compare", "check", "tell me", "are there", "is there", "do we have", "what are", "why is"];

function detectIntent(text: string): { type: "lens"; lens: LensType } | { type: "action" } | { type: "falkon" } {
  const lower = text.toLowerCase().trim();
  if (isFalkonFormationIntent(text)) return { type: "falkon" };
  const isQuery = QUERY_STARTERS.some(s => lower.startsWith(s));
  if (isQuery) {
    for (const { keywords, lens } of LENS_MAP) {
      if (keywords.some(k => lower.includes(k))) return { type: "lens", lens };
    }
    return { type: "lens", lens: "portfolio" };
  }
  for (const { keywords, lens } of LENS_MAP) {
    if (keywords.some(k => lower.includes(k))) {
      const hasDataVerb = ["show", "open", "see", "view", "check", "pull up"].some(v => lower.includes(v));
      if (hasDataVerb) return { type: "lens", lens };
    }
  }
  return { type: "action" };
}

// ─── Falkon mode ──────────────────────────────────────────────────────────────

type FalkonMode = "SHADOW" | "ASSISTED" | "LIVE";
function deriveFalkonMode(health?: { overallHealth?: string }): FalkonMode {
  if (!health || !["healthy", "degraded"].includes(health.overallHealth ?? "")) return "SHADOW";
  return health.overallHealth === "healthy" ? "ASSISTED" : "SHADOW";
}

const MODE_STYLES: Record<FalkonMode, { badge: string; dot: string }> = {
  SHADOW:   { badge: "bg-white/8 border border-white/12 text-white/40",      dot: "bg-white/40" },
  ASSISTED: { badge: "bg-[#B4FF44]/12 border border-[#B4FF44]/25 text-[#B4FF44]/80", dot: "bg-[#B4FF44]" },
  LIVE:     { badge: "bg-[#22C55E]/12 border border-[#22C55E]/25 text-[#22C55E]/80", dot: "bg-[#22C55E]" },
};

// ─── Ambient messages ─────────────────────────────────────────────────────────

const AMBIENT = [
  "Evaluating 14 active job margins…",
  "2 vendor COI responses received",
  "Falkon network — 1 peer healthy",
  "Invoice evidence verified",
  "Scanning autopilot conditions…",
  "Monitoring crew GPS breadcrumbs…",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-2.5 mb-2">
      <div className="w-6 h-6 rounded-full bg-[#B4FF44]/15 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRing className="w-3.5 h-3.5" />
      </div>
      <div className="bg-card border border-border rounded-[14px] rounded-bl-[4px] px-4 py-3 flex items-center gap-2">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-[#B4FF44]/50"
            style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

function HaloBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2.5 mb-2">
      <div className="w-6 h-6 rounded-full bg-[#B4FF44]/15 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRing className="w-3.5 h-3.5" />
      </div>
      <div className="max-w-[70%] bg-card border border-border rounded-[14px] rounded-bl-[4px] px-4 py-3">
        <p className="text-[13.5px] text-foreground leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-2">
      <div className="max-w-[70%] bg-[#B4FF44] text-[#07101E] rounded-[14px] rounded-br-[4px] px-4 py-3">
        <p className="text-[13.5px] font-medium leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function SystemAlertCard({ card, tier }: { card: FeedCardType; tier: "today" | "week" }) {
  const [, navigate] = useLocation();
  const color = tier === "today" ? "#F59E0B" : "#64748B";

  const go = () => {
    if (card.entityType === "job" && card.entityId) navigate(`/jobs/${card.entityId}`);
    else if (card.entityType === "invoice" && card.entityId) navigate(`/invoices/${card.entityId}`);
    else if (card.queue === "bids") navigate("/pipeline");
    else navigate("/today");
  };

  return (
    <div
      onClick={go}
      className="flex items-start gap-3 bg-card border border-border rounded-[14px] px-4 py-3 mb-2 cursor-pointer hover:bg-accent/30 transition-colors"
      style={{ borderLeftWidth: 3, borderLeftColor: color }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold tracking-[0.15em] uppercase mb-1" style={{ color }}>
          {tier === "today" ? "Today" : "This Week"}
        </div>
        <div className="text-sm font-semibold text-foreground leading-snug">{card.title}</div>
        {card.sub && <div className="text-xs text-muted-foreground mt-0.5">{card.sub}</div>}
      </div>
      {card.amount != null && (
        <div className="text-sm font-bold text-foreground shrink-0">${card.amount.toLocaleString()}</div>
      )}
      <ChevronDown className="w-4 h-4 text-muted-foreground rotate-[-90deg] shrink-0 mt-0.5" />
    </div>
  );
}

// ─── Morning Brief (Desktop) ──────────────────────────────────────────────────

function DesktopMorningBrief() {
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey() } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey() } });
  const { data: money } = useGetMoneySummary({ query: { queryKey: getGetMoneySummaryQueryKey() } });
  const { data: jobs } = useListJobs({ query: { queryKey: getListJobsQueryKey() } });
  const { data: crews } = useListCrews();

  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening.";

  const nowCards = today?.feed?.filter((c: FeedCardType) => c.tier === "now") ?? [];
  const pendingAP = (autopilot ?? []).filter(a => a.status === "pending");
  const needsYou = nowCards.length + pendingAP.length;
  const activeJobs = (jobs ?? []).filter(j => !["complete", "paid", "cancelled"].includes(j.status));
  const total = activeJobs.length + needsYou;
  const healthPct = total === 0 ? 100 : Math.round(((total - needsYou) / total) * 100);
  const mtd = money?.mtd ?? 0;

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-secondary to-background rounded-[20px] p-6 mb-3 border border-border shadow-lg">
      {/* Glow */}
      <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-primary/5 blur-[60px] pointer-events-none" />

      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-4">
          <HaloRing className="w-5 h-5 text-primary" />
          <span className="text-xs font-bold tracking-[0.2em] uppercase text-primary/70">
            {h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"} Brief
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
          </span>
        </div>

        <div className="text-[26px] font-bold text-foreground leading-tight mb-2">{greeting}</div>
        <p className="text-[14px] text-muted-foreground leading-relaxed mb-5">
          {needsYou === 0
            ? "All operations running smoothly. Nothing needs your attention right now."
            : `${healthPct}% of today's operation requires no action. I need ${needsYou} decision${needsYou !== 1 ? "s" : ""} from you.`}
        </p>

        {/* KPIs */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: "MTD Revenue", value: mtd >= 1000 ? `$${(mtd / 1000).toFixed(1)}k` : `$${mtd}`, color: "text-primary" },
            { label: "Active Jobs", value: String(activeJobs.length), color: "text-foreground" },
            { label: "Crew Available", value: String(crews?.length ?? 0), color: "text-foreground" },
            { label: "Decisions", value: String(needsYou), color: needsYou > 0 ? "text-destructive" : "text-[#22C55E]" },
          ].map(kpi => (
            <div key={kpi.label} className="bg-background/50 rounded-[12px] px-4 py-3 border border-border/50">
              <div className="text-[10px] font-bold tracking-[0.12em] uppercase text-muted-foreground mb-1">{kpi.label}</div>
              <div className={`text-[22px] font-bold leading-none ${kpi.color}`}>{kpi.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HaloCommand() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000 } });
  const { data: health } = useFalkonHealth();
  const parseVoice = useParseVoice();

  // ── Thread state ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<TMsg[]>([{ id: "brief-0", kind: "morning-brief" }]);
  const initialized = useRef(false);

  // ── Input + overlay state ─────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceInitial, setVoiceInitial] = useState<string | undefined>();
  const [walkOpen, setWalkOpen] = useState(false);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, []);

  // ── Ambient ───────────────────────────────────────────────────────────────
  const [ambientIdx, setAmbientIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAmbientIdx(i => (i + 1) % AMBIENT.length), 6000);
    return () => clearInterval(t);
  }, []);

  // ── Initialize thread ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!today || initialized.current) return;
    initialized.current = true;
    const nowCards = today.feed?.filter((c: FeedCardType) => c.tier === "now") ?? [];
    const todayCards = today.feed?.filter((c: FeedCardType) => c.tier === "today") ?? [];
    const weekCards = today.feed?.filter((c: FeedCardType) => c.tier === "week") ?? [];
    const pending = (autopilot ?? []).filter(a => a.status === "pending");

    const msgs: TMsg[] = [{ id: "brief-0", kind: "morning-brief" }];
    for (const card of nowCards.slice(0, 4)) msgs.push({ id: `dp-${card.id}`, kind: "decision-packet", card });
    for (const action of pending.slice(0, 2)) msgs.push({ id: `ap-${action.id}`, kind: "autopilot-packet", action });
    for (const card of todayCards.slice(0, 3)) msgs.push({ id: `sa-${card.id}`, kind: "system-alert", card, tier: "today" });
    for (const card of weekCards.slice(0, 2)) msgs.push({ id: `sw-${card.id}`, kind: "system-alert", card, tier: "week" });
    setMessages(msgs);
  }, [today, autopilot]);

  // ── Command submit ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");

    const userId = `user-${Date.now()}`;
    const thinkId = `think-${Date.now()}`;
    setMessages(prev => [...prev, { id: userId, kind: "user-msg", text }, { id: thinkId, kind: "thinking" }]);
    scrollToBottom();

    if (isFalkonFormationIntent(text)) {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      setVoiceInitial(text);
      setVoiceOpen(true);
      return;
    }

    const intent = detectIntent(text);

    if (intent.type === "lens") {
      await new Promise(r => setTimeout(r, 400));
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "lens", lensType: intent.lens, query: text } : m
      ));
      scrollToBottom();
      return;
    }

    try {
      const result = await parseVoice.mutateAsync({ data: { transcript: text } });
      if (result?.actions?.length > 0) {
        setMessages(prev => prev.map(m =>
          m.id === thinkId ? { id: thinkId, kind: "confirmation", logId: result.logId, actions: result.actions } : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === thinkId ? { id: thinkId, kind: "halo-response", text: "I couldn't identify a specific action. Try 'show invoices over scope' or 'schedule job J-2001 for Thursday'." } : m
        ));
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "error", text: "Something went wrong. Please try again." } : m
      ));
    }
    scrollToBottom();
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const falkonMode = deriveFalkonMode(health);
  const modeStyle = MODE_STYLES[falkonMode];
  const nowCount = today?.feed?.filter((c: FeedCardType) => c.tier === "now").length ?? 0;
  const apCount = (autopilot ?? []).filter(a => a.status === "pending").length;
  const totalNeeds = nowCount + apCount;

  const renderMessage = (msg: TMsg) => {
    switch (msg.kind) {
      case "morning-brief": return <DesktopMorningBrief key={msg.id} />;
      case "decision-packet":
        return (
          <DecisionPacket
            key={msg.id}
            card={msg.card}
            onAskHalo={ctx => setInput(`Tell me more about: ${ctx}`)}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, { id: `resolved-${Date.now()}`, kind: "halo-response", text: "Decision recorded." }]);
            }}
          />
        );
      case "autopilot-packet":
        return (
          <DecisionPacket
            key={msg.id}
            autopilot={msg.action}
            onAskHalo={ctx => setInput(`Tell me more about: ${ctx}`)}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, { id: `resolved-${Date.now()}`, kind: "halo-response", text: "Autopilot action recorded." }]);
            }}
          />
        );
      case "system-alert": return <SystemAlertCard key={msg.id} card={msg.card} tier={msg.tier} />;
      case "user-msg": return <UserBubble key={msg.id} text={msg.text} />;
      case "thinking": return <ThinkingBubble key={msg.id} />;
      case "halo-response": return <HaloBubble key={msg.id} text={msg.text} />;
      case "lens": return <LensCard key={msg.id} lensType={msg.lensType} query={msg.query} onDeepLink={navigate} />;
      case "confirmation":
        return (
          <ConfirmCard
            key={msg.id}
            logId={msg.logId}
            actions={msg.actions}
            onConfirmed={text => {
              setMessages(prev => prev.map(m => m.id === msg.id ? { id: msg.id, kind: "success", text } : m));
              qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
            }}
            onCancelled={() => {
              setMessages(prev => prev.map(m => m.id === msg.id ? { id: msg.id, kind: "halo-response", text: "Cancelled — nothing was changed." } : m));
            }}
          />
        );
      case "success":
        return (
          <div key={msg.id} className="flex items-center gap-2 bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-[12px] px-4 py-3 mb-2">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
            <span className="text-sm text-[#22C55E]/90">{msg.text}</span>
          </div>
        );
      case "error":
        return (
          <div key={msg.id} className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-[12px] px-4 py-3 mb-2">
            <AlertCircle className="w-4 h-4 text-destructive" />
            <span className="text-sm text-destructive/90">{msg.text}</span>
          </div>
        );
      default: return null;
    }
  };

  return (
    <>
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>

      <div className="flex flex-col h-full bg-background" data-tour="nav-today">
        {/* ── Top status bar ──────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-6 py-3.5 border-b border-border shrink-0">
          <div>
            <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-muted-foreground">
              HALO Command
            </div>
          </div>
          <div className="flex-1" />

          {/* Attention indicator */}
          {totalNeeds > 0 ? (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-destructive/10 border border-destructive/20">
              <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              <span className="text-xs font-bold text-destructive/90">{totalNeeds} need{totalNeeds === 1 ? "s" : ""} you</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#22C55E]/10 border border-[#22C55E]/20">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
              <span className="text-xs font-bold text-[#22C55E]/90">All clear</span>
            </div>
          )}

          {/* Falkon mode */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-[0.12em] ${modeStyle.badge}`}>
            <div className={`w-1.5 h-1.5 rounded-full ${modeStyle.dot}`} />
            {falkonMode}
          </div>

          {/* Ambient */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span className="hidden lg:block">{AMBIENT[ambientIdx]}</span>
          </div>
        </div>

        {/* ── Thread ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 scroll-smooth">
          {messages.map(renderMessage)}

          {/* Suggested prompts */}
          {messages.length <= 1 && (
            <div className="mt-6">
              <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-muted-foreground mb-4">
                Suggested
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  "Show invoices over scope",
                  "Which crews are on site right now?",
                  "Show turns due this week",
                  "Brief me across the portfolio",
                  "Who is missing after photos?",
                  "Show vendor compliance issues",
                  "Show payment-ready invoices",
                  "Find margin leakage",
                ].map(p => (
                  <button
                    key={p}
                    onClick={() => setInput(p)}
                    className="text-left px-4 py-3 rounded-[12px] bg-card border border-border text-sm text-muted-foreground hover:text-foreground hover:border-border/80 hover:bg-accent/30 transition-all active:scale-[0.98]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div ref={bottomRef} className="h-4" />
        </div>

        {/* ── Command input ────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-border bg-background shrink-0">
          <div className="flex items-center gap-3">
            {/* Mic */}
            <button
              onClick={() => { setVoiceInitial(undefined); setVoiceOpen(true); }}
              className="w-10 h-10 rounded-full bg-primary/10 border border-primary/25 grid place-items-center text-primary hover:bg-primary/20 transition-all active:scale-[0.93] shrink-0"
            >
              <Mic className="w-4 h-4" strokeWidth={2} />
            </button>

            {/* Input */}
            <div className="relative flex-1">
              <Sparkles className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary/50 pointer-events-none" />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                placeholder="Ask HALO anything — state the outcome you want…"
                className="w-full h-10 rounded-full bg-accent/30 border border-border pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/15 transition-all"
              />
            </div>

            {/* Walk */}
            <button
              onClick={() => setWalkOpen(true)}
              className="w-10 h-10 rounded-full bg-accent/30 border border-border grid place-items-center text-muted-foreground hover:text-primary hover:border-primary/30 hover:bg-primary/8 transition-all active:scale-[0.93] shrink-0"
              title="Walk Mode"
            >
              <Footprints className="w-4 h-4" strokeWidth={2} />
            </button>

            {/* Send */}
            {input.trim() && (
              <button
                onClick={handleSubmit}
                disabled={parseVoice.isPending}
                className="w-10 h-10 rounded-full bg-primary grid place-items-center text-primary-foreground shadow-[0_4px_14px_rgba(180,255,68,0.3)] hover:scale-105 active:scale-95 transition-transform disabled:opacity-60 shrink-0"
              >
                {parseVoice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" strokeWidth={2.5} />}
              </button>
            )}
          </div>

          {/* Quick chips */}
          <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5 scrollbar-hide">
            {[
              { label: "Money",     lens: "money"     as LensType, query: "Show money overview" },
              { label: "Timeline",  lens: "timeline"  as LensType, query: "Show timeline" },
              { label: "Network",   lens: "network"   as LensType, query: "Show crew and vendor network" },
              { label: "Portfolio", lens: "portfolio" as LensType, query: "Portfolio overview" },
              { label: "Evidence",  lens: "evidence"  as LensType, query: "Show photo evidence" },
            ].map(chip => (
              <button
                key={chip.label}
                onClick={() => {
                  setMessages(prev => [...prev,
                    { id: `u-${Date.now()}`, kind: "user-msg", text: chip.query },
                    { id: `l-${Date.now()}`, kind: "lens", lensType: chip.lens, query: chip.query },
                  ]);
                  scrollToBottom();
                }}
                className="flex-shrink-0 px-3 py-1.5 rounded-full bg-accent/40 border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all active:scale-95"
              >
                {chip.label}
              </button>
            ))}
            <button
              onClick={() => navigate("/today")}
              className="flex-shrink-0 px-3 py-1.5 rounded-full bg-accent/40 border border-border text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-all active:scale-95 flex items-center gap-1"
            >
              <Zap className="w-3 h-3" />
              Legacy View
            </button>
          </div>
        </div>
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────── */}
      <VoiceCaptureDialog
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        initialText={voiceInitial}
      />

      {walkOpen && (
        <WalkModeOverlay
          onClose={() => setWalkOpen(false)}
          onSendToHalo={(items, summary) => {
            setMessages(prev => [...prev, {
              id: `walk-${Date.now()}`,
              kind: "halo-response",
              text: `Walk captured: ${summary}. ${items.length} item${items.length !== 1 ? "s" : ""} recorded — open the Walk app to create jobs.`,
            }]);
            scrollToBottom();
          }}
        />
      )}
    </>
  );
}
