/**
 * HALO Command — the entire operating interface.
 *
 * One dark shell. One composer. Three summonable panels (Map, Kanban, Money).
 * Everything else happens in conversation.
 *
 * SEED  — greeting + optional urgent count + composer + 4 understated prompt chips.
 * THREAD — scrollable chat: user bubbles, HALO answers, action cards.
 * PANELS — LiveMap / JobKanban / Money slide over the chat, return to thread.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Mic, Bell, MoreHorizontal, Send, Loader2,
  CheckCircle2, AlertCircle, MapPin, Columns3, CircleDollarSign,
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

import haloLogo from "../assets/halo-logo.png";
import { VoiceCaptureSheet } from "@/components/VoiceCaptureSheet";
import { NotificationsDrawer } from "@/components/NotificationsDrawer";
import { MinimalMenuSheet } from "@/components/MinimalMenuSheet";
import { FalkonControlCenter } from "@/components/command/FalkonControlCenter";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { LiveMapPanel } from "@/components/panels/LiveMapPanel";
import { KanbanPanel } from "@/components/panels/KanbanPanel";
import { MoneyPanel } from "@/components/panels/MoneyPanel";
import { LiveLinkCard, type LiveLinkData } from "@/components/LiveLinkCard";
import { useFalkonHealth } from "@/lib/falkonNetwork";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionPlanData {
  description: string;
  risk: "auto" | "review" | "block";
  capability?: string;
  params?: Record<string, unknown>;
}

type PanelType = "map" | "kanban" | "money";

type TMsg =
  | { id: string; kind: "user-msg"; text: string }
  | { id: string; kind: "thinking" }
  | { id: string; kind: "halo-answer"; text: string; sources?: Array<{ label: string; value: string }>; followUps?: string[] }
  | { id: string; kind: "action-plan"; plan: ActionPlanData; status: "pending" | "executing" | "done" | "error" | "declined"; result?: string }
  | { id: string; kind: "confirmation"; logId: string; actions: VoiceAction[] }
  | { id: string; kind: "panel-opened"; panel: PanelType; label: string }
  | { id: string; kind: "live-link-card"; data: LiveLinkData }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string };

// ─── Live link result parser ──────────────────────────────────────────────────

function parseLiveLinkResult(result: unknown): LiveLinkData | null {
  if (!result || typeof result !== "string") return null;
  try {
    const p = JSON.parse(result);
    if (p.type === "live_link") {
      return { kind: "pm_link", propertyName: p.propertyName, url: p.url, token: p.token, smsText: p.smsText, expiresAt: p.expiresAt };
    }
    if (p.type === "crew_link") {
      return { kind: "crew_checkin", crewName: p.crewName, url: p.url, token: p.token, smsText: p.smsText, expiresAt: p.expiresAt };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Keyframes ────────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes hcBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-4px)} }
@keyframes hcFadeUp { from{opacity:0;transform:translateY(7px)} to{opacity:1;transform:translateY(0)} }
@keyframes hcPulseRed { 0%,100%{opacity:0.7} 50%{opacity:1} }
@media(prefers-reduced-motion:reduce){.hc-in{animation:none!important}}
`;

// ─── Falkon mode ──────────────────────────────────────────────────────────────

type FalkonMode = "SHADOW" | "ASSISTED" | "LIVE";

function deriveFalkonMode(health?: { gatewayMode?: string }): FalkonMode {
  const m = health?.gatewayMode;
  if (m === "ASSISTED") return "ASSISTED";
  if (m === "LIVE") return "LIVE";
  return "SHADOW";
}

const MODE_STYLE: Record<FalkonMode, { bg: string; text: string; dot: string }> = {
  SHADOW:   { bg: "bg-white/[0.05] border border-white/[0.09]",       text: "text-white/30",     dot: "bg-white/20" },
  ASSISTED: { bg: "bg-[#B4FF44]/[0.07] border border-[#B4FF44]/[0.18]", text: "text-[#B4FF44]/75", dot: "bg-[#B4FF44] animate-pulse" },
  LIVE:     { bg: "bg-[#22C55E]/[0.07] border border-[#22C55E]/[0.16]", text: "text-[#22C55E]/75", dot: "bg-[#22C55E] animate-pulse" },
};

// ─── Panel metadata ───────────────────────────────────────────────────────────

const PANEL_MAP: Array<{ panel: PanelType; label: string; patterns: string[] }> = [
  { panel: "map",    label: "Live Map",  patterns: ["live map","crew map","show map","open map","where are crews","crew location","gps","map"] },
  { panel: "kanban", label: "Job Board", patterns: ["job board","kanban","open board","show board","the board","show jobs","open jobs","jobs board"] },
  { panel: "money",  label: "Money",     patterns: ["money","open money","show money","financials","invoices","billing","revenue","receivables","open invoices"] },
];

const BRAIN_LENS_TO_PANEL: Record<string, PanelType> = {
  map: "map", crew_map: "map",
  timeline: "kanban", turn_timeline: "kanban",
  money: "money", budget_breakdown: "money", invoice_detail: "money",
};

function detectPanelIntent(text: string): { panel: PanelType; label: string } | null {
  const lower = text.toLowerCase().trim();
  for (const { panel, label, patterns } of PANEL_MAP) {
    if (patterns.some(p => lower.includes(p))) return { panel, label };
  }
  return null;
}

const PANEL_ICON = {
  map:    MapPin,
  kanban: Columns3,
  money:  CircleDollarSign,
} as const;

// ─── Greeting ─────────────────────────────────────────────────────────────────

function timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning.";
  if (h < 17) return "Good afternoon.";
  return "Good evening.";
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// ─── Message components ───────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-4 hc-in" style={{ animation: "hcFadeUp 0.18s ease-out both" }}>
      <div
        className="max-w-[82%] rounded-[18px] rounded-br-[5px] px-[18px] py-[11px]"
        style={{ background: "#B4FF44" }}
      >
        <p className="text-[14px] font-medium text-[#06100E] leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-center gap-[5px] mb-5 pl-1" style={{ height: 28 }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="w-[5px] h-[5px] rounded-full"
          style={{
            background: "rgba(180,255,68,0.38)",
            animation: `hcBounce 1.2s ease-in-out ${i * 0.16}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function HaloAnswerBubble({
  text, sources, followUps, onFollowUp,
}: {
  text: string;
  sources?: Array<{ label: string; value: string }>;
  followUps?: string[];
  onFollowUp: (q: string) => void;
}) {
  return (
    <div className="mb-5 hc-in" style={{ animation: "hcFadeUp 0.22s ease-out both" }}>
      {/* Tiny HALO identifier */}
      <div className="flex items-center gap-1.5 mb-[7px]">
        <div className="w-[5px] h-[5px] rounded-full" style={{ background: "rgba(180,255,68,0.45)" }} />
        <span
          className="text-[8.5px] font-bold tracking-[0.18em] uppercase"
          style={{ color: "rgba(255,255,255,0.22)" }}
        >
          HALO
        </span>
      </div>

      {/* Answer text — no bubble, no card */}
      <p
        className="text-[14px] leading-[1.7] whitespace-pre-wrap pl-[13px]"
        style={{ color: "rgba(255,255,255,0.82)" }}
      >
        {text}
      </p>

      {/* Sources */}
      {sources && sources.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 pl-[13px]">
          {sources.map((s, i) => (
            <span key={i} className="text-[10px]" style={{ color: "rgba(255,255,255,0.2)" }}>
              {s.label}: {s.value}
            </span>
          ))}
        </div>
      )}

      {/* Follow-up chips */}
      {followUps && followUps.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-3 pl-[13px]">
          {followUps.slice(0, 3).map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="text-[11.5px] font-medium px-3 py-[6px] rounded-full transition-all active:scale-95"
              style={{
                color: "rgba(255,255,255,0.35)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.62)";
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.35)";
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
              }}
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelOpenedChip({
  panel, label, onReopen,
}: {
  panel: PanelType; label: string; onReopen: () => void;
}) {
  const Icon = PANEL_ICON[panel];
  return (
    <div className="flex mb-4 hc-in" style={{ animation: "hcFadeUp 0.2s ease-out both" }}>
      <button
        onClick={onReopen}
        className="flex items-center gap-[7px] px-3 py-[7px] rounded-full transition-all active:scale-95"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
        onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)")}
        onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)")}
      >
        <Icon className="w-[11px] h-[11px]" strokeWidth={2} style={{ color: "rgba(255,255,255,0.32)" }} />
        <span className="text-[11.5px] font-medium" style={{ color: "rgba(255,255,255,0.38)" }}>
          {label}
        </span>
      </button>
    </div>
  );
}

// ─── Action plan card ─────────────────────────────────────────────────────────

function ActionPlanCard({
  msg, falkonMode, onExecute, onDecline,
}: {
  msg: { plan: ActionPlanData; status: string; result?: string };
  falkonMode: FalkonMode;
  onExecute: () => void;
  onDecline: () => void;
}) {
  const isShadow = falkonMode === "SHADOW";
  const isBlock = msg.plan.risk === "block";

  if (msg.status === "executing") return (
    <div
      className="flex items-center gap-3 rounded-[14px] px-4 py-3 mb-4 hc-in"
      style={{ background: "rgba(180,255,68,0.05)", border: "1px solid rgba(180,255,68,0.12)", animation: "hcFadeUp 0.2s ease-out both" }}
    >
      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "#B4FF44" }} />
      <div>
        <span className="text-[12.5px] font-medium" style={{ color: "rgba(180,255,68,0.82)" }}>Executing…</span>
        <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{msg.plan.description}</p>
      </div>
    </div>
  );

  if (msg.status === "done") return (
    <div
      className="flex items-center gap-3 rounded-[14px] px-4 py-3 mb-4 hc-in"
      style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.14)", animation: "hcFadeUp 0.2s ease-out both" }}
    >
      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "#22C55E" }} />
      <div>
        <span className="text-[12.5px] font-medium" style={{ color: "rgba(34,197,94,0.9)" }}>Done</span>
        <p className="text-[11px] mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>{msg.result ?? msg.plan.description}</p>
      </div>
    </div>
  );

  if (msg.status === "error") return (
    <div
      className="flex items-center gap-3 rounded-[14px] px-4 py-3 mb-4 hc-in"
      style={{ background: "rgba(225,29,72,0.07)", border: "1px solid rgba(225,29,72,0.15)", animation: "hcFadeUp 0.2s ease-out both" }}
    >
      <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#E11D48" }} />
      <span className="text-[12.5px]" style={{ color: "rgba(225,29,72,0.82)" }}>Action failed — try again or handle manually.</span>
    </div>
  );

  if (msg.status === "declined") return (
    <div className="mb-4">
      <span className="text-[11.5px]" style={{ color: "rgba(255,255,255,0.2)" }}>Cancelled — nothing changed.</span>
    </div>
  );

  // pending
  const riskColor = isBlock ? "#E11D48" : msg.plan.risk === "review" ? "#F59E0B" : "#B4FF44";
  const riskLabel = isBlock ? "BLOCKED" : msg.plan.risk === "review" ? "REVIEW" : isShadow ? "SHADOW" : "READY";

  return (
    <div
      className="rounded-[16px] px-4 py-4 mb-4 hc-in"
      style={{
        background: isBlock ? "rgba(225,29,72,0.05)" : isShadow ? "rgba(245,158,11,0.04)" : "rgba(12,20,35,0.95)",
        border: "1px solid rgba(255,255,255,0.07)",
        animation: "hcFadeUp 0.2s ease-out both",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[8.5px] font-bold tracking-[0.18em] uppercase px-2 py-[3px] rounded-md"
          style={{ background: `${riskColor}10`, border: `1px solid ${riskColor}22`, color: riskColor }}
        >
          {riskLabel}
        </span>
        {!isShadow && !isBlock && falkonMode === "ASSISTED" && (
          <span className="text-[9.5px]" style={{ color: "rgba(255,255,255,0.2)" }}>Falkon ASSISTED</span>
        )}
      </div>
      <p className="text-[13.5px] leading-relaxed mb-4" style={{ color: "rgba(255,255,255,0.75)" }}>
        {msg.plan.description}
      </p>
      {!isBlock && !isShadow && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExecute}
            className="flex-1 h-10 rounded-[11px] text-[13px] font-semibold transition-all active:scale-[0.97]"
            style={{ background: "#B4FF44", color: "#07101E" }}
          >
            {msg.plan.risk === "review" ? "Approve & Execute" : "Execute"}
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="h-10 px-5 rounded-[11px] text-[13px] transition-all active:scale-[0.97]"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.4)" }}
          >
            Cancel
          </button>
        </div>
      )}
      {(isShadow || isBlock) && (
        <p className="text-[11px] mt-1" style={{ color: "rgba(255,255,255,0.22)" }}>
          {isShadow ? "Switch to ASSISTED mode to execute." : "Contact your administrator."}
        </p>
      )}
    </div>
  );
}

// ─── Shared composer ──────────────────────────────────────────────────────────

function ComposerInput({
  value, onChange, onSubmit, onVoice, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVoice: () => void;
  busy: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const hasSend = value.trim().length > 0;

  return (
    <div
      className="relative flex items-center overflow-hidden transition-all duration-200"
      style={{
        background: focused ? "rgba(255,255,255,0.058)" : "rgba(255,255,255,0.042)",
        border: `1px solid ${focused ? "rgba(180,255,68,0.22)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 20,
        boxShadow: focused
          ? "0 0 0 3px rgba(180,255,68,0.06), 0 8px 40px rgba(0,0,0,0.45)"
          : "0 8px 40px rgba(0,0,0,0.3)",
      }}
    >
      {/* Voice */}
      <button
        onClick={onVoice}
        className="ml-3 w-9 h-9 rounded-full grid place-items-center shrink-0 transition-all active:scale-90"
        style={{ color: "rgba(255,255,255,0.22)" }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(180,255,68,0.7)";
          (e.currentTarget as HTMLButtonElement).style.background = "rgba(180,255,68,0.08)";
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.22)";
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        }}
      >
        <Mic className="w-[15px] h-[15px]" strokeWidth={2} />
      </button>

      {/* Input */}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Ask HALO anything…"
        className="flex-1 bg-transparent px-3 focus:outline-none"
        style={{
          height: 54,
          fontSize: 14,
          color: "rgba(255,255,255,0.9)",
          caretColor: "#B4FF44",
        }}
      />

      {/* Send */}
      <button
        onClick={onSubmit}
        disabled={!hasSend || busy}
        className="mr-3 w-9 h-9 rounded-full grid place-items-center shrink-0 transition-all active:scale-90 disabled:opacity-20 disabled:scale-100"
        style={{
          background: hasSend ? "#B4FF44" : "rgba(255,255,255,0.07)",
          color: hasSend ? "#07101E" : "rgba(255,255,255,0.28)",
          boxShadow: hasSend ? "0 2px 12px rgba(180,255,68,0.25)" : "none",
        }}
      >
        {busy ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Send className="w-[13px] h-[13px]" strokeWidth={2.2} />}
      </button>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HaloCommand() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  // ── Data ──────────────────────────────────────────────────────────────────
  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 15_000 } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 20_000 } });
  const { data: health } = useFalkonHealth();
  const parseVoice = useParseVoice();

  // ── Thread ────────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<TMsg[]>([]);
  const [input, setInput] = useState("");

  // ── Brain conversation ────────────────────────────────────────────────────
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("halo_convo_id"); } catch { return null; }
  });
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  const [brainReady, setBrainReady] = useState(false);

  // ── Panels ────────────────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<PanelType | null>(null);

  // ── Overlays ──────────────────────────────────────────────────────────────
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);

  // ── Scroll ────────────────────────────────────────────────────────────────
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollDown = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
  }, []);

  // ── Brain init + history restore ──────────────────────────────────────────
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
            try { sessionStorage.setItem("halo_convo_id", convoId!); } catch {}
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
              try { sessionStorage.removeItem("halo_convo_id"); } catch {}
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

  // ── Open a panel from chat ────────────────────────────────────────────────
  const openPanel = useCallback((panel: PanelType, label: string, fromMessage?: boolean) => {
    setActivePanel(panel);
    if (fromMessage) {
      setMessages(prev => [...prev, {
        id: `panel-${Date.now()}`, kind: "panel-opened" as const, panel, label,
      }]);
      scrollDown();
    }
  }, [scrollDown]);

  // ── Submit ────────────────────────────────────────────────────────────────
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

    // ── Panel intent first ────────────────────────────────────────────────
    const panelIntent = detectPanelIntent(raw);
    if (panelIntent) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "halo-answer" as const, text: `Opening ${panelIntent.label}.` }
          : m
      ));
      openPanel(panelIntent.panel, panelIntent.label, true);
      scrollDown();
      return;
    }

    // ── Brain path ────────────────────────────────────────────────────────
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
          try { sessionStorage.removeItem("halo_convo_id"); } catch {}
          setConversationId(null);
          try {
            const fresh = await apiFetch("/api/command/conversations", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "executive" }),
            });
            if (fresh?.conversation?.id) {
              convoId = fresh.conversation.id;
              setConversationId(convoId);
              try { sessionStorage.setItem("halo_convo_id", convoId!); } catch {}
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
          scrollDown();
          return;
        }
      }

      if (brainResult.type === "voice_action") {
        setMessages(prev => prev.map(m =>
          m.id === thinkId
            ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, followUps: brainResult.suggestedFollowUps }
            : m
        ));
        const plan = brainResult.actionPlan as ActionPlanData | undefined;
        const falkonMode = deriveFalkonMode(health);
        if (plan) {
          const planId = `plan-${Date.now()}`;
          if (plan.risk === "auto" && falkonMode === "ASSISTED") {
            setMessages(prev => [...prev, { id: planId, kind: "action-plan" as const, plan, status: "executing" as const }]);
            scrollDown();
            try {
              const r = await apiFetch("/api/command/actions/execute", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(plan),
              });
              const llData = parseLiveLinkResult(r.result);
              if (llData) {
                setMessages(prev => [
                  ...prev.map(m => m.id === planId ? { ...m as any, status: "done" as const } : m),
                  { id: `ll-${Date.now()}`, kind: "live-link-card" as const, data: llData },
                ]);
              } else {
                setMessages(prev => prev.map(m => m.id === planId ? { ...m as any, status: "done" as const, result: r.result } : m));
              }
            } catch {
              setMessages(prev => prev.map(m => m.id === planId ? { ...m as any, status: "error" as const } : m));
            }
          } else {
            setMessages(prev => [...prev, { id: planId, kind: "action-plan" as const, plan, status: "pending" as const }]);
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

    // ── Fallback ──────────────────────────────────────────────────────────
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
          m.id === thinkId
            ? { id: thinkId, kind: "halo-answer" as const, text: "Try asking about your jobs, crews, or finances — or say 'open live map'." }
            : m
        ));
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "error" as const, text: "Connection error — try again." } : m
      ));
    }
    scrollDown();
  }, [brainReady, input, conversationId, health, openPanel, parseVoice, scrollDown]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const falkonMode = deriveFalkonMode(health);
  const modeStyle = MODE_STYLE[falkonMode];
  const unread = today?.unreadNotifications ?? 0;
  const nowCount = (today?.feed ?? []).filter((c: any) => c.tier === "now").length;
  const pendingCount = (autopilot ?? []).filter((a: any) => a.status === "pending").length;
  const totalNeeds = nowCount + pendingCount;
  const hasThread = messages.some(m => m.kind === "user-msg");

  // ── Message renderer ──────────────────────────────────────────────────────
  const renderMsg = (msg: TMsg) => {
    switch (msg.kind) {
      case "user-msg":
        return <UserBubble text={msg.text} />;
      case "thinking":
        return <ThinkingBubble />;
      case "halo-answer":
        return (
          <HaloAnswerBubble
            text={msg.text} sources={msg.sources} followUps={msg.followUps}
            onFollowUp={handleSubmit}
          />
        );
      case "action-plan": {
        const planMsg = msg;
        return (
          <ActionPlanCard
            msg={planMsg}
            falkonMode={falkonMode}
            onExecute={async () => {
              setMessages(prev => prev.map(m => m.id === planMsg.id ? { ...m as any, status: "executing" as const } : m));
              try {
                const r = await apiFetch("/api/command/actions/execute", {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(planMsg.plan),
                });
                const llData = parseLiveLinkResult(r.result);
                if (llData) {
                  setMessages(prev => [
                    ...prev.map(m => m.id === planMsg.id ? { ...m as any, status: "done" as const } : m),
                    { id: `ll-${Date.now()}`, kind: "live-link-card" as const, data: llData },
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
      case "confirmation":
        return (
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
      case "panel-opened":
        return (
          <PanelOpenedChip panel={msg.panel} label={msg.label} onReopen={() => setActivePanel(msg.panel)} />
        );
      case "success":
        return (
          <div
            className="flex items-center gap-3 rounded-[13px] px-4 py-3 mb-4 hc-in"
            style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.12)", animation: "hcFadeUp 0.2s ease-out both" }}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" style={{ color: "#22C55E" }} />
            <span className="text-[13px]" style={{ color: "rgba(34,197,94,0.85)" }}>{msg.text}</span>
          </div>
        );
      case "live-link-card":
        return (
          <LiveLinkCard
            data={msg.data}
            onRevoke={async (token) => {
              const route = msg.data.kind === "pm_link" ? "/api/pm-links" : "/api/crew-checkin-links";
              await apiFetch(`${route}/${token}`, { method: "DELETE" }).catch(() => {});
              setMessages(prev => prev.filter(m => m.id !== msg.id));
            }}
          />
        );
      case "error":
        return (
          <div
            className="flex items-center gap-3 rounded-[13px] px-4 py-3 mb-4 hc-in"
            style={{ background: "rgba(225,29,72,0.06)", border: "1px solid rgba(225,29,72,0.12)", animation: "hcFadeUp 0.2s ease-out both" }}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" style={{ color: "#E11D48" }} />
            <span className="text-[13px]" style={{ color: "rgba(225,29,72,0.82)" }}>{msg.text}</span>
          </div>
        );
      default:
        return null;
    }
  };

  // ── Prompt chips (4 for the 2×2 seed grid) ───────────────────────────────
  const promptChips = suggestedPrompts?.slice(0, 4) ?? [
    "What needs my attention?",
    "Open live map",
    "Show unpaid invoices",
    "Generate a live link",
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* ── Shell ─────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col overflow-hidden"
        style={{ minHeight: "100dvh", height: "100dvh", background: "#080D17" }}
      >

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header
          className="flex items-center gap-2 px-5 shrink-0"
          style={{
            paddingTop: "calc(env(safe-area-inset-top) + 12px)",
            paddingBottom: 12,
          }}
        >
          {/* HALO logo — understated */}
          <img
            src={haloLogo}
            alt="HALO"
            className="shrink-0"
            style={{ height: 17, width: "auto", filter: "brightness(0) invert(1)", opacity: 0.5 }}
          />

          <div className="flex-1" />

          {/* Falkon mode — minimal pill */}
          <button
            onClick={() => setControlOpen(true)}
            className={`flex items-center gap-1.5 px-[9px] py-[5px] rounded-full transition-all active:scale-95 ${modeStyle.bg} ${modeStyle.text}`}
          >
            <div className={`w-[4.5px] h-[4.5px] rounded-full ${modeStyle.dot}`} />
            <span className="text-[8px] font-bold tracking-[0.14em]">{falkonMode}</span>
          </button>

          {/* Bell — unified unread/urgent badge */}
          <button
            onClick={() => setNotifOpen(true)}
            className="relative w-8 h-8 rounded-full grid place-items-center transition-all active:scale-95"
            style={{ color: "rgba(255,255,255,0.32)" }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.65)")}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.32)")}
          >
            <Bell className="w-[15px] h-[15px]" strokeWidth={1.8} />
            {totalNeeds > 0 && (
              <span
                className="absolute -top-[1px] -right-[1px] min-w-[14px] h-[14px] px-[3px] rounded-full text-white text-[8px] font-bold grid place-items-center"
                style={{ background: "#E11D48", animation: "hcPulseRed 2s ease-in-out infinite" }}
              >
                {totalNeeds}
              </span>
            )}
            {totalNeeds === 0 && unread > 0 && (
              <span
                className="absolute -top-[1px] -right-[1px] min-w-[14px] h-[14px] px-[3px] rounded-full text-[8px] font-bold grid place-items-center"
                style={{ background: "#B4FF44", color: "#07101E" }}
              >
                {unread}
              </span>
            )}
          </button>

          {/* Menu */}
          <button
            onClick={() => setMenuOpen(true)}
            className="w-8 h-8 rounded-full grid place-items-center transition-all active:scale-95"
            style={{ color: "rgba(255,255,255,0.32)" }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.65)")}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.32)")}
          >
            <MoreHorizontal className="w-[16px] h-[16px]" strokeWidth={1.8} />
          </button>
        </header>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {!hasThread ? (

          /* ── SEED STATE ─────────────────────────────────────────────────── */
          <div
            className="flex-1 flex flex-col items-center justify-center px-6 overflow-hidden"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >

            {/* Greeting */}
            <div
              className="text-center hc-in"
              style={{ animation: "hcFadeUp 0.45s ease-out 0.04s both", marginBottom: 36 }}
            >
              <h1
                className="font-semibold text-white leading-[1.04]"
                style={{ fontSize: "clamp(34px, 9vw, 44px)", letterSpacing: "-0.025em", fontFamily: "var(--font-display)" }}
              >
                {timeGreeting()}
              </h1>
              <p
                className="mt-2.5 font-medium"
                style={{ fontSize: 13, color: "rgba(255,255,255,0.28)", letterSpacing: "0.005em" }}
              >
                {falkonMode === "ASSISTED"
                  ? "Auto-pilot active — safe actions execute automatically."
                  : "Ask me anything about your operations."}
              </p>

              {/* Urgent indicator — single quiet line, never a card */}
              {totalNeeds > 0 && (
                <p className="mt-2.5" style={{ fontSize: 12, color: "rgba(255,255,255,0.38)" }}>
                  <span style={{ color: "rgba(225,29,72,0.82)" }}>
                    {totalNeeds} item{totalNeeds !== 1 ? "s" : ""}
                  </span>
                  {" "}need{totalNeeds === 1 ? "s" : ""} your attention
                </p>
              )}
            </div>

            {/* Composer — the primary action */}
            <div
              className="w-full hc-in"
              style={{ maxWidth: 380, animation: "hcFadeUp 0.45s ease-out 0.14s both" }}
            >
              <ComposerInput
                value={input}
                onChange={setInput}
                onSubmit={() => handleSubmit()}
                onVoice={() => setVoiceOpen(true)}
                busy={parseVoice.isPending}
              />
            </div>

            {/* 4 chips — 2×2 grid, understated */}
            <div
              className="w-full hc-in"
              style={{ maxWidth: 380, marginTop: 14, animation: "hcFadeUp 0.45s ease-out 0.24s both" }}
            >
              <div className="grid grid-cols-2 gap-[7px]">
                {promptChips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => handleSubmit(chip)}
                    className="text-left rounded-[13px] transition-all active:scale-[0.97]"
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.36)",
                      background: "rgba(255,255,255,0.034)",
                      border: "1px solid rgba(255,255,255,0.056)",
                      padding: "10px 13px",
                      lineHeight: 1.4,
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.6)";
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.058)";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.36)";
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.034)";
                    }}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>

        ) : (

          /* ── THREAD STATE ───────────────────────────────────────────────── */
          <>
            <div
              className="flex-1 overflow-y-auto overscroll-none"
              style={{ padding: "20px 20px 8px" }}
            >
              {messages.map(msg => (
                <div key={msg.id}>{renderMsg(msg)}</div>
              ))}
              <div ref={bottomRef} style={{ height: 8 }} />
            </div>

            {/* Thread composer — gradient fade, no hard border */}
            <div
              className="shrink-0"
              style={{
                padding: "10px 20px",
                paddingBottom: "max(16px, env(safe-area-inset-bottom))",
                background: "linear-gradient(to top, #080D17 70%, transparent)",
              }}
            >
              <ComposerInput
                value={input}
                onChange={setInput}
                onSubmit={() => handleSubmit()}
                onVoice={() => setVoiceOpen(true)}
                busy={parseVoice.isPending}
              />
            </div>
          </>
        )}
      </div>

      {/* ── Panels ──────────────────────────────────────────────────────────── */}
      <LiveMapPanel open={activePanel === "map"}    onClose={() => setActivePanel(null)} />
      <KanbanPanel  open={activePanel === "kanban"} onClose={() => setActivePanel(null)} />
      <MoneyPanel   open={activePanel === "money"}  onClose={() => setActivePanel(null)} />

      {/* ── Overlays ────────────────────────────────────────────────────────── */}
      <VoiceCaptureSheet open={voiceOpen}  onOpenChange={setVoiceOpen} />
      <NotificationsDrawer open={notifOpen} onOpenChange={setNotifOpen} />
      <MinimalMenuSheet open={menuOpen}    onOpenChange={setMenuOpen} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
  );
}
