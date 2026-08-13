/**
 * HALO Command — the entire operating interface.
 *
 * One dark shell. One composer. Three summonable panels (Map, Kanban, Money).
 * Everything else happens in conversation.
 *
 * SEED  — ring + greeting + at most 2 critical alerts + 3 prompt chips.
 * THREAD — scrollable chat: user bubbles, HALO answers, action cards.
 * PANELS — LiveMap / JobKanban / Money slide over the chat, close back to thread.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Mic, Bell, LayoutGrid, Send, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";

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
import { HaloRing } from "@/components/HaloRing";
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
      return {
        kind: "pm_link",
        propertyName: p.propertyName,
        url: p.url,
        token: p.token,
        smsText: p.smsText,
        expiresAt: p.expiresAt,
      };
    }
    if (p.type === "crew_link") {
      return {
        kind: "crew_checkin",
        crewName: p.crewName,
        url: p.url,
        token: p.token,
        smsText: p.smsText,
        expiresAt: p.expiresAt,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Keyframes ────────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes hcBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
@keyframes hcIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes hcGlow {
  0%,100%{opacity:0.55;filter:drop-shadow(0 0 22px rgba(180,255,68,0.38))}
  50%{opacity:0.85;filter:drop-shadow(0 0 44px rgba(180,255,68,0.68))}
}
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
  SHADOW:   { bg: "bg-white/5 border border-white/10",          text: "text-white/35",     dot: "bg-white/25" },
  ASSISTED: { bg: "bg-[#B4FF44]/8 border border-[#B4FF44]/20", text: "text-[#B4FF44]/80", dot: "bg-[#B4FF44] animate-pulse" },
  LIVE:     { bg: "bg-[#22C55E]/8 border border-[#22C55E]/18", text: "text-[#22C55E]/80", dot: "bg-[#22C55E] animate-pulse" },
};

// ─── Panel intent detection ───────────────────────────────────────────────────

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

const PANEL_ICONS: Record<PanelType, string> = { map: "📍", kanban: "📋", money: "💰" };

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

// ─── Bubble components ────────────────────────────────────────────────────────

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
      <div className="max-w-[80%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-2.5 shadow-[0_4px_16px_rgba(180,255,68,0.18)]">
        <p className="text-[13.5px] font-semibold leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-[20px] h-[20px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center shrink-0">
        <HaloRing className="w-[10px] h-[10px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/6 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-[5px] h-[5px] rounded-full bg-[#B4FF44]/45"
            style={{ animation: `hcBounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
        ))}
      </div>
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
    <div className="mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
      <div className="flex items-end gap-2">
        <div className="w-[20px] h-[20px] rounded-full bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center shrink-0">
          <HaloRing className="w-[10px] h-[10px] text-[#B4FF44]" />
        </div>
        <div className="max-w-[85%] bg-[#0C1B30] border border-white/6 rounded-[16px] rounded-bl-[4px] px-4 py-3 shadow-sm">
          <p className="text-[13.5px] text-white/80 leading-relaxed whitespace-pre-wrap">{text}</p>
          {sources && sources.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 pt-2 border-t border-white/[0.05]">
              {sources.map((s, i) => (
                <span key={i} className="text-[10px] text-white/28">
                  <span className="text-white/18">{s.label}:</span> {s.value}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {followUps && followUps.length > 0 && (
        <div className="flex gap-1.5 flex-wrap mt-1.5 ml-[28px]">
          {followUps.slice(0, 3).map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="text-[11px] font-medium text-white/38 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/6 hover:text-white/65 hover:bg-white/[0.07] transition-all active:scale-[0.96]"
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
  return (
    <div className="flex mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
      <button
        onClick={onReopen}
        className="flex items-center gap-2 px-3 py-2 rounded-full bg-white/[0.05] border border-white/[0.08] hover:bg-white/[0.08] transition-all active:scale-[0.97]"
      >
        <span className="text-[12px]">{PANEL_ICONS[panel]}</span>
        <span className="text-[11.5px] text-white/45 font-medium">{label} — tap to reopen</span>
      </button>
    </div>
  );
}

// ─── ActionPlanCard ───────────────────────────────────────────────────────────

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
    <div className="flex items-center gap-2.5 bg-[#B4FF44]/6 border border-[#B4FF44]/15 rounded-[13px] px-4 py-3 mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
      <Loader2 className="w-3.5 h-3.5 text-[#B4FF44] animate-spin shrink-0" />
      <div>
        <span className="text-[12.5px] text-[#B4FF44]/80 font-medium">Executing…</span>
        <p className="text-[11px] text-white/32 mt-0.5">{msg.plan.description}</p>
      </div>
    </div>
  );

  if (msg.status === "done") return (
    <div className="flex items-center gap-2.5 bg-[#22C55E]/7 border border-[#22C55E]/18 rounded-[13px] px-4 py-3 mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
      <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
      <div>
        <span className="text-[12.5px] text-[#22C55E]/90 font-medium">Done</span>
        <p className="text-[11px] text-white/38 mt-0.5">{msg.result ?? msg.plan.description}</p>
      </div>
    </div>
  );

  if (msg.status === "error") return (
    <div className="flex items-center gap-2.5 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[13px] px-4 py-3 mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
      <AlertCircle className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
      <span className="text-[12.5px] text-[#E11D48]/82">Action failed — try again or handle manually.</span>
    </div>
  );

  if (msg.status === "declined") return (
    <div className="mb-3"><span className="text-[11.5px] text-white/22">Cancelled — nothing changed.</span></div>
  );

  // pending
  const riskColor = isBlock ? "#E11D48" : msg.plan.risk === "review" ? "#F59E0B" : "#B4FF44";
  const riskLabel = isBlock ? "BLOCKED" : msg.plan.risk === "review" ? "REVIEW" : isShadow ? "SHADOW" : "READY";

  return (
    <div className="rounded-[14px] border border-white/8 px-4 py-3.5 mb-3 hc-in"
      style={{ background: isBlock ? "rgba(225,29,72,0.06)" : isShadow ? "rgba(245,158,11,0.05)" : "rgba(10,22,40,0.9)", animation: "hcIn 0.2s ease-out both" }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] font-bold tracking-[0.16em] uppercase px-2 py-0.5 rounded border"
          style={{ background: `${riskColor}12`, borderColor: `${riskColor}28`, color: riskColor }}>
          {riskLabel}
        </span>
        {!isShadow && !isBlock && falkonMode === "ASSISTED" && (
          <span className="text-[10px] text-white/22">Falkon ASSISTED</span>
        )}
      </div>
      <p className="text-[13px] text-white/75 leading-relaxed mb-3">{msg.plan.description}</p>
      {!isBlock && !isShadow && (
        <div className="flex gap-2">
          <button type="button" onClick={onExecute}
            className="flex-1 h-9 rounded-[10px] bg-[#B4FF44] text-[#07101E] text-[12px] font-bold hover:bg-[#c8ff6e] active:scale-[0.97] transition-all">
            {msg.plan.risk === "review" ? "Approve & Execute" : "Execute"}
          </button>
          <button type="button" onClick={onDecline}
            className="h-9 px-4 rounded-[10px] bg-white/5 border border-white/8 text-[12px] text-white/42 hover:text-white/65 hover:bg-white/8 active:scale-[0.97] transition-all">
            Cancel
          </button>
        </div>
      )}
      {(isShadow || isBlock) && (
        <p className="text-[11px] text-white/25 mt-1">
          {isShadow ? "Switch to ASSISTED mode to execute." : "Contact your administrator."}
        </p>
      )}
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

    // ── Check for panel intent first ─────────────────────────────────────
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
      // Brain says to open a panel via lensKind
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

      // voice_action with action plan
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
          // Fallback to legacy voice parse
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

      // Standard answer or error
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, sources: brainResult.sources, followUps: brainResult.suggestedFollowUps }
          : m
      ));
      scrollDown();
      return;
    }

    // ── Fallback (no brain) ───────────────────────────────────────────────
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
            ? { id: thinkId, kind: "halo-answer" as const, text: "Try a command like \"send invoice for [property]\" or ask a question about your operations." }
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
      case "user-msg": return <UserBubble text={msg.text} />;
      case "thinking": return <ThinkingBubble />;
      case "halo-answer": return (
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
      case "panel-opened": return (
        <PanelOpenedChip panel={msg.panel} label={msg.label} onReopen={() => setActivePanel(msg.panel)} />
      );
      case "success": return (
        <div className="flex items-center gap-2.5 bg-[#22C55E]/7 border border-[#22C55E]/15 rounded-[12px] px-4 py-2.5 mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
          <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E] shrink-0" />
          <span className="text-[13px] text-[#22C55E]/82">{msg.text}</span>
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
      case "error": return (
        <div className="flex items-center gap-2.5 bg-[#E11D48]/7 border border-[#E11D48]/15 rounded-[12px] px-4 py-2.5 mb-3 hc-in" style={{ animation: "hcIn 0.2s ease-out both" }}>
          <AlertCircle className="w-3.5 h-3.5 text-[#E11D48] shrink-0" />
          <span className="text-[13px] text-[#E11D48]/82">{msg.text}</span>
        </div>
      );
      default: return null;
    }
  };

  // Prompt chips (seed + thread)
  const promptChips = suggestedPrompts?.slice(0, 3) ?? [
    "What needs my attention?",
    "Open live map",
    "Show unpaid invoices",
  ];

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div className="min-h-[100dvh] h-[100dvh] bg-[#080D17] flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-2 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-3 shrink-0">
          <img src={haloLogo} alt="HALO" className="h-[20px] w-auto shrink-0"
            style={{ filter: "brightness(0) invert(1) opacity(0.82)" }} />
          <div className="flex-1" />

          {/* Needs-you indicator */}
          {totalNeeds > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E11D48]/10 border border-[#E11D48]/18">
              <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48]" style={{ animation: "hcBounce 2s ease-in-out infinite" }} />
              <span className="text-[10px] font-bold text-[#E11D48]/80">{totalNeeds}</span>
            </div>
          )}

          {/* Falkon mode badge */}
          <button
            onClick={() => setControlOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[9px] font-bold tracking-[0.12em] ${modeStyle.bg} ${modeStyle.text} hover:opacity-80 active:scale-[0.95] transition-all`}
          >
            <div className={`w-1.5 h-1.5 rounded-full ${modeStyle.dot}`} />
            {falkonMode}
          </button>

          {/* Bell */}
          <button
            onClick={() => setNotifOpen(true)}
            className="relative w-9 h-9 rounded-full grid place-items-center bg-white/[0.05] border border-white/8 text-white/38 hover:text-white/65 hover:bg-white/[0.08] transition-all active:scale-[0.94]"
          >
            <Bell className="w-[14px] h-[14px]" strokeWidth={1.8} />
            {unread > 0 && (
              <span className="absolute -top-[2px] -right-[2px] min-w-[14px] h-[14px] px-[3px] rounded-full bg-[#B4FF44] text-black text-[8px] font-bold grid place-items-center">
                {unread}
              </span>
            )}
          </button>

          {/* Menu */}
          <button
            onClick={() => setMenuOpen(true)}
            className="w-9 h-9 rounded-full grid place-items-center bg-white/[0.05] border border-white/8 text-white/38 hover:text-white/65 hover:bg-white/[0.08] transition-all active:scale-[0.94]"
          >
            <LayoutGrid className="w-[14px] h-[14px]" strokeWidth={1.8} />
          </button>
        </header>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {!hasThread ? (
          /* SEED STATE */
          <div className="flex-1 flex flex-col items-center justify-center px-5 pb-4 overflow-hidden">
            {/* Ring */}
            <div className="mb-7" style={{ animation: "hcIn 0.4s ease-out 0.05s both" }}>
              <div className="w-[68px] h-[68px] rounded-full bg-[#B4FF44]/7 border border-[#B4FF44]/18 grid place-items-center"
                style={{ animation: "hcGlow 3.5s ease-in-out infinite" }}>
                <HaloRing className="w-[30px] h-[30px] text-[#B4FF44]" />
              </div>
            </div>

            {/* Greeting */}
            <div className="text-center mb-1" style={{ animation: "hcIn 0.4s ease-out 0.12s both" }}>
              <h1 className="text-[34px] font-bold text-white leading-none tracking-[-0.02em]">
                {timeGreeting()}
              </h1>
              <p className="text-[13.5px] text-white/32 mt-2 font-medium">
                {falkonMode === "ASSISTED"
                  ? "Auto-pilot active — safe actions execute automatically."
                  : "Ask me anything about your operations."}
              </p>
            </div>

            {/* Critical alerts — at most 2 lines, no cards */}
            {(nowCount > 0 || pendingCount > 0) && (
              <div className="mt-4 text-center space-y-1" style={{ animation: "hcIn 0.4s ease-out 0.18s both" }}>
                {nowCount > 0 && (
                  <p className="text-[12.5px]">
                    <span className="text-[#E11D48]/90 font-semibold">{nowCount} item{nowCount !== 1 ? "s" : ""}</span>
                    <span className="text-white/35"> need immediate attention</span>
                  </p>
                )}
                {pendingCount > 0 && (
                  <p className="text-[12.5px]">
                    <span className="text-[#F59E0B]/90 font-semibold">{pendingCount} autopilot action{pendingCount !== 1 ? "s" : ""}</span>
                    <span className="text-white/35"> waiting for review</span>
                  </p>
                )}
              </div>
            )}

            {/* Composer */}
            <div className="w-full max-w-sm mt-7 mb-5" style={{ animation: "hcIn 0.4s ease-out 0.22s both" }}>
              <ComposerInput
                value={input}
                onChange={setInput}
                onSubmit={() => handleSubmit()}
                onVoice={() => setVoiceOpen(true)}
                busy={parseVoice.isPending}
              />
            </div>

            {/* Prompt chips */}
            <div className="w-full max-w-sm" style={{ animation: "hcIn 0.4s ease-out 0.30s both" }}>
              <div className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/18 mb-2.5 text-center">Suggestions</div>
              <div className="flex flex-col gap-1.5">
                {promptChips.map((chip, i) => (
                  <button
                    key={i}
                    onClick={() => handleSubmit(chip)}
                    className="text-left text-[12.5px] text-white/40 px-4 py-2.5 rounded-[12px] bg-white/[0.034] border border-white/[0.06] hover:bg-white/[0.058] hover:text-white/60 transition-all active:scale-[0.98]"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* THREAD STATE */
          <>
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 overscroll-none">
              {messages.map(msg => (
                <div key={msg.id}>{renderMsg(msg)}</div>
              ))}
              <div ref={bottomRef} className="h-3" />
            </div>

            {/* Thread composer */}
            <div className="px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] border-t border-white/[0.04] shrink-0">
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
      <LiveMapPanel open={activePanel === "map"} onClose={() => setActivePanel(null)} />
      <KanbanPanel  open={activePanel === "kanban"} onClose={() => setActivePanel(null)} />
      <MoneyPanel   open={activePanel === "money"} onClose={() => setActivePanel(null)} />

      {/* ── Overlays ────────────────────────────────────────────────────────── */}
      <VoiceCaptureSheet open={voiceOpen} onOpenChange={setVoiceOpen} />
      <NotificationsDrawer open={notifOpen} onOpenChange={setNotifOpen} />
      <MinimalMenuSheet open={menuOpen} onOpenChange={setMenuOpen} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
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
  return (
    <div className="relative flex items-center bg-white/[0.052] border border-white/10 rounded-[18px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.35)] hover:border-white/14 transition-colors focus-within:border-[#B4FF44]/28 focus-within:bg-white/[0.065]">
      <button
        onClick={onVoice}
        className="ml-3 w-8 h-8 rounded-full grid place-items-center text-white/25 hover:text-[#B4FF44]/65 hover:bg-[#B4FF44]/8 transition-all active:scale-[0.92] shrink-0"
      >
        <Mic className="w-[15px] h-[15px]" strokeWidth={2} />
      </button>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        placeholder="Ask HALO anything…"
        className="flex-1 h-[52px] bg-transparent px-3 text-[14px] text-white placeholder:text-white/20 focus:outline-none"
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim() || busy}
        className="mr-3 w-9 h-9 rounded-full grid place-items-center bg-white text-[#0A0F1A] shadow-[0_2px_12px_rgba(255,255,255,0.12)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-30 disabled:scale-100 shrink-0"
      >
        {busy ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <Send className="w-[13px] h-[13px]" strokeWidth={2.2} />}
      </button>
    </div>
  );
}
