/**
 * HALO Command — the primary conversational operating system interface.
 *
 * Replaces the legacy Today dashboard as the default landing screen.
 * A full-screen, thread-based workspace where operators state outcomes and
 * HALO dynamically renders the right UI: Decision Packets, generative canvas
 * lenses, action confirmations, and ambient system activity.
 *
 * Thread state is persisted at module level across route changes/remounts so
 * navigating to a detail view and pressing Back restores the conversation.
 *
 * All legacy screens remain fully accessible as contextual deep-links.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Mic,
  Bell,
  LayoutGrid,
  Footprints,
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
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

import haloLogo from "../assets/halo-logo.png";
import { HaloRing } from "@/components/HaloRing";
import { VoiceCaptureSheet } from "@/components/VoiceCaptureSheet";
import { AskFalkonSheet } from "@/components/AskFalkonSheet";
import { ArrivalDetection } from "@/components/ArrivalSheet";
import { NotificationsDrawer } from "@/components/NotificationsDrawer";
import { MoreMenuSheet } from "@/components/MoreMenuSheet";
import { FalkonNetworkPulse } from "@/components/FalkonNetworkPulse";
import { DecisionPacket } from "@/components/command/DecisionPacket";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { LensCard, type LensType } from "@/components/command/LensCard";
import { WalkModeOverlay } from "@/components/command/WalkModeOverlay";
import { isFalkonFormationIntent, useFalkonHealth } from "@/lib/falkonNetwork";
import type { VoiceAction } from "@workspace/api-client-react";

// ─── Thread message types ─────────────────────────────────────────────────────

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
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "walk-result"; items: { id: string; description: string }[]; summary: string };

// ─── Module-level thread persistence (survives route changes / remounts) ───────

let _savedThread: TMsg[] | null = null;
let _threadReady = false;

// ─── Intent detection ─────────────────────────────────────────────────────────

const LENS_MAP: Array<{ keywords: string[]; lens: LensType }> = [
  { keywords: ["invoice", "payment", "money", "margin", "revenue", "budget", "overdue", "outstanding", "scope", "financial", "bill", "collect", "paid", "unpaid", "past due"], lens: "money" },
  { keywords: ["schedule", "timeline", "turn", "due this week", "late", "delay", "project", "sla", "unscheduled", "scheduled", "when is"], lens: "timeline" },
  { keywords: ["crew", "vendor", "on site", "available", "compliance", "coi", "contractor", "who is", "missing after", "performance"], lens: "network" },
  { keywords: ["photo", "before", "after", "inspection", "evidence", "qc", "quality", "image", "picture", "proof"], lens: "evidence" },
  { keywords: ["portfolio", "properties", "executive", "brief me", "operating health", "overview", "all properties", "compare", "report", "performance"], lens: "portfolio" },
  { keywords: ["map", "location", "gps", "where", "route", "driving", "directions", "find another", "near", "miles"], lens: "map" },
];

const QUERY_STARTERS = [
  "show", "which", "find", "who", "what", "how many", "list",
  "give me", "brief me", "compare", "check", "tell me",
  "are there", "is there", "do we have", "what are", "why is",
];

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

// ─── Falkon mode derivation ───────────────────────────────────────────────────

type FalkonMode = "SHADOW" | "ASSISTED" | "LIVE";

function deriveFalkonMode(health?: { overallHealth?: string }): FalkonMode {
  if (!health || health.overallHealth === "no_peers" || health.overallHealth === "loading") return "SHADOW";
  if (health.overallHealth === "degraded") return "SHADOW";
  if (health.overallHealth === "healthy") return "ASSISTED";
  return "SHADOW";
}

const FALKON_MODE_STYLES: Record<FalkonMode, { bg: string; text: string; dot: string }> = {
  SHADOW:   { bg: "bg-white/6 border border-white/12",           text: "text-white/40",     dot: "bg-white/35" },
  ASSISTED: { bg: "bg-[#B4FF44]/10 border border-[#B4FF44]/22", text: "text-[#B4FF44]/85", dot: "bg-[#B4FF44]" },
  LIVE:     { bg: "bg-[#22C55E]/10 border border-[#22C55E]/22", text: "text-[#22C55E]/85", dot: "bg-[#22C55E]" },
};

// ─── Ambient activity messages ────────────────────────────────────────────────

const AMBIENT_MSGS = [
  "Evaluating active job margins…",
  "Checking vendor COI status…",
  "Syncing Falkon network peers…",
  "Scanning for overdue invoices…",
  "Monitoring crew GPS signals…",
  "Reviewing autopilot conditions…",
  "Verifying evidence gates…",
];

// ─── Suggested prompts ────────────────────────────────────────────────────────

const SUGGESTED_PROMPTS = [
  "Show invoices over scope",
  "Which crews are on site?",
  "Show turns due this week",
  "Brief me across the portfolio",
  "Who is missing after photos?",
  "Show payment-ready invoices",
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-[5px] h-[5px] rounded-full bg-[#B4FF44]/50"
            style={{ animation: `haloBounce 1.2s ease-in-out ${i * 0.18}s infinite` }}
          />
        ))}
      </div>
    </div>
  );
}

function HaloBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="max-w-[84%] bg-[#0C1B30] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 shadow-[0_2px_12px_rgba(0,0,0,0.25)]">
        <p className="text-[13.5px] text-white/80 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[80%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-3 shadow-[0_4px_16px_rgba(180,255,68,0.22)]">
        <p className="text-[13.5px] font-semibold leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function SystemAlertCard({
  card,
  tier,
  onNavigate,
}: {
  card: FeedCardType;
  tier: "today" | "week";
  onNavigate: (path: string) => void;
}) {
  const accentColor = tier === "today" ? "#F59E0B" : "#4B5563";
  const [, navigate] = useLocation();

  const handleTap = () => {
    if (card.entityType === "job" && card.entityId) navigate(`/jobs/${card.entityId}`);
    else if (card.entityType === "invoice" && card.entityId) navigate(`/invoices/${card.entityId}`);
    else if (card.queue === "bids") navigate("/pipeline");
    else if (card.queue === "supply") navigate("/supply");
    else if (card.queue === "compliance") navigate("/vendors");
    else onNavigate("/today");
  };

  return (
    <div
      onClick={handleTap}
      className="flex items-start gap-3 bg-[#090F1C] rounded-[14px] px-4 py-3.5 mb-2.5 border border-white/5 cursor-pointer active:scale-[0.98] transition-transform"
      style={{ borderLeftWidth: "2px", borderLeftColor: accentColor }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[9.5px] font-bold tracking-[0.18em] uppercase mb-1" style={{ color: accentColor }}>
          {tier === "today" ? "Today" : "This Week"}
        </div>
        <div className="text-[13px] text-white/80 font-medium leading-snug">{card.title}</div>
        {card.sub && (
          <div className="text-[11.5px] text-white/38 mt-0.5 leading-snug">{card.sub}</div>
        )}
      </div>
      {card.amount != null && (
        <div className="text-[13px] font-bold text-white/60 shrink-0 tabular-nums">${card.amount.toLocaleString()}</div>
      )}
      <ChevronDown className="w-3.5 h-3.5 text-white/20 rotate-[-90deg] shrink-0 mt-0.5" />
    </div>
  );
}

// ─── Morning Brief Card ───────────────────────────────────────────────────────

function MorningBriefCard() {
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey() } });
  const { data: autopilot } = useListAutopilotActions({
    query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000 },
  });
  const { data: money } = useGetMoneySummary({ query: { queryKey: getGetMoneySummaryQueryKey() } });
  const { data: jobs } = useListJobs({ query: { queryKey: getListJobsQueryKey() } });
  const { data: crews } = useListCrews();

  const h = new Date().getHours();
  const greeting = h < 12 ? "Good morning." : h < 17 ? "Good afternoon." : "Good evening.";

  const nowCards = today?.feed?.filter(c => c.tier === "now") ?? [];
  const pendingAP = (autopilot ?? []).filter(a => a.status === "pending");
  const needsYou = nowCards.length + pendingAP.length;

  const activeJobs = (jobs ?? []).filter(j => j.status !== "complete" && j.status !== "paid" && j.status !== "cancelled");
  const total = activeJobs.length + needsYou;
  const healthPct = total === 0 ? 100 : Math.round(((total - needsYou) / total) * 100);

  const mtd = money?.mtd ?? 0;
  const mtdStr = mtd >= 1000 ? `$${(mtd / 1000).toFixed(1)}k` : `$${mtd}`;

  return (
    <div className="relative overflow-hidden bg-[linear-gradient(150deg,#111B2C_0%,#060D17_100%)] rounded-[22px] p-5 mb-4 border border-white/7 shadow-[0_16px_48px_rgba(0,0,0,0.45)]">
      {/* Ambient glow */}
      <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-[#B4FF44] opacity-[0.055] blur-[56px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-32 h-24 rounded-full bg-[#3B82F6] opacity-[0.03] blur-[48px] pointer-events-none" />

      <div className="relative z-10">
        {/* Badge row */}
        <div className="flex items-center gap-2 mb-4">
          <HaloRing className="w-[16px] h-[16px] text-[#B4FF44]" />
          <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-[#B4FF44]/70">
            {h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"} Brief
          </span>
          <span className="ml-auto text-[10.5px] text-white/25 font-medium tabular-nums">
            {new Date().toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </div>

        {/* Greeting */}
        <div className="text-[21px] font-bold text-white leading-tight tracking-[-0.01em] mb-1.5">{greeting}</div>

        {/* Health status */}
        <p className="text-[13.5px] text-white/55 leading-relaxed mb-4 font-light">
          {needsYou === 0
            ? "All operations are running smoothly. Nothing needs your attention right now."
            : `${healthPct}% of today's operation requires no action from you.`}
        </p>

        {/* Decision / all-clear badge */}
        {needsYou > 0 ? (
          <div className="flex items-center gap-2 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[11px] px-3 py-2.5 mb-4">
            <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48] animate-pulse shrink-0" />
            <span className="text-[12.5px] font-semibold text-[#E11D48]/85">
              {needsYou} decision{needsYou !== 1 ? "s" : ""} need your attention below.
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-[#22C55E]/7 border border-[#22C55E]/14 rounded-[11px] px-3 py-2.5 mb-4">
            <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
            <span className="text-[12.5px] text-[#22C55E]/80">All caught up — nothing pending.</span>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "MTD Rev", value: mtdStr },
            { label: "Active Jobs", value: String(activeJobs.length) },
            { label: "Crew", value: String(crews?.length ?? 0) },
          ].map(kpi => (
            <div key={kpi.label} className="bg-white/[0.042] rounded-[10px] px-3 py-2.5 border border-white/5">
              <div className="text-[9px] font-bold tracking-[0.18em] uppercase text-white/28 mb-1.5">{kpi.label}</div>
              <div className="text-[17px] font-bold text-white leading-none tabular-nums">{kpi.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Walk result card ─────────────────────────────────────────────────────────

function WalkResultCard({ items, summary }: { items: { id: string; description: string }[]; summary: string }) {
  return (
    <div className="bg-[#0A1628] border border-[#B4FF44]/18 rounded-[16px] px-4 py-4 mb-3">
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-7 h-7 rounded-[9px] bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center">
          <Footprints className="w-3.5 h-3.5 text-[#B4FF44]" />
        </div>
        <div>
          <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-[#B4FF44]/75">Walk Capture</div>
          <div className="text-[11.5px] text-white/45">{items.length} item{items.length !== 1 ? "s" : ""} recorded</div>
        </div>
      </div>
      <div className="space-y-1.5 mb-3">
        {items.slice(0, 3).map(item => (
          <div key={item.id} className="flex items-center gap-2 text-[12.5px] text-white/65">
            <div className="w-1 h-1 rounded-full bg-[#B4FF44]/50 shrink-0" />
            {item.description}
          </div>
        ))}
        {items.length > 3 && (
          <div className="text-[11px] text-white/30">+{items.length - 3} more items</div>
        )}
      </div>
      <button
        onClick={() => window.open("/walk", "_blank", "noopener")}
        className="w-full text-center text-[12px] font-bold text-[#B4FF44]/60 hover:text-[#B4FF44]/90 py-2 border border-[#B4FF44]/12 rounded-[10px] transition-colors active:scale-[0.98] hover:border-[#B4FF44]/25"
      >
        Open Walk app to create jobs ↗
      </button>
    </div>
  );
}

// ─── Main HaloCommand component ───────────────────────────────────────────────

export default function HaloCommand() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 } });
  const { data: autopilot } = useListAutopilotActions({
    query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000 },
  });
  const { data: health } = useFalkonHealth();

  const parseVoice = useParseVoice();

  // ── Thread state (initialized from module-level persistence) ───────────────
  const [messages, setMessages] = useState<TMsg[]>(() =>
    _savedThread ?? [{ id: "brief-0", kind: "morning-brief" }]
  );
  const initialized = useRef(_threadReady);

  // Sync to module-level persistence on every change
  useEffect(() => { _savedThread = messages; }, [messages]);

  // ── Input state ───────────────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceInitial, setVoiceInitial] = useState<string | undefined>(undefined);
  const [falkonOpen, setFalkonOpen] = useState(false);
  const [falkonText, setFalkonText] = useState("");
  const [walkOpen, setWalkOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);

  // ── Scroll anchor ─────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Ambient activity ──────────────────────────────────────────────────────
  const [ambientMsg, setAmbientMsg] = useState(AMBIENT_MSGS[0]);
  useEffect(() => {
    const interval = setInterval(() => {
      setAmbientMsg(AMBIENT_MSGS[Math.floor(Math.random() * AMBIENT_MSGS.length)]);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  // ── Initialize thread from feed (once per session, not on remount) ─────────
  useEffect(() => {
    if (!today || initialized.current) return;
    initialized.current = true;
    _threadReady = true;

    const nowCards = today.feed?.filter((c: FeedCardType) => c.tier === "now") ?? [];
    const todayCards = today.feed?.filter((c: FeedCardType) => c.tier === "today") ?? [];
    const weekCards = today.feed?.filter((c: FeedCardType) => c.tier === "week") ?? [];
    const pending = (autopilot ?? []).filter(a => a.status === "pending");

    const newMsgs: TMsg[] = [{ id: "brief-0", kind: "morning-brief" }];

    for (const card of nowCards.slice(0, 4)) {
      newMsgs.push({ id: `dp-${card.id}`, kind: "decision-packet", card });
    }
    for (const action of pending.slice(0, 2)) {
      newMsgs.push({ id: `ap-${action.id}`, kind: "autopilot-packet", action });
    }
    for (const card of todayCards.slice(0, 3)) {
      newMsgs.push({ id: `sa-${card.id}`, kind: "system-alert", card, tier: "today" });
    }
    for (const card of weekCards.slice(0, 2)) {
      newMsgs.push({ id: `sw-${card.id}`, kind: "system-alert", card, tier: "week" });
    }

    setMessages(newMsgs);
  }, [today, autopilot]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 80);
  }, []);

  // ── Command submit ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");

    const userId = `user-${Date.now()}`;
    const thinkId = `think-${Date.now()}`;

    setMessages(prev => [...prev,
      { id: userId, kind: "user-msg", text },
      { id: thinkId, kind: "thinking" },
    ]);
    scrollToBottom();

    if (isFalkonFormationIntent(text)) {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      setFalkonText(text);
      setFalkonOpen(true);
      return;
    }

    const intent = detectIntent(text);

    if (intent.type === "lens") {
      await new Promise(r => setTimeout(r, 380));
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "lens", lensType: intent.lens, query: text }
          : m
      ));
      scrollToBottom();
      return;
    }

    try {
      const result = await parseVoice.mutateAsync({ data: { transcript: text } });

      if (result?.actions?.length > 0) {
        setMessages(prev => prev.map(m =>
          m.id === thinkId
            ? { id: thinkId, kind: "confirmation", logId: result.logId, actions: result.actions }
            : m
        ));
      } else {
        setMessages(prev => prev.map(m =>
          m.id === thinkId
            ? {
                id: thinkId, kind: "halo-response",
                text: "I understood that, but couldn't identify a specific action. Try phrasing it as 'Schedule job J-2001 for Thursday' or ask me to show you something — 'show overdue invoices'.",
              }
            : m
        ));
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "error", text: "Something went wrong. Check your connection and try again." }
          : m
      ));
    }
    scrollToBottom();
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const falkonMode = deriveFalkonMode(health);
  const modeStyle = FALKON_MODE_STYLES[falkonMode];
  const nowCount = today?.feed?.filter((c: FeedCardType) => c.tier === "now").length ?? 0;
  const pendingCount = (autopilot ?? []).filter(a => a.status === "pending").length;
  const totalNeeds = nowCount + pendingCount;
  const unread = today?.unreadNotifications ?? 0;

  // ── Render a thread message ───────────────────────────────────────────────
  const renderMessage = (msg: TMsg) => {
    switch (msg.kind) {
      case "morning-brief":
        return <MorningBriefCard />;

      case "decision-packet":
        return (
          <DecisionPacket
            card={msg.card}
            onAskHalo={ctx => { setInput(`Tell me more about: ${ctx}`); }}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, {
                id: `resolved-${Date.now()}`,
                kind: "halo-response",
                text: "Got it — that decision has been recorded.",
              }]);
            }}
          />
        );

      case "autopilot-packet":
        return (
          <DecisionPacket
            autopilot={msg.action}
            onAskHalo={ctx => setInput(`Tell me more about: ${ctx}`)}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, {
                id: `resolved-${Date.now()}`,
                kind: "halo-response",
                text: "Autopilot action recorded.",
              }]);
            }}
          />
        );

      case "system-alert":
        return (
          <SystemAlertCard
            card={msg.card}
            tier={msg.tier}
            onNavigate={navigate}
          />
        );

      case "user-msg":
        return <UserBubble text={msg.text} />;

      case "thinking":
        return <ThinkingBubble />;

      case "halo-response":
        return <HaloBubble text={msg.text} />;

      case "lens":
        return (
          <LensCard
            lensType={msg.lensType}
            query={msg.query}
            onDeepLink={navigate}
          />
        );

      case "confirmation":
        return (
          <ConfirmCard
            logId={msg.logId}
            actions={msg.actions}
            onConfirmed={text => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { id: msg.id, kind: "success", text } : m
              ));
              qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
            }}
            onCancelled={() => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id
                  ? { id: msg.id, kind: "halo-response", text: "Cancelled — nothing was changed." }
                  : m
              ));
            }}
          />
        );

      case "success":
        return (
          <div className="flex items-center gap-2.5 bg-[#22C55E]/8 border border-[#22C55E]/18 rounded-[13px] px-4 py-3 mb-2.5">
            <CheckCircle2 className="w-[15px] h-[15px] text-[#22C55E] shrink-0" />
            <span className="text-[13px] text-[#22C55E]/85">{msg.text}</span>
          </div>
        );

      case "error":
        return (
          <div className="flex items-center gap-2.5 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[13px] px-4 py-3 mb-2.5">
            <AlertCircle className="w-[15px] h-[15px] text-[#E11D48] shrink-0" />
            <span className="text-[13px] text-[#E11D48]/85">{msg.text}</span>
          </div>
        );

      case "walk-result":
        return <WalkResultCard items={msg.items} summary={msg.summary} />;

      default:
        return null;
    }
  };

  return (
    <>
      <style>{`
        @keyframes haloBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-5px); }
        }
        @keyframes haloMsgIn {
          from { opacity: 0; transform: translateY(7px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes haloAmbient {
          0%, 100% { opacity: 0.22; transform: scaleY(0.6); }
          50%      { opacity: 0.55; transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .halo-msg-enter { animation: none !important; }
        }
      `}</style>

      <div className="min-h-[100dvh] flex flex-col items-center justify-center py-0 sm:py-8">
        {/* Desktop label */}
        <div className="hidden sm:flex items-center gap-2 text-[11px] font-bold tracking-[0.24em] text-muted-foreground uppercase mb-[14px]">
          <span>ARCHANGEL</span>
          <span className="text-white/20">·</span>
          <span className="text-[#B4FF44]">HALO</span>
          <span className="text-white/20">·</span>
          <span>COMMAND</span>
        </div>

        {/* Phone frame */}
        <div className="w-full sm:w-[430px] h-[100dvh] sm:h-[852px] bg-[#040D1C] sm:rounded-[32px] sm:shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_32px_80px_rgba(0,0,0,0.55),0_0_0_1px_rgba(0,0,0,0.5)] overflow-hidden relative flex flex-col">

          {/* ── Minimal header ─────────────────────────────────────────── */}
          <header className="flex items-center gap-2 px-4 pt-[calc(12px+env(safe-area-inset-top))] pb-3 shrink-0 border-b border-white/5">
            {/* Logo + scope */}
            <img
              src={haloLogo}
              alt="HALO Command"
              className="h-[24px] w-auto shrink-0 cursor-pointer"
              style={{ filter: "brightness(0) invert(1) opacity(0.9)" }}
              onClick={() => setScopeOpen(s => !s)}
            />
            <button
              onClick={() => setScopeOpen(s => !s)}
              className="flex items-center gap-1 px-2.5 py-[5px] rounded-full bg-white/5 border border-white/8 text-[10.5px] font-bold text-white/42 hover:text-white/72 hover:bg-white/8 transition-all"
            >
              Portfolio
              <ChevronDown className="w-3 h-3" />
            </button>

            <div className="flex-1" />

            {/* Attention indicator */}
            {totalNeeds > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[#E11D48]/10 border border-[#E11D48]/20">
                <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48] animate-pulse" />
                <span className="text-[10.5px] font-bold text-[#E11D48]/85">
                  {totalNeeds} need{totalNeeds === 1 ? "s" : ""} you
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-[5px] rounded-full bg-[#22C55E]/8 border border-[#22C55E]/18">
                <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                <span className="text-[10.5px] font-bold text-[#22C55E]/75">All clear</span>
              </div>
            )}

            {/* Falkon mode badge */}
            <div className={`flex items-center gap-1.5 px-2.5 py-[5px] rounded-full text-[9.5px] font-bold tracking-[0.14em] ${modeStyle.bg} ${modeStyle.text}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${modeStyle.dot} ${falkonMode !== "SHADOW" ? "animate-pulse" : ""}`} />
              {falkonMode}
            </div>

            <FalkonNetworkPulse />

            {/* Notifications */}
            <button
              onClick={() => setNotifOpen(true)}
              className="relative w-9 h-9 rounded-full grid place-items-center bg-white/5 border border-white/8 text-white/42 hover:text-white/72 hover:bg-white/8 transition-all active:scale-[0.94]"
            >
              <Bell className="w-[15px] h-[15px]" strokeWidth={1.8} />
              {unread > 0 && (
                <span className="absolute -top-[2px] -right-[2px] min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#B4FF44] text-black text-[8.5px] font-bold grid place-items-center shadow-[0_0_8px_rgba(180,255,68,0.45)]">
                  {unread}
                </span>
              )}
            </button>

            {/* More */}
            <button
              onClick={() => setMoreOpen(true)}
              className="w-9 h-9 rounded-full grid place-items-center bg-white/5 border border-white/8 text-white/42 hover:text-white/72 hover:bg-white/8 transition-all active:scale-[0.94]"
            >
              <LayoutGrid className="w-[15px] h-[15px]" strokeWidth={1.8} />
            </button>
          </header>

          {/* ── Thread ─────────────────────────────────────────────────── */}
          <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 overscroll-none">
            {messages.map(msg => (
              <div
                key={msg.id}
                className="halo-msg-enter"
                style={{ animation: "haloMsgIn 0.22s ease-out both" }}
              >
                {renderMessage(msg)}
              </div>
            ))}

            {/* Suggested prompts (only when thread is just the brief) */}
            {messages.length <= 1 && (
              <div className="mt-5 mb-2">
                <div className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/20 mb-3 px-0.5">
                  Ask HALO anything
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {SUGGESTED_PROMPTS.map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="text-left px-3.5 py-3 rounded-[13px] bg-white/[0.038] border border-white/7 text-[12.5px] text-white/45 hover:text-white/70 hover:bg-white/[0.055] hover:border-white/11 transition-all active:scale-[0.97] leading-snug"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={bottomRef} className="h-4" />
          </div>

          {/* ── Ambient activity strip ──────────────────────────────────── */}
          <div className="px-4 py-2 flex items-center gap-2.5 border-t border-white/4 shrink-0">
            <div className="flex gap-[3px] shrink-0">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="w-[3px] h-[10px] rounded-full bg-[#B4FF44]"
                  style={{ animation: `haloAmbient 2.2s ease-in-out ${i * 0.35}s infinite` }}
                />
              ))}
            </div>
            <span className="text-[10.5px] text-white/22 font-medium flex-1 truncate">{ambientMsg}</span>
          </div>

          {/* ── Command input bar ───────────────────────────────────────── */}
          <div className="px-4 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 shrink-0 bg-[#040D1C] border-t border-white/5">
            <div className="flex items-center gap-2">
              {/* Mic button */}
              <button
                onClick={() => { setVoiceInitial(undefined); setVoiceOpen(true); }}
                className="w-11 h-11 rounded-full bg-[#B4FF44]/8 border border-[#B4FF44]/20 grid place-items-center text-[#B4FF44] hover:bg-[#B4FF44]/15 transition-all active:scale-[0.92] shrink-0"
              >
                <Mic className="w-[17px] h-[17px]" strokeWidth={2} />
              </button>

              {/* Text input */}
              <div className="relative flex-1">
                <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-[13px] h-[13px] text-[#B4FF44]/40 pointer-events-none" />
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask HALO anything…"
                  className="w-full h-11 rounded-full bg-white/5 border border-white/8 pl-[34px] pr-4 text-[13.5px] text-white placeholder:text-white/22 focus:outline-none focus:border-[#B4FF44]/35 focus:ring-1 focus:ring-[#B4FF44]/15 focus:bg-white/6 transition-all"
                />
              </div>

              {/* Send or Walk */}
              {input.trim() ? (
                <button
                  onClick={handleSubmit}
                  disabled={parseVoice.isPending}
                  className="w-11 h-11 rounded-full bg-[#B4FF44] grid place-items-center text-[#07101E] shadow-[0_4px_16px_rgba(180,255,68,0.32)] hover:scale-105 active:scale-[0.94] transition-transform disabled:opacity-55 shrink-0"
                >
                  {parseVoice.isPending ? (
                    <Loader2 className="w-[15px] h-[15px] animate-spin" />
                  ) : (
                    <Send className="w-[15px] h-[15px]" strokeWidth={2.5} />
                  )}
                </button>
              ) : (
                <button
                  onClick={() => setWalkOpen(true)}
                  className="w-11 h-11 rounded-full bg-white/5 border border-white/8 grid place-items-center text-white/40 hover:text-[#B4FF44] hover:border-[#B4FF44]/25 hover:bg-[#B4FF44]/7 transition-all active:scale-[0.92] shrink-0"
                  title="Walk Mode"
                >
                  <Footprints className="w-[17px] h-[17px]" strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Quick action chips */}
            <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {[
                { label: "Money",     lens: "money"     as LensType, query: "Show money overview" },
                { label: "Jobs",      lens: "timeline"  as LensType, query: "Show job timeline" },
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
                  className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/7 text-[10.5px] font-bold text-white/38 hover:text-white/65 hover:bg-white/8 transition-all active:scale-[0.95]"
                >
                  {chip.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────── */}
      <ArrivalDetection />

      <VoiceCaptureSheet
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        initialText={voiceInitial}
      />

      <AskFalkonSheet
        open={falkonOpen}
        onOpenChange={setFalkonOpen}
        initialText={falkonText}
      />

      <NotificationsDrawer
        open={notifOpen}
        onOpenChange={setNotifOpen}
      />

      <MoreMenuSheet
        open={moreOpen}
        onOpenChange={setMoreOpen}
      />

      {walkOpen && (
        <WalkModeOverlay
          onClose={() => setWalkOpen(false)}
          onSendToHalo={(items, summary) => {
            setMessages(prev => [...prev, {
              id: `walk-${Date.now()}`,
              kind: "walk-result",
              items,
              summary,
            }]);
            scrollToBottom();
          }}
        />
      )}
    </>
  );
}
