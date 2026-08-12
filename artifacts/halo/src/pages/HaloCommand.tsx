/**
 * HALO Command — the primary conversational operating system interface.
 *
 * Replaces the legacy Today dashboard as the default landing screen.
 * A full-screen, thread-based workspace where operators state outcomes and
 * HALO dynamically renders the right UI: Decision Packets, generative canvas
 * lenses, action confirmations, and ambient system activity.
 *
 * All legacy screens remain fully accessible as contextual deep-links.
 * Core thesis: management software that tries to eliminate the need to
 * manage the software.
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
  Network,
  X,
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
  // Also detect data phrases without explicit starter
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
  SHADOW:   { bg: "bg-white/8 border border-white/15",  text: "text-white/50",  dot: "bg-white/40" },
  ASSISTED: { bg: "bg-[#B4FF44]/12 border border-[#B4FF44]/25", text: "text-[#B4FF44]/90", dot: "bg-[#B4FF44]" },
  LIVE:     { bg: "bg-[#22C55E]/12 border border-[#22C55E]/25", text: "text-[#22C55E]/90", dot: "bg-[#22C55E]" },
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-2 mb-2">
      <div className="w-6 h-6 rounded-full bg-[#B4FF44]/15 border border-[#B4FF44]/30 grid place-items-center shrink-0">
        <HaloRing className="w-3 h-3 text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/8 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-2">
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full bg-[#B4FF44]/60"
              style={{ animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function HaloBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 mb-2">
      <div className="w-6 h-6 rounded-full bg-[#B4FF44]/15 border border-[#B4FF44]/30 grid place-items-center shrink-0">
        <HaloRing className="w-3 h-3 text-[#B4FF44]" />
      </div>
      <div className="max-w-[82%] bg-[#0D1E33] border border-white/8 rounded-[16px] rounded-bl-[4px] px-4 py-3">
        <p className="text-[13.5px] text-white/85 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-2">
      <div className="max-w-[80%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-3">
        <p className="text-[13.5px] font-medium leading-relaxed">{text}</p>
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
  const accentColor = tier === "today" ? "#F59E0B" : "#64748B";
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
      className="flex items-start gap-3 bg-[#0A1628] rounded-[16px] px-4 py-3 mb-2 border border-white/6 cursor-pointer active:scale-[0.98] transition-transform"
      style={{ borderLeftWidth: "2px", borderLeftColor: accentColor }}
    >
      <div className="flex-1 min-w-0">
        <div className="text-[10px] font-bold tracking-[0.15em] uppercase mb-1" style={{ color: accentColor }}>
          {tier === "today" ? "Today" : "This Week"}
        </div>
        <div className="text-[13.5px] text-white/85 font-medium leading-snug">{card.title}</div>
        {card.sub && (
          <div className="text-[12px] text-white/45 mt-0.5 leading-snug">{card.sub}</div>
        )}
      </div>
      {card.amount != null && (
        <div className="text-[13px] font-bold text-white/70 shrink-0">${card.amount.toLocaleString()}</div>
      )}
      <ChevronDown className="w-4 h-4 text-white/25 rotate-[-90deg] shrink-0 mt-0.5" />
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
    <div className="relative overflow-hidden bg-[linear-gradient(145deg,#1A1A1E,#060D17)] rounded-[24px] p-5 mb-3 border border-white/8 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
      {/* Lime glow blob */}
      <div className="absolute -top-8 -right-8 w-40 h-40 rounded-full bg-[#B4FF44] opacity-[0.07] blur-[50px] pointer-events-none" />

      <div className="relative z-10">
        {/* Badge row */}
        <div className="flex items-center gap-2 mb-4">
          <HaloRing className="w-[18px] h-[18px] text-[#B4FF44]" />
          <span className="text-[11px] font-bold tracking-[0.2em] uppercase text-[#B4FF44]/80">
            {h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"} Brief
          </span>
          <span className="ml-auto text-[11px] text-white/30 font-medium">
            {new Date().toLocaleDateString([], { month: "short", day: "numeric" })}
          </span>
        </div>

        {/* Greeting */}
        <div className="text-[22px] font-bold text-white leading-tight mb-2">{greeting}</div>

        {/* Health status */}
        <p className="text-[14px] text-white/65 leading-relaxed mb-4">
          {needsYou === 0
            ? "All operations are running smoothly. Nothing needs your attention right now."
            : `${healthPct}% of today's operation requires no action from you.`}
        </p>

        {/* Decision call-out */}
        {needsYou > 0 && (
          <div className="flex items-center gap-2 bg-[#B4FF44]/10 border border-[#B4FF44]/20 rounded-[12px] px-3 py-2.5 mb-4">
            <AlertCircle className="w-4 h-4 text-[#B4FF44] shrink-0" />
            <span className="text-[13px] font-semibold text-[#B4FF44]/90">
              I need {needsYou} decision{needsYou !== 1 ? "s" : ""} from you.
            </span>
          </div>
        )}

        {needsYou === 0 && (
          <div className="flex items-center gap-2 bg-[#22C55E]/8 border border-[#22C55E]/15 rounded-[12px] px-3 py-2.5 mb-4">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
            <span className="text-[13px] text-[#22C55E]/90">All caught up.</span>
          </div>
        )}

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/5 rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-white/30 mb-1">MTD Rev</div>
            <div className="text-[16px] font-bold text-white leading-none">{mtdStr}</div>
          </div>
          <div className="bg-white/5 rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-white/30 mb-1">Active Jobs</div>
            <div className="text-[16px] font-bold text-white leading-none">{activeJobs.length}</div>
          </div>
          <div className="bg-white/5 rounded-[10px] px-3 py-2">
            <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-white/30 mb-1">Crew</div>
            <div className="text-[16px] font-bold text-white leading-none">{crews?.length ?? 0}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Walk result card ─────────────────────────────────────────────────────────

function WalkResultCard({ items, summary }: { items: { id: string; description: string }[]; summary: string }) {
  const [, navigate] = useLocation();
  return (
    <div className="bg-[#0A1628] border border-[#B4FF44]/20 rounded-[16px] px-4 py-4 mb-2">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-7 h-7 rounded-[9px] bg-[#B4FF44]/15 border border-[#B4FF44]/30 grid place-items-center">
          <Footprints className="w-3.5 h-3.5 text-[#B4FF44]" />
        </div>
        <div>
          <div className="text-[11px] font-bold tracking-[0.15em] uppercase text-[#B4FF44]/80">Walk Capture</div>
          <div className="text-[12px] text-white/50">{items.length} item{items.length !== 1 ? "s" : ""} recorded</div>
        </div>
      </div>
      <div className="space-y-1.5 mb-3">
        {items.slice(0, 3).map(item => (
          <div key={item.id} className="flex items-center gap-2 text-[12.5px] text-white/70">
            <div className="w-1.5 h-1.5 rounded-full bg-[#B4FF44]/60 shrink-0" />
            {item.description}
          </div>
        ))}
        {items.length > 3 && (
          <div className="text-[11px] text-white/35">+{items.length - 3} more items</div>
        )}
      </div>
      <button
        onClick={() => window.open("/walk", "_blank", "noopener")}
        className="w-full text-center text-[12px] font-bold text-[#B4FF44]/70 hover:text-[#B4FF44] py-1.5 border border-[#B4FF44]/15 rounded-[10px] transition-colors"
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

  // ── Thread state ──────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<TMsg[]>([{ id: "brief-0", kind: "morning-brief" }]);
  const initialized = useRef(false);

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
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Ambient activity ──────────────────────────────────────────────────────
  const [ambientMsg, setAmbientMsg] = useState(AMBIENT_MSGS[0]);
  useEffect(() => {
    const interval = setInterval(() => {
      setAmbientMsg(AMBIENT_MSGS[Math.floor(Math.random() * AMBIENT_MSGS.length)]);
    }, 7000);
    return () => clearInterval(interval);
  }, []);

  // ── Initialize thread from feed ───────────────────────────────────────────
  useEffect(() => {
    if (!today || initialized.current) return;
    initialized.current = true;

    const nowCards = today.feed?.filter((c: FeedCardType) => c.tier === "now") ?? [];
    const todayCards = today.feed?.filter((c: FeedCardType) => c.tier === "today") ?? [];
    const weekCards = today.feed?.filter((c: FeedCardType) => c.tier === "week") ?? [];
    const pending = (autopilot ?? []).filter(a => a.status === "pending");

    const newMsgs: TMsg[] = [{ id: "brief-0", kind: "morning-brief" }];

    // Now-tier → decision packets (most important)
    for (const card of nowCards.slice(0, 4)) {
      newMsgs.push({ id: `dp-${card.id}`, kind: "decision-packet", card });
    }

    // Autopilot → decision packets
    for (const action of pending.slice(0, 2)) {
      newMsgs.push({ id: `ap-${action.id}`, kind: "autopilot-packet", action });
    }

    // Today-tier → system alerts
    for (const card of todayCards.slice(0, 3)) {
      newMsgs.push({ id: `sa-${card.id}`, kind: "system-alert", card, tier: "today" });
    }

    // Week-tier alerts (brief, not decision packets)
    for (const card of weekCards.slice(0, 2)) {
      newMsgs.push({ id: `sw-${card.id}`, kind: "system-alert", card, tier: "week" });
    }

    setMessages(newMsgs);
  }, [today, autopilot]);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
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

    // Falkon formation → open AskFalkonSheet
    if (isFalkonFormationIntent(text)) {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      setFalkonText(text);
      setFalkonOpen(true);
      return;
    }

    const intent = detectIntent(text);

    if (intent.type === "lens") {
      // Brief delay for "thinking" feel, then show lens
      await new Promise(r => setTimeout(r, 450));
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "lens", lensType: intent.lens, query: text }
          : m
      ));
      scrollToBottom();
      return;
    }

    // Action intent → voice parse
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
        return <MorningBriefCard key={msg.id} />;

      case "decision-packet":
        return (
          <DecisionPacket
            key={msg.id}
            card={msg.card}
            onAskHalo={ctx => {
              setInput(`Tell me more about: ${ctx}`);
            }}
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
            key={msg.id}
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
            key={msg.id}
            card={msg.card}
            tier={msg.tier}
            onNavigate={navigate}
          />
        );

      case "user-msg":
        return <UserBubble key={msg.id} text={msg.text} />;

      case "thinking":
        return <ThinkingBubble key={msg.id} />;

      case "halo-response":
        return <HaloBubble key={msg.id} text={msg.text} />;

      case "lens":
        return (
          <LensCard
            key={msg.id}
            lensType={msg.lensType}
            query={msg.query}
            onDeepLink={navigate}
          />
        );

      case "confirmation":
        return (
          <ConfirmCard
            key={msg.id}
            logId={msg.logId}
            actions={msg.actions}
            onConfirmed={text => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id
                  ? { id: msg.id, kind: "success", text }
                  : m
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
          <div key={msg.id} className="flex items-center gap-2 bg-[#22C55E]/10 border border-[#22C55E]/20 rounded-[14px] px-4 py-3 mb-2">
            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
            <span className="text-[13px] text-[#22C55E]/90">{msg.text}</span>
          </div>
        );

      case "error":
        return (
          <div key={msg.id} className="flex items-center gap-2 bg-[#E11D48]/10 border border-[#E11D48]/20 rounded-[14px] px-4 py-3 mb-2">
            <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0" />
            <span className="text-[13px] text-[#E11D48]/90">{msg.text}</span>
          </div>
        );

      case "walk-result":
        return <WalkResultCard key={msg.id} items={msg.items} summary={msg.summary} />;

      default:
        return null;
    }
  };

  return (
    <>
      {/* Phone-mockup container (matches Layout.tsx container for visual consistency) */}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
      `}</style>

      <div className="min-h-[100dvh] flex flex-col items-center justify-center py-0 sm:py-7">
        {/* Desktop label */}
        <div className="hidden sm:block text-[12px] font-display font-semibold tracking-[0.22em] text-muted-foreground uppercase mb-[14px]">
          ARCHANGEL · <b className="text-[#B4FF44]">HALO</b> · COMMAND
        </div>

        <div className="w-full sm:w-[430px] h-[100dvh] sm:h-[850px] bg-[#041029] sm:rounded-[32px] sm:shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_30px_80px_rgba(0,0,0,0.5)] overflow-hidden relative flex flex-col">

          {/* ── Minimal header ─────────────────────────────────────────── */}
          <header className="flex items-center gap-2 px-4 pt-[calc(14px+env(safe-area-inset-top))] pb-3 shrink-0 border-b border-white/6">
            {/* Logo */}
            <img
              src={haloLogo}
              alt="HALO Command"
              className="h-[26px] w-auto shrink-0"
              style={{ filter: "brightness(0) invert(1)" }}
              onClick={() => setScopeOpen(s => !s)}
            />

            {/* Scope chip */}
            <button
              onClick={() => setScopeOpen(s => !s)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/6 border border-white/10 text-[11px] font-bold text-white/50 hover:text-white/80 hover:bg-white/10 transition-all"
            >
              Portfolio
              <ChevronDown className="w-3 h-3" />
            </button>

            <div className="flex-1" />

            {/* Attention indicator */}
            {totalNeeds > 0 ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E11D48]/12 border border-[#E11D48]/25">
                <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48] animate-pulse" />
                <span className="text-[11px] font-bold text-[#E11D48]/90">
                  {totalNeeds} need{totalNeeds === 1 ? "s" : ""} you
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#22C55E]/10 border border-[#22C55E]/20">
                <div className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
                <span className="text-[11px] font-bold text-[#22C55E]/80">All clear</span>
              </div>
            )}

            {/* Falkon mode */}
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-[0.12em] ${modeStyle.bg} ${modeStyle.text}`}>
              <div className={`w-1.5 h-1.5 rounded-full ${modeStyle.dot}`} />
              {falkonMode}
            </div>

            {/* Falkon pulse */}
            <FalkonNetworkPulse />

            {/* Notifications */}
            <button
              onClick={() => setNotifOpen(true)}
              className="relative w-9 h-9 rounded-full grid place-items-center bg-white/6 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all"
            >
              <Bell className="w-4 h-4" strokeWidth={1.8} />
              {unread > 0 && (
                <span className="absolute -top-[2px] -right-[2px] min-w-[16px] h-[16px] px-[4px] rounded-[8px] bg-[#B4FF44] text-black text-[9px] font-bold grid place-items-center shadow-[0_0_8px_rgba(180,255,68,0.5)]">
                  {unread}
                </span>
              )}
            </button>

            {/* More */}
            <button
              onClick={() => setMoreOpen(true)}
              className="w-9 h-9 rounded-full grid place-items-center bg-white/6 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10 transition-all"
            >
              <LayoutGrid className="w-4 h-4" strokeWidth={1.8} />
            </button>
          </header>

          {/* ── Thread ─────────────────────────────────────────────────── */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-4 scroll-smooth"
          >
            {messages.map(renderMessage)}

            {/* Suggested prompts (when thread is clean / only brief) */}
            {messages.length <= 1 && (
              <div className="mt-4 space-y-2">
                <div className="text-[10px] font-bold tracking-[0.18em] uppercase text-white/25 mb-3">
                  Try asking…
                </div>
                {[
                  "Show invoices over scope",
                  "Which crews are on site?",
                  "Show turns due this week",
                  "Brief me across the portfolio",
                  "Find a crew within 10 miles",
                  "Show payment-ready invoices",
                ].map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => { setInput(prompt); }}
                    className="block w-full text-left px-4 py-3 rounded-[14px] bg-white/4 border border-white/8 text-[13px] text-white/55 hover:text-white/80 hover:bg-white/6 hover:border-white/15 transition-all active:scale-[0.98]"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}

            {/* Scroll anchor */}
            <div ref={bottomRef} className="h-4" />
          </div>

          {/* ── Ambient activity strip ──────────────────────────────────── */}
          <div className="px-4 py-2 flex items-center gap-2 border-t border-white/4 shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-[#B4FF44]/40 animate-pulse shrink-0" />
            <span className="text-[10.5px] text-white/25 font-medium flex-1 truncate">{ambientMsg}</span>
            <Loader2 className="w-3 h-3 text-white/20 animate-spin shrink-0" />
          </div>

          {/* ── Command input bar ───────────────────────────────────────── */}
          <div className="px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-3 shrink-0 bg-[#041029] border-t border-white/6">
            <div className="flex items-center gap-2">
              {/* Mic button */}
              <button
                onClick={() => { setVoiceInitial(undefined); setVoiceOpen(true); }}
                className="w-11 h-11 rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/25 grid place-items-center text-[#B4FF44] hover:bg-[#B4FF44]/20 transition-all active:scale-[0.93] shrink-0"
              >
                <Mic className="w-4.5 h-4.5" strokeWidth={2} />
              </button>

              {/* Text input */}
              <div className="relative flex-1">
                <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-[#B4FF44]/50 pointer-events-none" />
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask HALO anything…"
                  className="w-full h-11 rounded-full bg-white/6 border border-white/10 pl-9 pr-4 text-[13.5px] text-white placeholder:text-white/25 focus:outline-none focus:border-[#B4FF44]/40 focus:ring-1 focus:ring-[#B4FF44]/20 transition-all"
                />
              </div>

              {/* Send or Walk button */}
              {input.trim() ? (
                <button
                  onClick={handleSubmit}
                  disabled={parseVoice.isPending}
                  className="w-11 h-11 rounded-full bg-[#B4FF44] grid place-items-center text-[#07101E] shadow-[0_4px_14px_rgba(180,255,68,0.35)] hover:scale-105 active:scale-95 transition-transform disabled:opacity-60 shrink-0"
                >
                  {parseVoice.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" strokeWidth={2.5} />
                  )}
                </button>
              ) : (
                <button
                  onClick={() => setWalkOpen(true)}
                  className="w-11 h-11 rounded-full bg-white/6 border border-white/10 grid place-items-center text-white/50 hover:text-[#B4FF44] hover:border-[#B4FF44]/30 hover:bg-[#B4FF44]/8 transition-all active:scale-[0.93] shrink-0"
                  title="Walk Mode"
                >
                  <Footprints className="w-4.5 h-4.5" strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Quick action chips */}
            <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5 scrollbar-hide">
              {[
                { label: "Money", action: () => setMessages(prev => [...prev, { id: `u-${Date.now()}`, kind: "user-msg", text: "Show money overview" }, { id: `l-${Date.now()}`, kind: "lens", lensType: "money" as LensType, query: "Show money overview" }]) },
                { label: "Jobs", action: () => setMessages(prev => [...prev, { id: `u-${Date.now()}`, kind: "user-msg", text: "Show timeline" }, { id: `l-${Date.now()}`, kind: "lens", lensType: "timeline" as LensType, query: "Show timeline" }]) },
                { label: "Network", action: () => setMessages(prev => [...prev, { id: `u-${Date.now()}`, kind: "user-msg", text: "Show crew and vendor network" }, { id: `l-${Date.now()}`, kind: "lens", lensType: "network" as LensType, query: "Show crew and vendor network" }]) },
                { label: "Portfolio", action: () => setMessages(prev => [...prev, { id: `u-${Date.now()}`, kind: "user-msg", text: "Portfolio overview" }, { id: `l-${Date.now()}`, kind: "lens", lensType: "portfolio" as LensType, query: "Portfolio overview" }]) },
              ].map(chip => (
                <button
                  key={chip.label}
                  onClick={() => { chip.action(); scrollToBottom(); }}
                  className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white/6 border border-white/10 text-[11px] font-bold text-white/45 hover:text-white/75 hover:bg-white/10 transition-all active:scale-95"
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
