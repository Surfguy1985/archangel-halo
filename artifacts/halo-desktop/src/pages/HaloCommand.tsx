/**
 * HALO Command — Desktop conversational operating system.
 *
 * Renders inside DesktopLayout (sidebar nav stays visible).
 * One composer. Three summonable panels (Map, Kanban, Money).
 * Everything else happens in conversation.
 *
 * SEED   — ring + greeting + at most 2 critical alerts + 3 prompt chips.
 * THREAD — scrollable chat: user bubbles, HALO answers, action cards.
 * PANELS — LiveMap / Kanban / Money slide in from the right over the content.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Paperclip, ArrowUp, Loader2, CheckCircle2, AlertCircle,
  List, CalendarDays, Users, Mic, LayoutGrid, MapPin,
} from "lucide-react";

import {
  useGetToday,
  useListAutopilotActions,
  useParseVoice,
  getGetTodayQueryKey,
  getListAutopilotActionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { VoiceAction } from "@workspace/api-client-react";

import { HaloRing } from "@/components/HaloRing";
import { VoiceCaptureDialog } from "@/components/VoiceCaptureDialog";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { FalkonControlCenter } from "@/components/command/FalkonControlCenter";
import { isFalkonFormationIntent, useFalkonHealth } from "@/lib/falkonNetwork";
import { LiveMapPanel } from "@/components/panels/LiveMapPanel";
import { KanbanPanel } from "@/components/panels/KanbanPanel";
import { MoneyPanel } from "@/components/panels/MoneyPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionPlanData {
  description: string;
  risk: "auto" | "review" | "block";
  capability?: string;
  params?: Record<string, unknown>;
}

type PanelType = "map" | "kanban" | "money";

// ─── Exchange card types ──────────────────────────────────────────────────────

type ExchangeProductSummary = {
  id: string;
  productKey: string;
  name: string;
  category: string;
  pricingModel: string;
  pricePerUnit: number | null;
  slaHours: number;
  availability: string;
  status: string;
  listingCount: number;
  activeEntitlements: number;
};

type ExchangeStatusData = {
  type?: string;
  activationState: string;
  prerequisitesAllMet: boolean;
  missing: string[];
  prerequisites: Array<{ key: string; label: string; met: boolean; detail: string }>;
  hint?: string;
};

type ExchangeMsgData =
  | { kind: "exchange-product-card"; products: ExchangeProductSummary[]; activationState: string }
  | { kind: "exchange-status-card"; statusData: ExchangeStatusData };

type TMsg =
  | { id: string; kind: "user-msg"; text: string }
  | { id: string; kind: "thinking" }
  | { id: string; kind: "halo-answer"; text: string; sources?: Array<{ label: string; value: string }>; followUps?: string[] }
  | { id: string; kind: "action-plan"; plan: ActionPlanData; status: "pending" | "executing" | "done" | "error" | "declined"; result?: string }
  | { id: string; kind: "confirmation"; logId: string; actions: VoiceAction[] }
  | { id: string; kind: "panel-opened"; panel: PanelType; label: string }
  | { id: string; kind: "exchange-product-card"; products: ExchangeProductSummary[]; activationState: string }
  | { id: string; kind: "exchange-status-card"; statusData: ExchangeStatusData }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string };

// ─── Exchange result parser ───────────────────────────────────────────────────

function parseExchangeResult(result: unknown): ExchangeMsgData | null {
  if (!result || typeof result !== "string") return null;
  try {
    const p = JSON.parse(result);
    if (p.type === "exchange_products") {
      return { kind: "exchange-product-card", products: p.products ?? [], activationState: p.activationState ?? "draft" };
    }
    if (p.type === "exchange_status") {
      return { kind: "exchange-status-card", statusData: p as ExchangeStatusData };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── CSS ──────────────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes dcBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
@keyframes dcIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes haloAura {
  0%,100%{filter:drop-shadow(0 0 6px rgba(212,134,12,0.55)) drop-shadow(0 0 18px rgba(212,134,12,0.25))}
  50%{filter:drop-shadow(0 0 14px rgba(255,208,96,0.8)) drop-shadow(0 0 36px rgba(255,208,96,0.38))}
}
@media(prefers-reduced-motion:reduce){.dc-in{animation:none!important}}
`;

// ─── Angel Halo Ring ──────────────────────────────────────────────────────────

function AngelHalo() {
  return (
    <svg
      width="148" height="56" viewBox="0 0 148 56" fill="none"
      style={{ animation: "haloAura 3.2s ease-in-out infinite", display: "block" }}
    >
      <defs>
        <linearGradient id="hg-d" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%"   stopColor="#8B5209" stopOpacity="0" />
          <stop offset="18%"  stopColor="#D4880C" stopOpacity="1" />
          <stop offset="38%"  stopColor="#FFD060" stopOpacity="1" />
          <stop offset="50%"  stopColor="#FFE599" stopOpacity="1" />
          <stop offset="62%"  stopColor="#FFD060" stopOpacity="1" />
          <stop offset="82%"  stopColor="#D4880C" stopOpacity="1" />
          <stop offset="100%" stopColor="#8B5209" stopOpacity="0" />
        </linearGradient>
        <filter id="hglow-d" x="-25%" y="-100%" width="150%" height="380%">
          <feGaussianBlur stdDeviation="4" result="b1" />
          <feGaussianBlur stdDeviation="10" result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse
        cx="74" cy="28" rx="66" ry="21"
        stroke="url(#hg-d)" strokeWidth="5" fill="none"
        filter="url(#hglow-d)"
      />
    </svg>
  );
}

// ─── Falkon ───────────────────────────────────────────────────────────────────

type FalkonMode = "SHADOW" | "ASSISTED" | "LIVE";

function deriveFalkonMode(health?: { gatewayMode?: string }): FalkonMode {
  const m = health?.gatewayMode;
  if (m === "ASSISTED") return "ASSISTED";
  if (m === "LIVE") return "LIVE";
  return "SHADOW";
}

// ─── Panel intent detection ───────────────────────────────────────────────────

const PANEL_MAP: Array<{ panel: PanelType; label: string; patterns: string[] }> = [
  { panel: "map",    label: "Live Map",  patterns: ["live map","crew map","show map","open map","where are crews","gps","map"] },
  { panel: "kanban", label: "Job Board", patterns: ["job board","kanban","open board","show board","the board","show jobs","open jobs"] },
  { panel: "money",  label: "Money",     patterns: ["money","open money","show money","financials","invoices","billing","revenue","receivables"] },
];

const BRAIN_LENS_TO_PANEL: Record<string, PanelType> = {
  map: "map", crew_map: "map",
  timeline: "kanban", turn_timeline: "kanban",
  money: "money", budget_breakdown: "money", invoice_detail: "money",
};

const PANEL_ICONS: Record<PanelType, string> = { map: "📍", kanban: "📋", money: "💰" };

function detectPulseIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    /\bproperty\s*pulse\b/.test(lower) ||
    /\bopen\s+(the\s+)?pulse\b/.test(lower) ||
    /\bshow\s+(the\s+)?pulse\b/.test(lower) ||
    /\bgo\s+to\s+(the\s+)?pulse\b/.test(lower)
  );
}

function detectPanelIntent(text: string): { panel: PanelType; label: string } | null {
  const lower = text.toLowerCase().trim();
  for (const { panel, label, patterns } of PANEL_MAP) {
    if (patterns.some(p => lower.includes(p))) return { panel, label };
  }
  return null;
}

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

class ApiFetchError extends Error {
  constructor(readonly status: number, readonly body: unknown, text: string) {
    super(`${status}: ${text}`);
  }
}

async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = null;
    try { body = JSON.parse(text); } catch {}
    throw new ApiFetchError(res.status, body, text);
  }
  return res.json();
}

// ─── Bubbles ──────────────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
      <div className="max-w-[70%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-2.5 shadow-[0_4px_20px_rgba(180,255,68,0.15)]">
        <p className="text-[14px] font-semibold leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-3 mb-4">
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center shrink-0">
        <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/6 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-2">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-[5px] h-[5px] rounded-full bg-[#B4FF44]/45"
            style={{ animation: `dcBounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
        ))}
      </div>
    </div>
  );
}

function HaloAnswerBubble({ text, sources, followUps, onFollowUp }: {
  text: string;
  sources?: Array<{ label: string; value: string }>;
  followUps?: string[];
  onFollowUp: (q: string) => void;
}) {
  return (
    <div className="mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
      <div className="flex items-end gap-3">
        <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center shrink-0">
          <HaloRing className="w-[11px] h-[11px] text-[#B4FF44]" />
        </div>
        <div className="max-w-[80%] bg-[#0C1B30] border border-white/6 rounded-[16px] rounded-bl-[4px] px-4 py-3">
          <p className="text-[14px] text-white/80 leading-relaxed whitespace-pre-wrap">{text}</p>
          {sources && sources.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pt-2 border-t border-white/[0.05]">
              {sources.map((s, i) => (
                <span key={i} className="text-[10.5px] text-white/28">
                  <span className="text-white/16">{s.label}:</span> {s.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {followUps && followUps.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2 ml-[34px]">
          {followUps.slice(0, 3).map((q, i) => (
            <button type="button" key={i} onClick={() => onFollowUp(q)}
              className="text-[11.5px] font-medium text-white/38 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/6 hover:text-white/60 hover:bg-white/[0.07] transition-all active:scale-[0.97]">
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelOpenedChip({ panel, label, onReopen }: { panel: PanelType; label: string; onReopen: () => void }) {
  return (
    <div className="flex mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
      <button type="button" onClick={onReopen}
        className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
        <span className="text-[12px]">{PANEL_ICONS[panel]}</span>
        <span className="text-[12px] text-white/45">{label} — click to reopen</span>
      </button>
    </div>
  );
}

// ─── ActionPlanCard ───────────────────────────────────────────────────────────

function ActionPlanCard({ msg, falkonMode, onExecute, onDecline }: {
  msg: { plan: ActionPlanData; status: string; result?: string };
  falkonMode: FalkonMode;
  onExecute: () => void;
  onDecline: () => void;
}) {
  const isShadow = falkonMode === "SHADOW";
  const isBlock = msg.plan.risk === "block";

  if (msg.status === "executing") return (
    <div className="flex items-center gap-3 bg-[#B4FF44]/6 border border-[#B4FF44]/15 rounded-[14px] px-4 py-3.5 mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
      <Loader2 className="w-4 h-4 text-[#B4FF44] animate-spin shrink-0" />
      <div>
        <span className="text-[13px] text-[#B4FF44]/80 font-medium">Executing…</span>
        <p className="text-[11.5px] text-white/30 mt-0.5">{msg.plan.description}</p>
      </div>
    </div>
  );

  if (msg.status === "done") return (
    <div className="flex items-center gap-3 bg-[#22C55E]/7 border border-[#22C55E]/18 rounded-[14px] px-4 py-3.5 mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
      <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
      <div>
        <span className="text-[13px] text-[#22C55E]/90 font-medium">Done</span>
        <p className="text-[11.5px] text-white/35 mt-0.5">{msg.result ?? msg.plan.description}</p>
      </div>
    </div>
  );

  if (msg.status === "error") return (
    <div className="flex items-center gap-3 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[14px] px-4 py-3.5 mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
      <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0" />
      <span className="text-[13px] text-[#E11D48]/80">Action failed — try again or handle manually.</span>
    </div>
  );

  if (msg.status === "declined") return (
    <div className="mb-4"><span className="text-[12px] text-white/22">Cancelled — nothing changed.</span></div>
  );

  const riskColor = isBlock ? "#E11D48" : msg.plan.risk === "review" ? "#F59E0B" : "#B4FF44";
  const riskLabel = isBlock ? "BLOCKED" : msg.plan.risk === "review" ? "REVIEW" : isShadow ? "SHADOW" : "READY";

  return (
    <div className="rounded-[16px] border border-white/8 px-4 py-4 mb-4"
      style={{ background: isBlock ? "rgba(225,29,72,0.06)" : isShadow ? "rgba(245,158,11,0.05)" : "rgba(10,22,40,0.9)", animation: "dcIn 0.2s ease-out both" }}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[9px] font-bold tracking-[0.16em] uppercase px-2 py-0.5 rounded border"
          style={{ background: `${riskColor}12`, borderColor: `${riskColor}28`, color: riskColor }}>
          {riskLabel}
        </span>
        {!isShadow && !isBlock && falkonMode === "ASSISTED" && (
          <span className="text-[10.5px] text-white/22">Falkon ASSISTED</span>
        )}
      </div>
      <p className="text-[13.5px] text-white/75 leading-relaxed mb-4">{msg.plan.description}</p>
      {!isBlock && !isShadow && (
        <div className="flex gap-2">
          <button type="button" onClick={onExecute}
            className="flex-1 h-9 rounded-[10px] bg-[#B4FF44] text-[#07101E] text-[12.5px] font-bold hover:bg-[#c8ff6e] active:scale-[0.97] transition-all">
            {msg.plan.risk === "review" ? "Approve & Execute" : "Execute"}
          </button>
          <button type="button" onClick={onDecline}
            className="h-9 px-4 rounded-[10px] bg-white/5 border border-white/8 text-[12.5px] text-white/40 hover:text-white/65 hover:bg-white/8 transition-all">
            Cancel
          </button>
        </div>
      )}
      {(isShadow || isBlock) && (
        <p className="text-[11.5px] text-white/25 mt-1">
          {isShadow ? "Switch to ASSISTED mode to execute." : "Contact your administrator."}
        </p>
      )}
    </div>
  );
}

// ─── Seed card data ───────────────────────────────────────────────────────────

const SEED_CARDS = [
  { Icon: LayoutGrid,   color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Open Property Pulse", title: "Property Pulse", desc: "Live sites, GPS, and crew pings." },
  { Icon: List,         color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "What needs my attention right now?", title: "Mission brief", desc: "What is on fire this hour." },
  { Icon: CalendarDays, color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Make a note to order drywall for unit 624 and text Kyann to schedule install for tomorrow", title: "Run a mission", desc: "Note, source, schedule, text." },
  { Icon: Users,        color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Generate a check-in link for the crew on site today", title: "Crew link", desc: "Send a check-in link instantly." },
];

function SeedCard({ card, onSubmit }: { card: typeof SEED_CARDS[number]; onSubmit: (s: string) => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onSubmit(card.prompt)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        textAlign: "left", padding: "14px",
        borderRadius: 12,
        background: hov ? "rgba(255,255,255,0.052)" : "rgba(255,255,255,0.032)",
        border: `1px solid ${hov ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.065)"}`,
        transition: "all 0.18s ease", cursor: "pointer",
        transform: hov ? "translateY(-1px)" : "none",
      }}
    >
      <div style={{ width: 28, height: 28, borderRadius: 7, background: card.bg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 10 }}>
        <card.Icon size={14} color={card.color} strokeWidth={2} />
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.82)", lineHeight: 1.35, marginBottom: 6 }}>{card.title}</p>
      <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.3)", lineHeight: 1.45 }}>{card.desc}</p>
    </button>
  );
}

// ─── Wings icon ───────────────────────────────────────────────────────────────

function WingsIcon() {
  return (
    <svg width="22" height="14" viewBox="0 0 22 14" fill="none" style={{ opacity: 0.35 }}>
      <path d="M11 7C9.5 4.5 6 2 2 2C2 5 4 8 7 9.5L11 7Z" fill="white" />
      <path d="M11 7C12.5 4.5 16 2 20 2C20 5 18 8 15 9.5L11 7Z" fill="white" />
      <ellipse cx="11" cy="7" rx="1.5" ry="1" fill="white" />
    </svg>
  );
}

// ─── Shared composer ──────────────────────────────────────────────────────────

function ComposerInput({ value, onChange, onSubmit, onVoice, busy }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVoice?: () => void;
  busy: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div style={{
      display: "flex", alignItems: "center",
      background: focused ? "rgba(255,255,255,0.052)" : "rgba(255,255,255,0.038)",
      border: `1px solid ${focused ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.08)"}`,
      borderRadius: 16,
      boxShadow: focused ? "0 0 0 3px rgba(255,255,255,0.03), 0 8px 40px rgba(0,0,0,0.4)" : "0 4px 32px rgba(0,0,0,0.35)",
      transition: "all 0.18s ease",
      padding: "6px 8px 6px 10px",
    }}>
      <button type="button" onClick={onVoice} aria-label="Talk to HALO" style={{ width: 36, height: 36, borderRadius: "50%", color: "rgba(255,255,255,0.45)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Mic size={16} strokeWidth={2} />
      </button>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Command HALO…"
        style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontSize: 15, color: "rgba(255,255,255,0.9)", caretColor: "#B4FF44", padding: "10px 12px", minHeight: 44 }}
      />
      <Paperclip size={14} strokeWidth={2} style={{ color: "rgba(255,255,255,0.2)", flexShrink: 0, marginRight: 8 }} />
      <button
        type="button" onClick={onSubmit} disabled={!value.trim() || busy}
        style={{ width: 36, height: 36, borderRadius: "50%", flexShrink: 0, cursor: "pointer", background: value.trim() ? "#B4FF44" : "rgba(255,255,255,0.08)", border: "none", display: "grid", placeItems: "center", color: value.trim() ? "#07101E" : "rgba(255,255,255,0.3)", boxShadow: value.trim() ? "0 0 18px rgba(180,255,68,0.35)" : "none", transition: "all 0.18s ease", opacity: busy ? 0.5 : 1 }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={15} strokeWidth={2.2} />}
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HaloCommand() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 15_000 } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 20_000 } });
  const { data: health } = useFalkonHealth();
  const parseVoice = useParseVoice();

  const [messages, setMessages] = useState<TMsg[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("halo_desktop_convo_id"); } catch { return null; }
  });
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  const [brainReady, setBrainReady] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelType | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollDown = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);

  // ── Brain init ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const data = await apiFetch("/api/command/conversations");
        if (cancelled) return;
        if (data.suggestedPrompts) setSuggestedPrompts(data.suggestedPrompts);

        let convoId = conversationId;
        if (!convoId) {
          const created = await apiFetch("/api/command/conversations", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "executive" }),
          });
          if (!cancelled && created?.conversation?.id) {
            convoId = created.conversation.id;
            setConversationId(convoId);
            try { sessionStorage.setItem("halo_desktop_convo_id", convoId!); } catch {}
          }
        }

        if (convoId) {
          try {
            const msgData = await apiFetch(`/api/command/conversations/${convoId}/messages?limit=30`);
            if (cancelled) return;
            const restored: TMsg[] = (msgData.messages ?? []).flatMap((m: any) => {
              if (m.role === "user") return [{ id: `r-${m.id}`, kind: "user-msg" as const, text: m.content }];
              if (m.role === "assistant" && m.content) return [{ id: `r-${m.id}`, kind: "halo-answer" as const, text: m.content }];
              return [];
            });
            setMessages(restored);
          } catch (e: any) {
            if (e?.message?.startsWith("404")) {
              setMessages([]);
              try { sessionStorage.removeItem("halo_desktop_convo_id"); } catch {}
              setConversationId(null);
            }
          }
        }
      } catch { /* non-fatal */ }
    }
    init().finally(() => { if (!cancelled) setBrainReady(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPanel = useCallback((panel: PanelType, label: string, addChip?: boolean) => {
    setActivePanel(panel);
    if (addChip) {
      setMessages(prev => [...prev, { id: `panel-${Date.now()}`, kind: "panel-opened" as const, panel, label }]);
      scrollDown();
    }
  }, [scrollDown]);

  const handleSubmit = useCallback(async (text?: string) => {
    if (!brainReady) return;
    const raw = (text ?? input).trim();
    if (!raw) return;
    setInput("");

    const userId = `u-${Date.now()}`;
    const thinkId = `t-${Date.now()}`;
    setMessages(prev => [...prev,
      { id: userId, kind: "user-msg" as const, text: raw },
      { id: thinkId, kind: "thinking" as const },
    ]);
    scrollDown();

    if (detectPulseIntent(raw)) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: "Opening Property Pulse." } : m
      ));
      navigate("/pulse");
      return;
    }

    const panelIntent = detectPanelIntent(raw);
    if (panelIntent) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: `Opening ${panelIntent.label}.` } : m
      ));
      openPanel(panelIntent.panel, panelIntent.label, true);
      return;
    }

    let convoId = conversationId;
    let brainResult: any = null;

    if (convoId) {
      try {
        brainResult = await apiFetch(`/api/command/conversations/${convoId}/ask`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: raw, role: "executive" }),
        });
      } catch (e: any) {
        if (e?.message?.startsWith("404")) {
          setMessages([]);
          try { sessionStorage.removeItem("halo_desktop_convo_id"); } catch {}
          setConversationId(null);
          try {
            const fresh = await apiFetch("/api/command/conversations", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "executive" }),
            });
            if (fresh?.conversation?.id) {
              convoId = fresh.conversation.id;
              setConversationId(convoId);
              try { sessionStorage.setItem("halo_desktop_convo_id", convoId!); } catch {}
              brainResult = await apiFetch(`/api/command/conversations/${convoId}/ask`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: raw, role: "executive" }),
              });
            }
          } catch { /* fall through */ }
        }
      }
    }

    if (brainResult) {
      if (brainResult.type === "lens" && brainResult.lensKind) {
        const panel = BRAIN_LENS_TO_PANEL[brainResult.lensKind as string];
        if (panel) {
          const meta = PANEL_MAP.find(p => p.panel === panel);
          const label = meta?.label ?? brainResult.lensKind;
          setMessages(prev => prev.map(m =>
            m.id === thinkId
              ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text || `Opening ${label}.`, followUps: brainResult.suggestedFollowUps }
              : m
          ));
          openPanel(panel, label, true);
          return;
        }
      }

      if (brainResult.type === "voice_action") {
        setMessages(prev => prev.map(m =>
          m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, followUps: brainResult.suggestedFollowUps } : m
        ));
        const plans: ActionPlanData[] = Array.isArray(brainResult.actionPlans) && brainResult.actionPlans.length
          ? brainResult.actionPlans
          : brainResult.actionPlan
            ? [brainResult.actionPlan as ActionPlanData]
            : [];
        const falkonMode = deriveFalkonMode(health);
        if (plans.length) {
          for (let i = 0; i < plans.length; i++) {
            const plan = plans[i]!;
            const planId = `plan-${Date.now()}-${i}`;
          if (plan.risk === "auto" && falkonMode === "ASSISTED") {
            setMessages(prev => [...prev, { id: planId, kind: "action-plan" as const, plan, status: "executing" as const }]);
            scrollDown();
            try {
              const r = await apiFetch("/api/command/actions/execute", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(plan),
              });
              const exData = parseExchangeResult(r.result);
              if (exData) {
                setMessages(prev => [
                  ...prev.map(m => m.id === planId ? { ...m as any, status: "done" as const } : m),
                  { id: `ex-${Date.now()}`, ...exData },
                ]);
              } else {
                setMessages(prev => prev.map(m => m.id === planId ? { ...m as any, status: "done" as const, result: r.result } : m));
              }
            } catch (err) {
              const apiErr = err instanceof ApiFetchError ? err : null;
              if (apiErr?.status === 403 && (apiErr.body as any)?.gateBlocked) {
                // Policy gate blocked auto-execution — downgrade to pending so user can still approve
                const summary = (apiErr.body as any).summary ?? "Policy approval required.";
                setMessages(prev => [
                  ...prev.map(m => m.id === planId ? { ...m as any, status: "pending" as const } : m),
                  { id: `gate-${Date.now()}`, kind: "halo-answer" as const, text: `🔒 ${summary} Tap Approve to proceed.` },
                ]);
              } else {
                setMessages(prev => prev.map(m => m.id === planId ? { ...m as any, status: "error" as const } : m));
              }
            }
          } else {
            setMessages(prev => [...prev, { id: planId, kind: "action-plan" as const, plan, status: "pending" as const }]);
          }
          }
        } else {
          try {
            const vr = await parseVoice.mutateAsync({ data: { transcript: raw } });
            if (vr?.actions?.length > 0) {
              setMessages(prev => [...prev, {
                id: `conf-${Date.now()}`, kind: "confirmation" as const,
                logId: (vr as any).logId ?? "", actions: vr.actions,
              }]);
            }
          } catch { /* non-fatal */ }
        }
        scrollDown();
        return;
      }

      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, sources: brainResult.sources, followUps: brainResult.suggestedFollowUps }
          : m
      ));
      scrollDown();
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
        setMessages(prev => prev.map(m =>
          m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: "Try a command like \"send invoice for [property]\" or ask a question." } : m
        ));
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "error" as const, text: "Connection error — try again." } : m
      ));
    }
    scrollDown();
  }, [brainReady, input, conversationId, health, openPanel, parseVoice, scrollDown, navigate]);

  const falkonMode = deriveFalkonMode(health);
  const nowCount = (today?.feed ?? []).filter((c: any) => c.tier === "now").length;
  const pendingCount = (autopilot ?? []).filter((a: any) => a.status === "pending").length;
  const hasThread = messages.some(m => m.kind === "user-msg");

  const promptChips = suggestedPrompts?.slice(0, 3) ?? [
    "Open Property Pulse",
    "What needs my attention?",
    "Show unpaid invoices",
  ];

  const renderMsg = (msg: TMsg) => {
    switch (msg.kind) {
      case "user-msg": return <UserBubble text={msg.text} />;
      case "thinking": return <ThinkingBubble />;
      case "halo-answer": return <HaloAnswerBubble text={msg.text} sources={msg.sources} followUps={msg.followUps} onFollowUp={handleSubmit} />;
      case "action-plan": {
        const planMsg = msg;
        return (
          <ActionPlanCard
            msg={planMsg} falkonMode={falkonMode}
            onExecute={async () => {
              setMessages(prev => prev.map(m => m.id === planMsg.id ? { ...m as any, status: "executing" as const } : m));
              try {
                const r = await apiFetch("/api/command/actions/execute", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(planMsg.plan),
                });
                const exData = parseExchangeResult(r.result);
                if (exData) {
                  setMessages(prev => [
                    ...prev.map(m => m.id === planMsg.id ? { ...m as any, status: "done" as const } : m),
                    { id: `ex-${Date.now()}`, ...exData },
                  ]);
                } else {
                  setMessages(prev => prev.map(m => m.id === planMsg.id ? { ...m as any, status: "done" as const, result: r.result } : m));
                }
                qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
              } catch {
                setMessages(prev => prev.map(m => m.id === planMsg.id ? { ...m as any, status: "error" as const } : m));
              }
            }}
            onDecline={() => setMessages(prev => prev.map(m =>
              m.id === planMsg.id ? { ...m as any, status: "declined" as const } : m
            ))}
          />
        );
      }
      case "confirmation": return (
        <ConfirmCard
          logId={msg.logId} actions={msg.actions} shadowMode={falkonMode === "SHADOW"}
          onConfirmed={text => {
            setMessages(prev => prev.map(m => m.id === msg.id ? { id: msg.id, kind: "success", text } : m));
            qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
          }}
          onCancelled={() => setMessages(prev => prev.map(m =>
            m.id === msg.id ? { id: msg.id, kind: "halo-answer", text: "Cancelled — nothing was changed." } : m
          ))}
        />
      );
      case "panel-opened": return <PanelOpenedChip panel={msg.panel} label={msg.label} onReopen={() => setActivePanel(msg.panel)} />;
      case "exchange-product-card": return (
        <div style={{ background: "rgba(180,255,68,0.035)", border: "1px solid rgba(180,255,68,0.1)", borderRadius: 14, padding: "12px 16px", marginBottom: 12, animation: "dcIn 0.2s ease-out both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(180,255,68,0.65)", textTransform: "uppercase" }}>Falkon Exchange</span>
            <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>{msg.activationState}</span>
          </div>
          {msg.products.length === 0
            ? <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)" }}>No products found.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {msg.products.map(p => (
                  <div key={p.id} style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 10, padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.82)", flex: 1 }}>{p.name}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.28)", textTransform: "uppercase", background: "rgba(255,255,255,0.055)", borderRadius: 4, padding: "1px 6px" }}>{p.category}</span>
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>{p.pricePerUnit != null ? `$${(p.pricePerUnit / 100).toLocaleString()} / ${p.pricingModel.replace(/_/g, " ")}` : "Custom pricing"}</span>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{p.slaHours}h SLA</span>
                      {p.activeEntitlements > 0 && <span style={{ fontSize: 11, color: "rgba(180,255,68,0.6)" }}>{p.activeEntitlements} partner{p.activeEntitlements !== 1 ? "s" : ""}</span>}
                    </div>
                  </div>
                ))}
              </div>
          }
        </div>
      );
      case "exchange-status-card": return (
        <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "12px 16px", marginBottom: 12, animation: "dcIn 0.2s ease-out both" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(180,255,68,0.65)", textTransform: "uppercase" }}>Exchange Activation</span>
            <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 6, background: msg.statusData.prerequisitesAllMet ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.09)", color: msg.statusData.prerequisitesAllMet ? "rgba(34,197,94,0.8)" : "rgba(245,158,11,0.75)" }}>{msg.statusData.activationState}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {(msg.statusData.prerequisites ?? []).map(p => (
              <div key={p.key} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: p.met ? "rgba(34,197,94,0.12)" : "rgba(225,29,72,0.1)", border: `1px solid ${p.met ? "rgba(34,197,94,0.3)" : "rgba(225,29,72,0.22)"}`, flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: p.met ? "#22C55E" : "#E11D48", fontWeight: 700 }}>{p.met ? "✓" : "✗"}</div>
                <div>
                  <div style={{ fontSize: 12.5, color: p.met ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.42)", fontWeight: 500 }}>{p.label}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.28)", marginTop: 2, lineHeight: 1.4 }}>{p.detail}</div>
                </div>
              </div>
            ))}
          </div>
          {msg.statusData.hint && <div style={{ marginTop: 10, fontSize: 11.5, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>{msg.statusData.hint}</div>}
        </div>
      );
      case "success": return (
        <div className="flex items-center gap-2.5 bg-[#22C55E]/7 border border-[#22C55E]/15 rounded-[13px] px-4 py-3 mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
          <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
          <span className="text-[13.5px] text-[#22C55E]/82">{msg.text}</span>
        </div>
      );
      case "error": return (
        <div className="flex items-center gap-2.5 bg-[#E11D48]/7 border border-[#E11D48]/15 rounded-[13px] px-4 py-3 mb-4" style={{ animation: "dcIn 0.2s ease-out both" }}>
          <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0" />
          <span className="text-[13.5px] text-[#E11D48]/82">{msg.text}</span>
        </div>
      );
      default: return null;
    }
  };

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div className="halo-void h-full flex flex-col">

        <header className="flex items-center gap-2 px-6 pt-4 pb-2 shrink-0 relative z-10">
          <span className="font-display text-white/80 text-[15px] font-semibold tracking-tight">HALO</span>
          <span className="halo-hud text-[#B4FF44]/70 ml-2">Mission control</span>
          <div className="flex-1" />
          <button type="button" onClick={() => openPanel("map", "Live Map")} className="w-9 h-9 rounded-full grid place-items-center text-white/40 hover:text-[#B4FF44]" aria-label="Live map">
            <MapPin className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => navigate("/pulse")} className="w-9 h-9 rounded-full grid place-items-center text-[#B4FF44] hover:text-white" aria-label="Property Pulse">
            <LayoutGrid className="w-4 h-4" />
          </button>
        </header>

        {!hasThread ? (
          /* ── SEED STATE ─────────────────────────────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-y-auto">
            <div className="w-full max-w-[680px] flex flex-col items-center py-10">

              {/* Angel halo ring */}
              <div style={{ animation: "dcIn 0.5s ease-out 0.02s both", marginBottom: 22 }}>
                <AngelHalo />
              </div>

              {/* Greeting */}
              <div className="text-center" style={{ animation: "dcIn 0.5s ease-out 0.1s both", marginBottom: 32 }}>
                <h1 className="font-display" style={{
                  fontSize: "clamp(42px, 5vw, 64px)", fontWeight: 600,
                  color: "#F4F7F9", lineHeight: 1.02, letterSpacing: "-0.04em",
                  marginBottom: 10,
                }}>
                  HALO
                </h1>
                <p className="halo-hud" style={{ color: "rgba(180,255,68,0.7)", marginBottom: 12 }}>
                  Mission control
                </p>
                <p style={{ fontSize: 15, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                  Speak it. HALO sources, schedules, and texts on the backend.
                </p>
                {/* Inline urgent indicator */}
                {(nowCount > 0 || pendingCount > 0) && (
                  <p style={{ marginTop: 10, fontSize: 13, color: "rgba(255,255,255,0.35)" }}>
                    <span style={{ color: "rgba(225,29,72,0.85)", fontWeight: 600 }}>
                      {nowCount + pendingCount} item{nowCount + pendingCount !== 1 ? "s" : ""}
                    </span>
                    {" "}need your attention
                  </p>
                )}
              </div>

              {/* Composer */}
              <div className="w-full" style={{ animation: "dcIn 0.5s ease-out 0.18s both", marginBottom: 28 }}>
                <ComposerInput value={input} onChange={setInput} onSubmit={() => handleSubmit()} onVoice={() => setVoiceOpen(true)} busy={parseVoice.isPending} />
              </div>

              {/* TRY ASKING label */}
              <div className="w-full" style={{ animation: "dcIn 0.5s ease-out 0.26s both" }}>
                <p style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: "0.18em",
                  color: "rgba(255,255,255,0.22)", textTransform: "uppercase",
                  marginBottom: 12,
                }}>
                  Try Asking
                </p>

                {/* 4 suggestion cards */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  {SEED_CARDS.map((card, i) => (
                    <SeedCard key={i} card={card} onSubmit={handleSubmit} />
                  ))}
                </div>
              </div>

              {/* Footer disclaimer */}
              <div style={{
                marginTop: 32, display: "flex", alignItems: "center",
                gap: 8, animation: "dcIn 0.5s ease-out 0.34s both",
              }}>
                <WingsIcon />
                <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.22)" }}>
                  Halo can make mistakes. Always verify critical information.
                </span>
              </div>

            </div>
          </div>
        ) : (
          /* THREAD STATE */
          <>
            <div className="flex-1 overflow-y-auto px-6 pt-5 pb-3 max-w-3xl mx-auto w-full">
              {messages.map(msg => (
                <div key={msg.id}>{renderMsg(msg)}</div>
              ))}
              <div ref={bottomRef} className="h-4" />
            </div>

            <div className="px-6 py-4 border-t border-white/[0.04] shrink-0">
              <div className="max-w-3xl mx-auto">
                <ComposerInput value={input} onChange={setInput} onSubmit={() => handleSubmit()} onVoice={() => setVoiceOpen(true)} busy={parseVoice.isPending} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Panels */}
      <LiveMapPanel open={activePanel === "map"}    onClose={() => setActivePanel(null)} />
      <KanbanPanel  open={activePanel === "kanban"} onClose={() => setActivePanel(null)} />
      <MoneyPanel   open={activePanel === "money"}  onClose={() => setActivePanel(null)} />

      {/* Overlays */}
      <VoiceCaptureDialog open={voiceOpen} onOpenChange={setVoiceOpen} onHeard={(text) => { void handleSubmit(text); }} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
  );
}

