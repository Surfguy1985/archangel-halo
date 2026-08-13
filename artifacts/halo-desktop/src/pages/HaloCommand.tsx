/**
 * HALO Command — Desktop conversational operating system.
 *
 * Renders inside DesktopLayout (sidebar nav stays visible — Home icon is this
 * page; Work, Clients, Money, Crews in the sidebar act as the "Work App" rail).
 *
 * Two layout states:
 *
 *   SEED   — full-height centered workspace: glowing halo ring, "Hi, Team."
 *            greeting, one large rounded command composer, four Try Asking
 *            cards. Hardware-like Apple-level polish. Matches the premium
 *            near-black screenshot reference exactly.
 *
 *   THREAD — once the user sends a message the seed content slides away and
 *            the thread fills the content area with the command bar anchored
 *            at the bottom. All lenses, confirmations, and decisions are fully
 *            functional.
 *
 * "Work App" nav: the DesktopLayout sidebar's "Home" icon is this page.
 * Sidebar items Work → /jobboard (Base44 embed + job board), Clients → /properties,
 * Money → /money provide CRM navigation. The "Work App" shortcut in the thread
 * command chips opens /work (Base44 embed).
 *
 * Falkon safeguards: SHADOW / ASSISTED / LIVE shown. Consequential actions
 * always surface a ConfirmCard.
 *
 * Thread persists at module level across route navigations.
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
  ChevronRight,
  X,
  Zap,
  DollarSign,
  MapPin,
  FileText,
  ExternalLink,
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

import { HaloRing } from "@/components/HaloRing";
import { VoiceCaptureDialog } from "@/components/VoiceCaptureDialog";
import { DecisionPacket } from "@/components/command/DecisionPacket";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { LensCard, type LensType } from "@/components/command/LensCard";
import { WalkModeOverlay } from "@/components/command/WalkModeOverlay";
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
  | { id: string; kind: "halo-answer"; text: string; sources?: Array<{ label: string; value: string }>; followUps?: string[]; shadowLabel?: string };

// ─── Module-level persistence ─────────────────────────────────────────────────

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
@keyframes hcdBounce {
  0%, 60%, 100% { transform: translateY(0); }
  30%            { transform: translateY(-5px); }
}
@keyframes hcdMsgIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes hcdAmbient {
  0%, 100% { opacity: 0.20; transform: scaleY(0.55); }
  50%       { opacity: 0.55; transform: scaleY(1); }
}
@keyframes hcdGlow {
  0%, 100% { opacity: 0.52; filter: drop-shadow(0 0 28px rgba(180,255,68,0.40)); }
  50%       { opacity: 0.88; filter: drop-shadow(0 0 52px rgba(180,255,68,0.72)); }
}
@keyframes hcdSeedIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .hcd-msg, .hcd-seed-item { animation: none !important; }
}
`;

// ─── Intent detection ─────────────────────────────────────────────────────────

const LENS_MAP: Array<{ keywords: string[]; lens: LensType }> = [
  {
    keywords: ["invoice", "invoices", "payment", "money", "margin", "revenue", "budget",
      "overdue", "outstanding", "scope", "financial", "bill", "billing", "collect",
      "paid", "unpaid", "past due", "receivable", "accounts", "needing invoic",
      "send invoice", "create invoice", "new invoice", "units.*invoic"],
    lens: "money",
  },
  {
    keywords: ["schedule", "timeline", "turn", "turns", "due this week", "late", "delay",
      "project", "sla", "unscheduled", "on deck", "deck", "upcoming", "next week",
      "work order", "job timeline", "what.*week", "structure.*day", "organize.*day",
      "what.*today", "pressing jobs", "most.*job", "active job"],
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
      "critical", "operations", "status", "summary", "what is happening",
      "active operations", "summarize", "across"],
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

const WORK_APP_PHRASES = ["work app", "crm", "legacy", "open today", "traditional", "base44", "go to work"];

function detectIntent(text: string): { type: "navigate"; path: string } | { type: "lens"; lens: LensType } | { type: "action" } | { type: "falkon" } {
  const lower = text.toLowerCase().trim();
  if (WORK_APP_PHRASES.some(p => lower.includes(p))) return { type: "navigate", path: "/work" };
  if (isFalkonFormationIntent(text)) return { type: "falkon" };
  const isQuery = QUERY_STARTERS.some(s => lower.startsWith(s));
  if (isQuery) {
    for (const { keywords, lens } of LENS_MAP) {
      if (keywords.some(k => { try { return new RegExp(k).test(lower); } catch { return lower.includes(k); } })) {
        return { type: "lens", lens };
      }
    }
    return { type: "lens", lens: "portfolio" };
  }
  for (const { keywords, lens } of LENS_MAP) {
    if (keywords.some(k => { try { return new RegExp(k).test(lower); } catch { return lower.includes(k); } })) {
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

// ─── Ambient ──────────────────────────────────────────────────────────────────

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

// ─── Try Asking cards ─────────────────────────────────────────────────────────

const TRY_ASKING: Array<{
  label: string;
  sub: string;
  icon: typeof DollarSign;
  iconColor: string;
  query: string;
  lens?: LensType;
}> = [
  {
    label: "Most pressing jobs today",
    sub: "Surfaces urgency across properties",
    icon: Zap,
    iconColor: "#F59E0B",
    query: "Most pressing jobs today",
    lens: "portfolio",
  },
  {
    label: "Live crew map",
    sub: "GPS positions + dispatch status",
    icon: MapPin,
    iconColor: "#22C55E",
    query: "Show live crew map",
    lens: "map",
  },
  {
    label: "Units needing invoices",
    sub: "Completed work, unbilled",
    icon: DollarSign,
    iconColor: "#B4FF44",
    query: "Show units needing invoices",
    lens: "money",
  },
  {
    label: "Create an invoice",
    sub: "Draft and send in seconds",
    icon: FileText,
    iconColor: "#6366F1",
    query: "Create an invoice",
  },
];

// ─── Thread sub-components ────────────────────────────────────────────────────

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-3 mb-4">
      <div className="w-[26px] h-[26px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/22 grid place-items-center shrink-0">
        <HaloRing className="w-[13px] h-[13px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/7 rounded-[18px] rounded-bl-[4px] px-5 py-3.5 flex items-center gap-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-[6px] h-[6px] rounded-full bg-[#B4FF44]/45"
            style={{ animation: `hcdBounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
        ))}
      </div>
    </div>
  );
}

function HaloBubble({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-3 mb-4 hcd-msg" style={{ animation: "hcdMsgIn 0.22s ease-out both" }}>
      <div className="w-[26px] h-[26px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/22 grid place-items-center shrink-0">
        <HaloRing className="w-[13px] h-[13px] text-[#B4FF44]" />
      </div>
      <div className="max-w-[72%] bg-[#0C1B30] border border-white/7 rounded-[18px] rounded-bl-[4px] px-5 py-3.5 shadow-sm">
        <p className="text-[14px] text-white/82 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-4 hcd-msg" style={{ animation: "hcdMsgIn 0.22s ease-out both" }}>
      <div className="max-w-[72%] bg-[#B4FF44] text-[#07101E] rounded-[18px] rounded-br-[4px] px-5 py-3.5 shadow-[0_4px_20px_rgba(180,255,68,0.22)]">
        <p className="text-[14px] font-semibold leading-relaxed">{text}</p>
      </div>
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
    <div className="mb-4 hcd-msg" style={{ animation: "hcdMsgIn 0.22s ease-out both" }}>
      {shadowLabel && (
        <div className="flex items-center gap-1.5 mb-1.5 ml-[38px]">
          <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 border border-amber-500/25 text-amber-400 uppercase tracking-wider">
            SHADOW
          </span>
          <span className="text-[10px] text-amber-400/65">Proposed — not executed</span>
        </div>
      )}
      <div className="flex items-end gap-3">
        <div className="w-[26px] h-[26px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/22 grid place-items-center shrink-0">
          <HaloRing className="w-[13px] h-[13px] text-[#B4FF44]" />
        </div>
        <div className={`max-w-[72%] rounded-[18px] rounded-bl-[4px] px-5 py-3.5 shadow-sm ${shadowLabel ? "bg-amber-950/40 border border-amber-500/20" : "bg-[#0C1B30] border border-white/7"}`}>
          <p className="text-[14px] text-white/82 leading-relaxed">{text}</p>
          {sources && sources.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 pt-2.5 border-t border-white/6">
              {sources.map((s, i) => (
                <span key={i} className="text-[10.5px] text-white/35">
                  <span className="text-white/22">{s.label}:</span> {s.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {followUps && followUps.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2 ml-[38px]">
          {followUps.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="text-[11.5px] font-medium text-white/42 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/7 hover:text-white/70 hover:bg-white/[0.07] transition-all active:scale-[0.96]"
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

  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 10_000 } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 15_000 } });
  const { data: health } = useFalkonHealth();
  const parseVoice = useParseVoice();

  const [messages, setMessages] = useState<TMsg[]>([]);

  const [input, setInput] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [walkOpen, setWalkOpen] = useState(false);

  // ── Brain conversation ─────────────────────────────────────────────────────
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("halo_desktop_convo_id"); } catch { return null; }
  });
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  // False until the conversation is validated server-side; gates submission to
  // prevent write races during init and new-chat creation.
  const [brainReady, setBrainReady] = useState(false);

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
            try { sessionStorage.setItem("halo_desktop_convo_id", convoId!); } catch {}
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
              try { sessionStorage.removeItem("halo_desktop_convo_id"); } catch {}
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
                  try { sessionStorage.setItem("halo_desktop_convo_id", freshId); } catch {}
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

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);

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

    if (intent.type === "navigate") {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      navigate(intent.path);
      return;
    }
    if (intent.type === "falkon") {
      setMessages(prev => prev.filter(m => m.id !== thinkId));
      // Falkon sheet not on desktop — fall through to brain
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
          try { sessionStorage.removeItem("halo_desktop_convo_id"); } catch {}
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
              try { sessionStorage.setItem("halo_desktop_convo_id", activeConvoId); } catch {}
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
              ? { id: thinkId, kind: "lens" as const, lensType: brainResult.lensKind as LensType, query: raw }
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
      await new Promise(r => setTimeout(r, 320));
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

  const falkonMode = deriveFalkonMode(health);
  const modeStyle = FALKON_MODE_STYLES[falkonMode];
  const nowCount = today?.feed?.filter((c: FeedCardType) => c.tier === "now").length ?? 0;
  const pendingCount = (autopilot ?? []).filter(a => a.status === "pending").length;
  const totalNeeds = nowCount + pendingCount;

  const hasThread = messages.some(m => m.kind === "user-msg");

  const renderMsg = (msg: TMsg) => {
    switch (msg.kind) {
      case "decision-packet":
        return (
          <DecisionPacket card={msg.card}
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
            onAskHalo={ctx => handleSubmit(`Tell me more about: ${ctx}`)}
            onResolved={() => {
              setMessages(prev => prev.filter(m => m.id !== msg.id));
              setMessages(prev => [...prev, { id: `r-${Date.now()}`, kind: "success", text: "Done." }]);
            }}
          />
        );
      case "user-msg": return <UserBubble text={msg.text} />;
      case "thinking": return <ThinkingBubble />;
      case "halo-response": return <HaloBubble text={msg.text} />;
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
            onConfirmed={text => {
              setMessages(prev => prev.map(m => m.id === msg.id ? { id: msg.id, kind: "success", text } : m));
              qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
            }}
            onCancelled={() => {
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { id: msg.id, kind: "halo-response", text: "Cancelled — nothing changed." } : m
              ));
            }}
          />
        );
      case "success":
        return (
          <div className="flex items-center gap-3 bg-[#22C55E]/8 border border-[#22C55E]/18 rounded-[14px] px-5 py-3.5 mb-4 hcd-msg" style={{ animation: "hcdMsgIn 0.22s ease-out both" }}>
            <CheckCircle2 className="w-[15px] h-[15px] text-[#22C55E] shrink-0" />
            <span className="text-[13.5px] text-[#22C55E]/85">{msg.text}</span>
          </div>
        );
      case "error":
        return (
          <div className="flex items-center gap-3 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[14px] px-5 py-3.5 mb-4 hcd-msg" style={{ animation: "hcdMsgIn 0.22s ease-out both" }}>
            <AlertCircle className="w-[15px] h-[15px] text-[#E11D48] shrink-0" />
            <span className="text-[13.5px] text-[#E11D48]/85">{msg.text}</span>
          </div>
        );
      default: return null;
    }
  };

  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* Fill the DesktopLayout main content area — full height flex column */}
      <div className="flex flex-col h-full min-h-[calc(100vh-120px)] bg-[#070C16]">

        {!hasThread ? (
          /* ─── SEED STATE ──────────────────────────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center px-8 py-12">
            {/* Status strip */}
            <div
              className="flex items-center gap-3 mb-12 hcd-seed-item"
              style={{ animation: "hcdSeedIn 0.45s ease-out 0s both" }}
            >
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold tracking-[0.14em] ${modeStyle.bg} ${modeStyle.text}`}>
                <div className={`w-1.5 h-1.5 rounded-full ${modeStyle.dot} ${falkonMode !== "SHADOW" ? "animate-pulse" : ""}`} />
                FALKON {falkonMode}
              </div>
              {totalNeeds > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#E11D48]/10 border border-[#E11D48]/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48] animate-pulse" />
                  <span className="text-[10px] font-bold text-[#E11D48]/85">{totalNeeds} need{totalNeeds === 1 ? "s" : ""} you</span>
                </div>
              )}
            </div>

            {/* Glowing halo ring */}
            <div
              className="mb-8 hcd-seed-item"
              style={{ animation: "hcdSeedIn 0.45s ease-out 0.06s both" }}
            >
              <div
                className="w-[88px] h-[88px] rounded-full bg-[#B4FF44]/7 border border-[#B4FF44]/18 grid place-items-center"
                style={{ animation: "hcdGlow 3.5s ease-in-out infinite" }}
              >
                <HaloRing className="w-[40px] h-[40px] text-[#B4FF44]" />
              </div>
            </div>

            {/* Greeting */}
            <div
              className="text-center mb-10 hcd-seed-item"
              style={{ animation: "hcdSeedIn 0.45s ease-out 0.13s both" }}
            >
              <h1 className="text-[52px] font-bold text-white leading-none tracking-[-0.025em] mb-3">
                Hi, Team.
              </h1>
              <p className="text-[16px] text-white/32 font-light tracking-[-0.01em]">
                Ask me anything. I'll handle it.
              </p>
            </div>

            {/* Big command input */}
            <div
              className="w-full max-w-2xl mb-10 hcd-seed-item"
              style={{ animation: "hcdSeedIn 0.45s ease-out 0.20s both" }}
            >
              <div className="relative flex items-center bg-white/[0.048] border border-white/10 rounded-[20px] overflow-hidden shadow-[0_12px_48px_rgba(0,0,0,0.40)] hover:border-white/15 transition-all focus-within:border-[#B4FF44]/30 focus-within:shadow-[0_12px_48px_rgba(0,0,0,0.40),0_0_0_1px_rgba(180,255,68,0.10)] focus-within:bg-white/[0.06]">
                {/* Mic */}
                <button
                  onClick={() => setVoiceOpen(true)}
                  className="ml-4 w-9 h-9 rounded-full grid place-items-center text-white/25 hover:text-[#B4FF44]/65 hover:bg-[#B4FF44]/7 transition-all active:scale-[0.92] shrink-0"
                >
                  <Mic className="w-[16px] h-[16px]" strokeWidth={2} />
                </button>

                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                  placeholder="Ask HALO anything…"
                  className="flex-1 h-[64px] bg-transparent px-4 text-[16px] text-white placeholder:text-white/20 focus:outline-none"
                  autoFocus
                />

                <button
                  onClick={() => handleSubmit()}
                  disabled={!input.trim() || parseVoice.isPending}
                  className="mr-4 w-10 h-10 rounded-full grid place-items-center bg-white text-[#0A0F1A] shadow-[0_2px_14px_rgba(255,255,255,0.14)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-30 disabled:scale-100 shrink-0"
                >
                  {parseVoice.isPending ? (
                    <Loader2 className="w-[15px] h-[15px] animate-spin" />
                  ) : (
                    <ChevronRight className="w-[18px] h-[18px]" strokeWidth={2.5} />
                  )}
                </button>
              </div>
            </div>

            {/* Try Asking */}
            <div
              className="w-full max-w-2xl hcd-seed-item"
              style={{ animation: "hcdSeedIn 0.45s ease-out 0.27s both" }}
            >
              <div className="text-[10px] font-bold tracking-[0.24em] uppercase text-white/20 mb-4 text-center">
                Try Asking
              </div>
              <div className="grid grid-cols-4 gap-3">
                {(suggestedPrompts ?? TRY_ASKING.map(c => c.label)).slice(0, 4).map((item, i) => {
                  const isDynamic = !!suggestedPrompts;
                  const card = TRY_ASKING[i];
                  const Icon = card?.icon ?? Sparkles;
                  const iconColor = card?.iconColor ?? "#B4FF44";
                  const label = isDynamic ? (item as string) : (item as string);
                  return (
                    <button
                      key={label}
                      onClick={() => {
                        if (!isDynamic && card?.lens) {
                          setMessages([
                            { id: `u-${Date.now()}`, kind: "user-msg" as const, text: card.query },
                            { id: `l-${Date.now()}`, kind: "lens" as const, lensType: card.lens, query: card.query },
                          ]);
                        } else {
                          handleSubmit(isDynamic ? label : (card?.query ?? label));
                        }
                      }}
                      className="flex flex-col items-start gap-3 p-5 rounded-[18px] bg-white/[0.035] border border-white/7 text-left hover:bg-white/[0.058] hover:border-white/12 transition-all active:scale-[0.97] group"
                    >
                      <div
                        className="w-8 h-8 rounded-[10px] grid place-items-center"
                        style={{ background: `${iconColor}12`, border: `1px solid ${iconColor}22` }}
                      >
                        <Icon className="w-4 h-4" style={{ color: iconColor }} />
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-white/60 leading-snug mb-1 group-hover:text-white/80 transition-colors">
                          {label}
                        </div>
                        {!isDynamic && card?.sub && (
                          <div className="text-[11px] text-white/22 leading-snug">{card.sub}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* More prompts row */}
              <div className="flex flex-wrap gap-2 mt-5 justify-center">
                {[
                  "Who's dispatched today?",
                  "What's on deck this week?",
                  "Send crew a live job link",
                  "Show active operations",
                  "Open Work App",
                ].map(p => (
                  <button
                    key={p}
                    onClick={() => handleSubmit(p)}
                    className="px-3.5 py-1.5 rounded-full bg-white/[0.028] border border-white/6 text-[12px] text-white/32 hover:text-white/60 hover:bg-white/[0.045] transition-all active:scale-[0.96]"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ─── THREAD STATE ────────────────────────────────────────────── */
          <>
            {/* Thread area */}
            <div className="flex-1 overflow-y-auto px-8 py-6 overscroll-none">
              <div className="max-w-3xl mx-auto">
                {messages.map(msg => (
                  <div key={msg.id} className="hcd-msg" style={{ animation: "hcdMsgIn 0.22s ease-out both" }}>
                    {renderMsg(msg)}
                  </div>
                ))}
                <div ref={bottomRef} className="h-4" />
              </div>
            </div>

            {/* Ambient strip */}
            <div className="border-t border-white/[0.04] px-8 py-2 flex items-center gap-3 max-w-3xl mx-auto w-full shrink-0">
              <div className="flex gap-[3px] shrink-0">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-[3px] h-[9px] rounded-full bg-[#B4FF44]"
                    style={{ animation: `hcdAmbient 2.2s ease-in-out ${i * 0.35}s infinite` }} />
                ))}
              </div>
              <span className="text-[11px] text-white/22 font-medium flex-1 truncate">{AMBIENT_MSGS[ambientIdx]}</span>
              {/* New chat — creates a fresh persisted conversation */}
              <button
                disabled={!brainReady}
                onClick={async () => {
                  setBrainReady(false);
                  setMessages([]);
                  setConversationId(null);
                  try { sessionStorage.removeItem("halo_desktop_convo_id"); } catch {}
                  try {
                    const created = await apiFetch("/api/command/conversations", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ role: "executive" }),
                    });
                    if (created?.conversation?.id) {
                      const newId: string = created.conversation.id;
                      setConversationId(newId);
                      try { sessionStorage.setItem("halo_desktop_convo_id", newId); } catch {}
                    }
                  } catch { /* non-fatal */ }
                  setBrainReady(true);
                }}
                className="flex items-center gap-1 text-[10.5px] text-white/18 hover:text-white/45 transition-colors px-2 py-1 rounded-md hover:bg-white/5 disabled:opacity-30"
              >
                <X className="w-3 h-3" /> New chat
              </button>
            </div>

            {/* Command bar */}
            <div className="px-8 pb-6 pt-3 shrink-0 border-t border-white/[0.04] bg-[#070C16]">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setVoiceOpen(true)}
                    className="w-12 h-12 rounded-full bg-[#B4FF44]/8 border border-[#B4FF44]/18 grid place-items-center text-[#B4FF44] hover:bg-[#B4FF44]/15 transition-all active:scale-[0.92] shrink-0"
                  >
                    <Mic className="w-[17px] h-[17px]" strokeWidth={2} />
                  </button>

                  <div className="relative flex-1">
                    <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-[#B4FF44]/35 pointer-events-none" />
                    <input
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                      placeholder="Ask HALO anything…"
                      className="w-full h-12 rounded-full bg-white/5 border border-white/8 pl-[38px] pr-5 text-[14px] text-white placeholder:text-white/22 focus:outline-none focus:border-[#B4FF44]/35 focus:ring-1 focus:ring-[#B4FF44]/12 focus:bg-white/6 transition-all"
                    />
                  </div>

                  {input.trim() ? (
                    <button
                      onClick={() => handleSubmit()}
                      disabled={!brainReady || parseVoice.isPending}
                      className="w-12 h-12 rounded-full bg-white grid place-items-center text-[#0A0F1A] shadow-[0_2px_14px_rgba(255,255,255,0.14)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-50 shrink-0"
                    >
                      {parseVoice.isPending ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Send className="w-[15px] h-[15px]" strokeWidth={2.5} />}
                    </button>
                  ) : (
                    <button
                      onClick={() => setWalkOpen(true)}
                      className="w-12 h-12 rounded-full bg-white/5 border border-white/8 grid place-items-center text-white/35 hover:text-[#B4FF44] hover:border-[#B4FF44]/22 hover:bg-[#B4FF44]/6 transition-all active:scale-[0.92] shrink-0"
                      title="Walk Mode"
                    >
                      <Footprints className="w-[17px] h-[17px]" strokeWidth={2} />
                    </button>
                  )}
                </div>

                {/* Quick lens chips + Work App */}
                <div className="flex gap-2 mt-3 overflow-x-auto pb-0.5 scrollbar-hide items-center">
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
                      className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/7 text-[11px] font-bold text-white/35 hover:text-white/65 hover:bg-white/8 transition-all active:scale-[0.95]"
                    >
                      {chip.label}
                    </button>
                  ))}

                  <div className="w-px h-5 bg-white/[0.07] mx-1 shrink-0" />

                  {/* Work App shortcut */}
                  <button
                    onClick={() => navigate("/work")}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.028] border border-white/6 text-[11px] font-medium text-white/28 hover:text-white/55 hover:bg-white/[0.045] transition-all active:scale-[0.95]"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Work App
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Overlays ──────────────────────────────────────────────────────── */}
      <VoiceCaptureDialog
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
      />

      {walkOpen && (
        <WalkModeOverlay
          onClose={() => setWalkOpen(false)}
          onSendToHalo={(items, summary) => {
            setMessages(prev => [...prev, {
              id: `walk-${Date.now()}`,
              kind: "halo-response",
              text: `Walk captured ${items.length} item${items.length !== 1 ? "s" : ""}. ${summary}`,
            }]);
            scrollToBottom();
          }}
        />
      )}
    </>
  );
}
