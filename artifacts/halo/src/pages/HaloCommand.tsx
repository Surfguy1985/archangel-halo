/**
 * HALO Command — the primary conversational operating system.
 *
 * This is the FIXED SEED default experience when office opens. It renders two
 * layout states:
 *
 *   SEED   — full-screen centered: glowing halo ring, "Hi, Team." greeting,
 *            one large rounded command composer, four restrained Try Asking
 *            cards. Matches the premium near-black hardware-like screenshot.
 *
 *   THREAD — once the user sends a message, slides into a standard chat
 *            thread with the command bar at the bottom. All existing lens
 *            cards, confirmation packets, decision packets, and walk capture
 *            remain fully functional.
 *
 * Navigation: A minimal bottom strip exposes "Chat" (active on /) and
 * "Work App" (navigates to /today — the full CRM/legacy office experience).
 * All expert screens remain accessible there and via the MoreMenuSheet.
 *
 * Falkon safeguards: SHADOW / ASSISTED / LIVE modes are displayed. Consequential
 * actions always surface a ConfirmCard for explicit approval before execution.
 *
 * Thread state persists at module level across route changes so Back → /
 * restores the last conversation.
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
  ChevronRight,
  MessageSquare,
  Briefcase,
  DollarSign,
  MapPin,
  FileText,
  Zap,
  X,
} from "lucide-react";

import {
  useGetToday,
  useListAutopilotActions,
  useParseVoice,
  getGetTodayQueryKey,
  getListAutopilotActionsQueryKey,
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
import { BriefingCard, type BriefingData } from "@/components/command/BriefingCard";
import { WalkModeOverlay } from "@/components/command/WalkModeOverlay";
import { FalkonControlCenter } from "@/components/command/FalkonControlCenter";
import { isFalkonFormationIntent, useFalkonHealth } from "@/lib/falkonNetwork";
import type { VoiceAction } from "@workspace/api-client-react";

// ─── Thread message types ─────────────────────────────────────────────────────

type TMsg =
  | { id: string; kind: "decision-packet"; card: FeedCardType }
  | { id: string; kind: "autopilot-packet"; action: { id: string; title: string; body: string; type: string; status: string } }
  | { id: string; kind: "user-msg"; text: string }
  | { id: string; kind: "thinking" }
  | { id: string; kind: "halo-response"; text: string }
  | { id: string; kind: "lens"; lensType: LensType; query: string }
  | { id: string; kind: "confirmation"; logId: string; actions: VoiceAction[] }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "walk-result"; items: { id: string; description: string }[]; summary: string }
  | { id: string; kind: "halo-answer"; text: string; sources?: Array<{ label: string; value: string }>; followUps?: string[]; shadowLabel?: string }
  // Structured rich messages injected by the command brain
  | { id: string; kind: "briefing"; data: BriefingData };

// ─── Module-level thread persistence ─────────────────────────────────────────

// Messages always start empty — DB is the authoritative source, restored on init.

// ─── API fetch helper ─────────────────────────────────────────────────────────

async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(path, {
    ...options,
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// ─── Keyframes ───────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes hcBounce {
  0%, 60%, 100% { transform: translateY(0); }
  30%            { transform: translateY(-5px); }
}
@keyframes hcMsgIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hcAmbient {
  0%, 100% { opacity: 0.22; transform: scaleY(0.55); }
  50%       { opacity: 0.58; transform: scaleY(1); }
}
@keyframes hcGlow {
  0%, 100% { opacity: 0.55; filter: drop-shadow(0 0 22px rgba(180,255,68,0.42)); }
  50%       { opacity: 0.85; filter: drop-shadow(0 0 42px rgba(180,255,68,0.70)); }
}
@keyframes hcSeedFade {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hc-msg { animation: none !important; }
  .hc-seed-item { animation: none !important; }
}
`;

// ─── Intent detection ─────────────────────────────────────────────────────────

const LENS_MAP: Array<{ keywords: string[]; lens: LensType }> = [
  {
    keywords: ["invoice", "invoices", "payment", "money", "margin", "revenue", "budget",
      "overdue", "outstanding", "scope", "financial", "bill", "billing", "collect",
      "paid", "unpaid", "past due", "receivable", "accounts", "unit.*invoic", "needing invoic",
      "units.*invoic", "send invoice", "create invoice", "new invoice"],
    lens: "money",
  },
  {
    keywords: ["schedule", "timeline", "turn", "turns", "due this week", "late", "delay",
      "project", "sla", "unscheduled", "on deck", "deck", "upcoming", "next week",
      "work order", "job timeline", "unit.*turn", "what.*week", "structure.*day",
      "organize.*day", "what.*today", "pressing jobs", "most.*job"],
    lens: "timeline",
  },
  {
    keywords: ["crew", "vendor", "on site", "available", "compliance", "coi", "contractor",
      "who is", "missing", "performance", "dispatch", "dispatched", "check in",
      "checked in", "active today", "working today", "who.*site", "who.*working",
      "who.*dispatch", "send.*link", "live link", "portal link", "crew.*link"],
    lens: "network",
  },
  {
    keywords: ["photo", "before", "after", "inspection", "evidence", "qc", "quality",
      "image", "picture", "proof", "documentation", "photo evidence", "inspect"],
    lens: "evidence",
  },
  {
    keywords: ["portfolio", "properties", "executive", "brief me", "health", "overview",
      "all properties", "compare", "report", "performance", "pressing", "urgent",
      "critical", "operations", "status", "summary", "what is happening", "what.*happening",
      "active operations", "summarize", "across", "today.*status"],
    lens: "portfolio",
  },
  {
    keywords: ["map", "location", "gps", "where", "route", "driving", "find another",
      "near", "miles", "live map", "crew map", "who.*where", "live.*map"],
    lens: "map",
  },
];

const QUERY_STARTERS = [
  "show", "which", "find", "who", "what", "how many", "list", "give me",
  "brief me", "compare", "check", "tell me", "are there", "is there",
  "do we have", "what are", "why is", "where", "when",
];

const WORK_APP_PHRASES = [
  "work app", "crm", "legacy", "open today", "traditional", "dashboard", "go to work",
];

function detectIntent(text: string): { type: "navigate"; path: string } | { type: "lens"; lens: LensType } | { type: "action" } | { type: "falkon" } {
  const lower = text.toLowerCase().trim();

  if (WORK_APP_PHRASES.some(p => lower.includes(p))) {
    return { type: "navigate", path: "/today" };
  }
  if (isFalkonFormationIntent(text)) return { type: "falkon" };

  const isQuery = QUERY_STARTERS.some(s => lower.startsWith(s));
  if (isQuery) {
    for (const { keywords, lens } of LENS_MAP) {
      if (keywords.some(k => {
        try { return new RegExp(k).test(lower); } catch { return lower.includes(k); }
      })) return { type: "lens", lens };
    }
    return { type: "lens", lens: "portfolio" };
  }
  for (const { keywords, lens } of LENS_MAP) {
    if (keywords.some(k => {
      try { return new RegExp(k).test(lower); } catch { return lower.includes(k); }
    })) {
      const hasDataVerb = ["show", "open", "see", "view", "check", "pull up", "display"].some(v => lower.includes(v));
      if (hasDataVerb) return { type: "lens", lens };
    }
  }
  return { type: "action" };
}

// ─── Falkon mode ──────────────────────────────────────────────────────────────

type FalkonMode = "SHADOW" | "ASSISTED" | "LIVE";

function deriveFalkonMode(health?: { gatewayMode?: string; overallHealth?: string }): FalkonMode {
  // Use the actual gateway connection mode (from falkon_connections.mode),
  // NOT the peer network health. A healthy peer network does NOT mean the
  // gateway S2S session exists or has been verified.
  const mode = health?.gatewayMode;
  if (!mode || mode === "OFF" || mode === "SHADOW") return "SHADOW";
  if (mode === "ASSISTED") return "ASSISTED";
  if (mode === "LIVE") return "LIVE";
  return "SHADOW";
}

const FALKON_MODE_STYLES: Record<FalkonMode, { bg: string; text: string; dot: string }> = {
  SHADOW:   { bg: "bg-white/5 border border-white/10",            text: "text-white/38",     dot: "bg-white/30" },
  ASSISTED: { bg: "bg-[#B4FF44]/8 border border-[#B4FF44]/20",   text: "text-[#B4FF44]/80", dot: "bg-[#B4FF44]" },
  LIVE:     { bg: "bg-[#22C55E]/8 border border-[#22C55E]/20",   text: "text-[#22C55E]/80", dot: "bg-[#22C55E]" },
};

// ─── Ambient messages ─────────────────────────────────────────────────────────

const AMBIENT_MSGS = [
  "Evaluating active job margins…",
  "Checking vendor COI status…",
  "Syncing Falkon network peers…",
  "Scanning for overdue invoices…",
  "Monitoring crew GPS signals…",
  "Reviewing autopilot conditions…",
  "Verifying evidence gates…",
  "Watching unit readiness…",
];

// ─── Try Asking cards (the 4 shown in seed) ───────────────────────────────────

const TRY_ASKING: Array<{
  label: string;
  icon: typeof DollarSign;
  iconColor: string;
  query: string;
  lens?: LensType;
}> = [
  {
    label: "Most pressing jobs today",
    icon: Zap,
    iconColor: "#F59E0B",
    query: "Most pressing jobs today",
    lens: "portfolio",
  },
  {
    label: "Live crew map",
    icon: MapPin,
    iconColor: "#22C55E",
    query: "Show live crew map",
    lens: "map",
  },
  {
    label: "Units needing invoices",
    icon: DollarSign,
    iconColor: "#B4FF44",
    query: "Show units needing invoices",
    lens: "money",
  },
  {
    label: "Create an invoice",
    icon: FileText,
    iconColor: "#6366F1",
    query: "Create an invoice",
  },
];

// ─── Thread sub-components ────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-[5px] h-[5px] rounded-full bg-[#B4FF44]/50"
            style={{ animation: `hcBounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
        ))}
      </div>
    </div>
  );
}

function HaloBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-2 mb-3 hc-msg" style={{ animation: "hcMsgIn 0.22s ease-out both" }}>
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="max-w-[84%] bg-[#0C1B30] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 shadow-sm">
        <p className="text-[13.5px] text-white/80 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-3 hc-msg" style={{ animation: "hcMsgIn 0.22s ease-out both" }}>
      <div className="max-w-[80%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-3 shadow-[0_4px_16px_rgba(180,255,68,0.22)]">
        <p className="text-[13.5px] font-semibold leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

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
        {items.length > 3 && <div className="text-[11px] text-white/30">+{items.length - 3} more items</div>}
      </div>
      <button
        onClick={() => window.open("/walk", "_blank", "noopener")}
        className="w-full text-center text-[12px] font-bold text-[#B4FF44]/60 hover:text-[#B4FF44]/90 py-2 border border-[#B4FF44]/12 rounded-[10px] transition-colors"
      >
        Open Walk app to create jobs ↗
      </button>
    </div>
  );
}

// ─── HaloAnswerBubble — brain-grounded response with sources & follow-ups ─────

function HaloAnswerBubble({
  text,
  sources,
  followUps,
  shadowLabel,
  onFollowUp,
}: {
  text: string;
  sources?: Array<{ label: string; value: string }>;
  followUps?: string[];
  shadowLabel?: string;
  onFollowUp: (q: string) => void;
}) {
  return (
    <div className="mb-3 hc-msg" style={{ animation: "hcMsgIn 0.22s ease-out both" }}>
      {shadowLabel && (
        <div className="flex items-center gap-1.5 mb-1.5 ml-[30px]">
          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 border border-amber-500/25 text-amber-400 uppercase tracking-wider">
            SHADOW
          </span>
          <span className="text-[10px] text-amber-400/65">Proposed — not executed</span>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
          <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
        </div>
        <div className={`max-w-[85%] rounded-[16px] rounded-bl-[4px] px-4 py-3 shadow-sm ${shadowLabel ? "bg-amber-950/40 border border-amber-500/20" : "bg-[#0C1B30] border border-white/7"}`}>
          <p className="text-[13.5px] text-white/82 leading-relaxed">{text}</p>
          {sources && sources.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-white/6">
              {sources.map((s, i) => (
                <span key={i} className="text-[10px] text-white/35">
                  <span className="text-white/22">{s.label}:</span> {s.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {followUps && followUps.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-1.5 ml-[30px]">
          {followUps.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="text-[11px] font-medium text-white/42 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/7 hover:text-white/70 hover:bg-white/[0.07] transition-all active:scale-[0.96]"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HaloCommand() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000 } });
  const { data: health } = useFalkonHealth();
  const parseVoice = useParseVoice();

  // ── Thread (module-level persistence across navigations) ───────────────────
  const [messages, setMessages] = useState<TMsg[]>([]);

  // ── Input & overlay state ─────────────────────────────────────────────────
  const [input, setInput] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceInitial, setVoiceInitial] = useState<string | undefined>(undefined);
  const [falkonOpen, setFalkonOpen] = useState(false);
  const [falkonText, setFalkonText] = useState("");
  const [walkOpen, setWalkOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // ── Brain conversation ─────────────────────────────────────────────────────
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("halo_convo_id"); } catch { return null; }
  });
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  // False until the conversation is validated server-side; gates submission to
  // prevent write races during init and new-chat creation.
  const [brainReady, setBrainReady] = useState(false);

  // ── Ambient ───────────────────────────────────────────────────────────────
  const [ambientIdx, setAmbientIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAmbientIdx(i => (i + 1) % AMBIENT_MSGS.length), 8000);
    return () => clearInterval(t);
  }, []);

  // ── Init brain conversation + history restore ──────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        // Fetch suggested prompts (endpoint also returns conversations list, but
        // we intentionally ignore it — we honour the session-stored ID only).
        const data = await apiFetch("/api/command/conversations");
        if (cancelled) return;
        if (data.suggestedPrompts) setSuggestedPrompts(data.suggestedPrompts);

        // If a valid session-scoped conversation ID is already stored, use it.
        // Otherwise create a brand-new conversation for this session.
        let convoId = conversationId; // initialised from sessionStorage
        if (!convoId) {
          const created = await apiFetch("/api/command/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "executive" }),
          });
          if (!cancelled && created?.conversation?.id) {
            convoId = created.conversation.id;
            setConversationId(convoId);
            try { sessionStorage.setItem("halo_convo_id", convoId!); } catch {}
          }
        }

        // Always validate the stored conversation against the server and restore
        // its persisted history. Skipping this based on in-memory state would
        // allow a prior-session thread to bleed into a newly authenticated one.
        if (convoId) {
          try {
            const msgData = await apiFetch(`/api/command/conversations/${convoId}/messages?limit=40`);
            if (cancelled) return;
            const restored: TMsg[] = (msgData.messages ?? []).flatMap((m: { id: string; role: string; content: string; meta?: { type?: string; lensKind?: string; shadowLabel?: string } | null }) => {
              if (m.role === "user") {
                return [{ id: `r-${m.id}`, kind: "user-msg" as const, text: m.content }];
              }
              if (m.role === "assistant" && m.content) {
                return [{
                  id: `r-${m.id}`,
                  kind: "halo-answer" as const,
                  text: m.content,
                  shadowLabel: m.meta?.shadowLabel ?? undefined,
                }];
              }
              return [];
            });
            // DB is the source of truth — overwrite in-memory state.
            setMessages(restored);
          } catch (restoreErr) {
            if (cancelled) return;
            // Stale conversation (session rotated) — discard the prior-session
            // thread, clear the stored ID, and create a fresh conversation.
            if (restoreErr instanceof Error && restoreErr.message.startsWith("404")) {
              setMessages([]);
              try { sessionStorage.removeItem("halo_convo_id"); } catch {}
              setConversationId(null);
              try {
                const fresh = await apiFetch("/api/command/conversations", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ role: "executive" }),
                });
                if (!cancelled && fresh?.conversation?.id) {
                  const freshId: string = fresh.conversation.id;
                  setConversationId(freshId);
                  try { sessionStorage.setItem("halo_convo_id", freshId); } catch {}
                }
              } catch { /* non-fatal */ }
            }
            // Other errors: non-fatal, keep current state
          }
        }
      } catch { /* non-fatal — brain degrades gracefully */ }
    }
    init().finally(() => { if (!cancelled) setBrainReady(true); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Briefing injection on first load ──────────────────────────────────────
  // Runs once when brainReady becomes true. If the thread is still empty
  // (no history restored) fetches the daily briefing and injects it as the
  // first message. A ref prevents double-injection on StrictMode remounts.
  const briefingInjectedRef = useRef(false);
  useEffect(() => {
    if (!brainReady || briefingInjectedRef.current) return;
    briefingInjectedRef.current = true;
    apiFetch("/api/command/briefing")
      .then((data: BriefingData) => {
        setMessages(prev => {
          // Skip injection if history was restored — don't overwrite real messages
          if (prev.some(m => m.kind !== "briefing")) return prev;
          return [{ id: `briefing-${data.date}`, kind: "briefing" as const, data }];
        });
      })
      .catch(() => { /* non-fatal — briefing is a bonus, not required */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainReady]);

  // ── Briefing 60s auto-refresh (visibility-aware) ──────────────────────────
  useEffect(() => {
    if (!brainReady) return;
    const refreshBriefing = () => {
      if (document.hidden) return;
      apiFetch("/api/command/briefing")
        .then((data: BriefingData) => {
          setMessages(prev => {
            if (prev.length === 0 || prev[0].kind !== "briefing") return prev;
            // Replace the briefing in-place, keep the same id for React stability
            return [{ id: prev[0].id, kind: "briefing" as const, data }, ...prev.slice(1)];
          });
        })
        .catch(() => {});
    };
    const interval = setInterval(refreshBriefing, 60_000);
    const onVisibilityChange = () => { if (!document.hidden) refreshBriefing(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brainReady]);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = async (text?: string) => {
    if (!brainReady) return;
    const raw = (text ?? input).trim();
    if (!raw) return;
    setInput("");

    const userId = `user-${Date.now()}`;
    const thinkId = `think-${Date.now()}`;

    setMessages(prev => [...prev,
      { id: userId, kind: "user-msg" as const, text: raw },
      { id: thinkId, kind: "thinking" as const },
    ]);
    scrollToBottom();

    const intent = detectIntent(raw);

    // Navigation and Falkon are immediate — no AI call needed
    if (intent.type === "navigate") {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      navigate(intent.path);
      return;
    }
    if (intent.type === "falkon") {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      setFalkonText(raw);
      setFalkonOpen(true);
      return;
    }

    // ── Brain path (primary) ─────────────────────────────────────────────────
    const convoId = conversationId;
    if (convoId) {
      let activeConvoId = convoId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let brainResult: any = null;

      try {
        brainResult = await apiFetch(`/api/command/conversations/${activeConvoId}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: raw, role: "executive" }),
        });
      } catch (brainErr) {
        // Stale conversation (session rotated) — discard prior-session messages,
        // create fresh conversation, and retry the ask once.
        if (brainErr instanceof Error && brainErr.message.startsWith("404")) {
          setMessages([]);
          try { sessionStorage.removeItem("halo_convo_id"); } catch {}
          setConversationId(null);
          try {
            const fresh = await apiFetch("/api/command/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "executive" }),
            });
            if (fresh?.conversation?.id) {
              activeConvoId = fresh.conversation.id;
              setConversationId(activeConvoId);
              try { sessionStorage.setItem("halo_convo_id", activeConvoId); } catch {}
              brainResult = await apiFetch(`/api/command/conversations/${activeConvoId}/ask`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: raw, role: "executive" }),
              });
            }
          } catch { /* fall through to legacy */ }
        }
        // Other errors: brainResult stays null → fall through to legacy
      }

      if (brainResult) {
        if (brainResult.type === "lens" && brainResult.lensKind) {
          setMessages(prev => prev.map(m =>
            m.id === thinkId
              ? { id: thinkId, kind: "lens" as const, lensType: brainResult.lensKind as LensType, query: brainResult.entityId ?? raw }
              : m
          ));
          if (brainResult.text) {
            setMessages(prev => [...prev, {
              id: `ans-${Date.now()}`,
              kind: "halo-answer" as const,
              text: brainResult.text,
              sources: brainResult.sources,
              followUps: brainResult.suggestedFollowUps,
            }]);
          }
        } else if (brainResult.type === "voice_action") {
          setMessages(prev => prev.map(m =>
            m.id === thinkId
              ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, shadowLabel: brainResult.shadowLabel, followUps: brainResult.suggestedFollowUps }
              : m
          ));
          // Also call voice parse so ConfirmCard can execute the action
          try {
            const vr = await parseVoice.mutateAsync({ data: { transcript: raw } });
            if (vr?.actions?.length > 0) {
              setMessages(prev => [...prev, {
                id: `conf-${Date.now()}`,
                kind: "confirmation" as const,
                logId: (vr as any).logId ?? "",
                actions: vr.actions,
              }]);
            }
          } catch { /* non-fatal */ }
        } else {
          // type: 'answer' or 'error'
          setMessages(prev => prev.map(m =>
            m.id === thinkId
              ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, sources: brainResult.sources, followUps: brainResult.suggestedFollowUps, shadowLabel: brainResult.shadowLabel }
              : m
          ));
        }
        scrollToBottom();
        return;
      }
    }

    // ── Legacy path (no conversation yet, or brain failed) ───────────────────
    if (intent.type === "lens") {
      await new Promise(r => setTimeout(r, 340));
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "lens" as const, lensType: intent.lens, query: raw } : m
      ));
      scrollToBottom();
      return;
    }
    try {
      const result = await parseVoice.mutateAsync({ data: { transcript: raw } });
      if (result?.actions?.length > 0) {
        setMessages(prev => prev.map(m =>
          m.id === thinkId
            ? { id: thinkId, kind: "confirmation" as const, logId: (result as any).logId ?? "", actions: result.actions }
            : m
        ));
      } else {
        const lower = raw.toLowerCase();
        const isDataQ = QUERY_STARTERS.some(s => lower.startsWith(s));
        setMessages(prev => prev.map(m =>
          m.id === thinkId
            ? isDataQ
              ? { id: thinkId, kind: "lens" as const, lensType: "portfolio" as const, query: raw }
              : { id: thinkId, kind: "halo-response" as const, text: `Try a command: "Create invoice for [property]", "Schedule job [ID] Thursday", or say "show" to view any data.` }
            : m
        ));
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "error" as const, text: "Something went wrong. Check your connection and try again." } : m
      ));
    }
    scrollToBottom();
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const falkonMode = deriveFalkonMode(health);
  const modeStyle = FALKON_MODE_STYLES[falkonMode];
  const unread = today?.unreadNotifications ?? 0;
  const nowCount = today?.feed?.filter((c: FeedCardType) => c.tier === "now").length ?? 0;
  const pendingCount = (autopilot ?? []).filter(a => a.status === "pending").length;
  const totalNeeds = nowCount + pendingCount;

  // Seed state = no content yet. Briefing counts as content — show thread layout.
  const hasThread = messages.some(m => m.kind === "user-msg" || m.kind === "briefing");

  // ── Falkon Control Center (admin) ─────────────────────────────────────────
  const [controlOpen, setControlOpen] = useState(false);
  const isShadow = falkonMode === "SHADOW";

  // ── Render thread message ─────────────────────────────────────────────────
  const renderMsg = (msg: TMsg) => {
    switch (msg.kind) {
      case "decision-packet":
        return (
          <DecisionPacket card={msg.card}
            shadowMode={isShadow}
            onAskHalo={ctx => handleSubmit(`Tell me more about: ${ctx}`)}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, { id: `r-${Date.now()}`, kind: "success", text: "Decision recorded." }]);
            }}
          />
        );
      case "autopilot-packet":
        return (
          <DecisionPacket autopilot={msg.action}
            shadowMode={isShadow}
            onAskHalo={ctx => handleSubmit(`Tell me more about: ${ctx}`)}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, { id: `r-${Date.now()}`, kind: "success", text: "Autopilot action recorded." }]);
            }}
          />
        );
      case "user-msg":
        return <UserBubble text={msg.text} />;
      case "thinking":
        return <ThinkingBubble />;
      case "halo-response":
        return <HaloBubble text={msg.text} />;
      case "halo-answer":
        return (
          <HaloAnswerBubble
            text={msg.text}
            sources={msg.sources}
            followUps={msg.followUps}
            shadowLabel={msg.shadowLabel}
            onFollowUp={handleSubmit}
          />
        );
      case "lens":
        return <LensCard lensType={msg.lensType} query={msg.query} onDeepLink={navigate} />;
      case "confirmation":
        return (
          <ConfirmCard logId={msg.logId} actions={msg.actions}
            shadowMode={isShadow}
            onConfirmed={text => {
              setMessages(prev => prev.map(m => m.id === msg.id ? { id: msg.id, kind: "success", text } : m));
              qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
            }}
            onCancelled={() => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { id: msg.id, kind: "halo-response", text: "Cancelled — nothing was changed." } : m
              ));
            }}
          />
        );
      case "success":
        return (
          <div className="flex items-center gap-2.5 bg-[#22C55E]/8 border border-[#22C55E]/18 rounded-[13px] px-4 py-3 mb-2.5 hc-msg" style={{ animation: "hcMsgIn 0.22s ease-out both" }}>
            <CheckCircle2 className="w-[14px] h-[14px] text-[#22C55E] shrink-0" />
            <span className="text-[13px] text-[#22C55E]/85">{msg.text}</span>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-2.5 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[13px] px-4 py-3 mb-2.5 hc-msg" style={{ animation: "hcMsgIn 0.22s ease-out both" }}>
            <AlertCircle className="w-[14px] h-[14px] text-[#E11D48] shrink-0" />
            <span className="text-[13px] text-[#E11D48]/85">{msg.text}</span>
          </div>
        );
      case "walk-result":
        return <WalkResultCard items={msg.items} summary={msg.summary} />;
      case "briefing":
        return (
          <BriefingCard
            data={msg.data}
            shadowMode={falkonMode === "SHADOW"}
            onPrompt={handleSubmit}
          />
        );
      default:
        return null;
    }
  };

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Full-screen container */}
      <div className="min-h-[100dvh] h-[100dvh] bg-[#080D17] flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-2.5 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-3 shrink-0">
          <img
            src={haloLogo}
            alt="HALO"
            className="h-[22px] w-auto shrink-0"
            style={{ filter: "brightness(0) invert(1) opacity(0.88)" }}
          />

          <div className="flex-1" />

          {/* Needs-you indicator */}
          {totalNeeds > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E11D48]/10 border border-[#E11D48]/20">
              <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48]" style={{ animation: "hcBounce 1.8s ease-in-out infinite" }} />
              <span className="text-[10px] font-bold text-[#E11D48]/85">{totalNeeds} need{totalNeeds === 1 ? "s" : ""} you</span>
            </div>
          )}

          {/* Falkon mode — clickable for admins → opens Control Center */}
          <button
            onClick={() => setControlOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.14em] ${modeStyle.bg} ${modeStyle.text} hover:opacity-80 active:scale-[0.95] transition-all`}
            title="Open Falkon Control Center"
          >
            <div className={`w-1.5 h-1.5 rounded-full ${modeStyle.dot} ${falkonMode !== "SHADOW" ? "animate-pulse" : ""}`} />
            {falkonMode}
          </button>

          <FalkonNetworkPulse />

          {/* Notifications */}
          <button
            onClick={() => setNotifOpen(true)}
            className="relative w-9 h-9 rounded-full grid place-items-center bg-white/5 border border-white/8 text-white/42 hover:text-white/72 hover:bg-white/8 transition-all active:scale-[0.94]"
          >
            <Bell className="w-[14px] h-[14px]" strokeWidth={1.8} />
            {unread > 0 && (
              <span className="absolute -top-[2px] -right-[2px] min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#B4FF44] text-black text-[8px] font-bold grid place-items-center">
                {unread}
              </span>
            )}
          </button>

          {/* More */}
          <button
            onClick={() => setMoreOpen(true)}
            className="w-9 h-9 rounded-full grid place-items-center bg-white/5 border border-white/8 text-white/42 hover:text-white/72 hover:bg-white/8 transition-all active:scale-[0.94]"
          >
            <LayoutGrid className="w-[14px] h-[14px]" strokeWidth={1.8} />
          </button>
        </header>

        {/* ── Content area (seed OR thread) ─────────────────────────────── */}
        {!hasThread ? (
          /* ─── SEED STATE: Fixed centered welcome ─────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center px-5 pb-2 overflow-hidden">
            {/* Glowing halo ring */}
            <div
              className="mb-7 hc-seed-item"
              style={{ animation: "hcSeedFade 0.5s ease-out 0.05s both" }}
            >
              <div
                className="w-[72px] h-[72px] rounded-full bg-[#B4FF44]/8 border border-[#B4FF44]/20 grid place-items-center"
                style={{ animation: "hcGlow 3.5s ease-in-out infinite" }}
              >
                <HaloRing className="w-[32px] h-[32px] text-[#B4FF44]" />
              </div>
            </div>

            {/* Greeting */}
            <div
              className="text-center mb-2 hc-seed-item"
              style={{ animation: "hcSeedFade 0.5s ease-out 0.12s both" }}
            >
              <h1 className="text-[36px] font-bold text-white leading-none tracking-[-0.02em] mb-2">
                Hi, Team.
              </h1>
              <p className="text-[14px] text-white/35 font-medium">
                Ask me anything. I'll handle it.
              </p>
            </div>

            {/* Big command input */}
            <div
              className="w-full max-w-sm mt-6 mb-6 hc-seed-item"
              style={{ animation: "hcSeedFade 0.5s ease-out 0.20s both" }}
            >
              <div className="relative flex items-center bg-white/[0.052] border border-white/10 rounded-[18px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-white/15 transition-colors focus-within:border-[#B4FF44]/30 focus-within:shadow-[0_8px_32px_rgba(0,0,0,0.35),0_0_0_1px_rgba(180,255,68,0.12)] focus-within:bg-white/[0.065]">
                {/* Mic */}
                <button
                  onClick={() => { setVoiceInitial(undefined); setVoiceOpen(true); }}
                  className="ml-3 w-8 h-8 rounded-full grid place-items-center text-white/28 hover:text-[#B4FF44]/70 hover:bg-[#B4FF44]/8 transition-all active:scale-[0.92] shrink-0"
                >
                  <Mic className="w-[15px] h-[15px]" strokeWidth={2} />
                </button>

                {/* Input */}
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask HALO anything…"
                  className="flex-1 h-[54px] bg-transparent px-3 text-[14.5px] text-white placeholder:text-white/22 focus:outline-none"
                />

                {/* Send */}
                <button
                  onClick={() => handleSubmit()}
                  disabled={!input.trim() || parseVoice.isPending}
                  className="mr-3 w-9 h-9 rounded-full grid place-items-center bg-white text-[#0A0F1A] shadow-[0_2px_12px_rgba(255,255,255,0.14)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-35 disabled:scale-100 shrink-0"
                >
                  {parseVoice.isPending ? (
                    <Loader2 className="w-[13px] h-[13px] animate-spin" />
                  ) : (
                    <ChevronRight className="w-[15px] h-[15px]" strokeWidth={2.5} />
                  )}
                </button>
              </div>
            </div>

            {/* Try Asking label */}
            <div
              className="w-full max-w-sm hc-seed-item"
              style={{ animation: "hcSeedFade 0.5s ease-out 0.28s both" }}
            >
              <div className="text-[9.5px] font-bold tracking-[0.22em] uppercase text-white/22 mb-3 text-center">
                Try Asking
              </div>

              {/* 2×2 grid of prompt cards — static or brain-driven */}
              <div className="grid grid-cols-2 gap-2.5">
                {suggestedPrompts
                  ? suggestedPrompts.slice(0, 4).map((label, i) => {
                      const fallback = TRY_ASKING[i];
                      const Icon = fallback?.icon ?? Sparkles;
                      const iconColor = fallback?.iconColor ?? "#B4FF44";
                      return (
                        <button
                          key={label}
                          onClick={() => handleSubmit(label)}
                          className="flex flex-col items-start gap-2.5 p-4 rounded-[16px] bg-white/[0.038] border border-white/7 text-left hover:bg-white/[0.06] hover:border-white/12 transition-all active:scale-[0.97]"
                        >
                          <div
                            className="w-7 h-7 rounded-[9px] grid place-items-center"
                            style={{ background: `${iconColor}15`, border: `1px solid ${iconColor}25` }}
                          >
                            <Icon className="w-3.5 h-3.5" style={{ color: iconColor }} />
                          </div>
                          <span className="text-[12.5px] text-white/55 leading-snug font-medium">{label}</span>
                        </button>
                      );
                    })
                  : TRY_ASKING.map(card => {
                      const Icon = card.icon;
                      return (
                        <button
                          key={card.label}
                          onClick={() => {
                            if (card.lens) {
                              setMessages([
                                { id: `u-${Date.now()}`, kind: "user-msg" as const, text: card.query },
                                { id: `l-${Date.now()}`, kind: "lens" as const, lensType: card.lens, query: card.query },
                              ]);
                            } else {
                              handleSubmit(card.query);
                            }
                          }}
                          className="flex flex-col items-start gap-2.5 p-4 rounded-[16px] bg-white/[0.038] border border-white/7 text-left hover:bg-white/[0.06] hover:border-white/12 transition-all active:scale-[0.97]"
                        >
                          <div
                            className="w-7 h-7 rounded-[9px] grid place-items-center"
                            style={{ background: `${card.iconColor}15`, border: `1px solid ${card.iconColor}25` }}
                          >
                            <Icon className="w-3.5 h-3.5" style={{ color: card.iconColor }} />
                          </div>
                          <span className="text-[12.5px] text-white/55 leading-snug font-medium">{card.label}</span>
                        </button>
                      );
                    })}
              </div>
            </div>
          </div>
        ) : (
          /* ─── THREAD STATE ───────────────────────────────────────────── */
          <>
            {/* Thread scroll area */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 overscroll-none">
              {messages.map(msg => (
                <div key={msg.id} className="hc-msg" style={{ animation: "hcMsgIn 0.22s ease-out both" }}>
                  {renderMsg(msg)}
                </div>
              ))}

              {/* Inline prompt suggestions in thread (after each HALO response) */}
              {messages.length > 0 && messages[messages.length - 1]?.kind !== "thinking" && (
                <div className="flex gap-2 flex-wrap mt-2 mb-1">
                  {["Show all jobs", "Live crew map", "Money overview", "Units needing invoices"].map(p => (
                    <button
                      key={p}
                      onClick={() => handleSubmit(p)}
                      className="text-[11px] font-medium text-white/35 px-3 py-1.5 rounded-full bg-white/[0.028] border border-white/6 hover:text-white/60 hover:bg-white/[0.05] transition-all active:scale-[0.96]"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              )}

              <div ref={bottomRef} className="h-3" />
            </div>

            {/* Ambient strip */}
            <div className="px-4 py-2 flex items-center gap-2.5 border-t border-white/[0.04] shrink-0">
              <div className="flex gap-[3px] shrink-0">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-[3px] h-[9px] rounded-full bg-[#B4FF44]"
                    style={{ animation: `hcAmbient 2.2s ease-in-out ${i * 0.35}s infinite` }} />
                ))}
              </div>
              <span className="text-[10.5px] text-white/22 font-medium flex-1 truncate">{AMBIENT_MSGS[ambientIdx]}</span>

              {/* New chat — creates a fresh persisted conversation */}
              <button
                disabled={!brainReady}
                onClick={async () => {
                  setBrainReady(false);
                  setMessages([]);
                  setConversationId(null);
                  try { sessionStorage.removeItem("halo_convo_id"); } catch {}
                  try {
                    const created = await apiFetch("/api/command/conversations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ role: "executive" }),
                    });
                    if (created?.conversation?.id) {
                      const newId: string = created.conversation.id;
                      setConversationId(newId);
                      try { sessionStorage.setItem("halo_convo_id", newId); } catch {}
                    }
                  } catch { /* non-fatal */ }
                  setBrainReady(true);
                }}
                className="text-[10px] text-white/18 hover:text-white/45 flex items-center gap-1 transition-colors px-1.5 py-1 rounded-md hover:bg-white/5 disabled:opacity-30"
              >
                <X className="w-3 h-3" /> New chat
              </button>
            </div>

            {/* Command bar */}
            <div className="px-4 pt-2.5 pb-2 shrink-0 bg-[#080D17] border-t border-white/[0.05]">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { setVoiceInitial(undefined); setVoiceOpen(true); }}
                  className="w-11 h-11 rounded-full bg-[#B4FF44]/8 border border-[#B4FF44]/20 grid place-items-center text-[#B4FF44] hover:bg-[#B4FF44]/15 transition-all active:scale-[0.92] shrink-0"
                >
                  <Mic className="w-[16px] h-[16px]" strokeWidth={2} />
                </button>

                <div className="relative flex-1">
                  <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[#B4FF44]/38 pointer-events-none" />
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                    placeholder="Ask HALO anything…"
                    className="w-full h-11 rounded-full bg-white/5 border border-white/8 pl-[32px] pr-4 text-[13.5px] text-white placeholder:text-white/22 focus:outline-none focus:border-[#B4FF44]/35 focus:ring-1 focus:ring-[#B4FF44]/12 focus:bg-white/6 transition-all"
                  />
                </div>

                {input.trim() ? (
                  <button
                    onClick={() => handleSubmit()}
                    disabled={!brainReady || parseVoice.isPending}
                    className="w-11 h-11 rounded-full bg-white grid place-items-center text-[#0A0F1A] shadow-[0_2px_12px_rgba(255,255,255,0.14)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-55 shrink-0"
                  >
                    {parseVoice.isPending ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Send className="w-[14px] h-[14px]" strokeWidth={2.5} />}
                  </button>
                ) : (
                  <button
                    onClick={() => setWalkOpen(true)}
                    className="w-11 h-11 rounded-full bg-white/5 border border-white/8 grid place-items-center text-white/38 hover:text-[#B4FF44] hover:border-[#B4FF44]/25 hover:bg-[#B4FF44]/7 transition-all active:scale-[0.92] shrink-0"
                    title="Walk Mode"
                  >
                    <Footprints className="w-[16px] h-[16px]" strokeWidth={2} />
                  </button>
                )}
              </div>

              {/* Quick lens chips */}
              <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5 scrollbar-hide">
                {(
                  [
                    { label: "Money",     lens: "money"     as LensType, query: "Show money overview" },
                    { label: "Jobs",      lens: "timeline"  as LensType, query: "Show job timeline" },
                    { label: "Crew",      lens: "network"   as LensType, query: "Show crew and dispatch" },
                    { label: "Portfolio", lens: "portfolio" as LensType, query: "Portfolio overview" },
                    { label: "Evidence",  lens: "evidence"  as LensType, query: "Show photo evidence" },
                    { label: "Map",       lens: "map"       as LensType, query: "Live crew map" },
                  ] as const
                ).map(chip => (
                  <button
                    key={chip.label}
                    onClick={() => {
                      setMessages(prev => [...prev,
                        { id: `u-${Date.now()}`, kind: "user-msg", text: chip.query },
                        { id: `l-${Date.now()}`, kind: "lens", lensType: chip.lens, query: chip.query },
                      ]);
                      scrollToBottom();
                    }}
                    className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/7 text-[10.5px] font-bold text-white/35 hover:text-white/65 hover:bg-white/8 transition-all active:scale-[0.95]"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* ── Bottom nav strip: Chat | Work App ─────────────────────────── */}
        <div className="shrink-0 flex items-center border-t border-white/[0.05] bg-[#080D17] pb-[env(safe-area-inset-bottom)]">
          {/* Chat tab (active) */}
          <button
            className="flex-1 flex flex-col items-center gap-1 py-2.5 text-[#B4FF44]"
          >
            <div className="relative">
              <MessageSquare className="w-[18px] h-[18px]" strokeWidth={2} />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#B4FF44]" />
            </div>
            <span className="text-[9.5px] font-bold tracking-[0.06em]">Chat</span>
          </button>

          {/* Divider */}
          <div className="w-px h-8 bg-white/[0.06]" />

          {/* Work App tab */}
          <button
            onClick={() => navigate("/today")}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 text-white/28 hover:text-white/60 transition-colors active:scale-[0.95]"
          >
            <Briefcase className="w-[18px] h-[18px]" strokeWidth={1.9} />
            <span className="text-[9.5px] font-medium tracking-[0.06em]">Work App</span>
          </button>
        </div>
      </div>

      {/* ── Overlays ──────────────────────────────────────────────────────── */}
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

      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
  );
}
