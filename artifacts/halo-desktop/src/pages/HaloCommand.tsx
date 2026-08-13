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
import {
  Mic, Send, Loader2, CheckCircle2, AlertCircle,
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

type TMsg =
  | { id: string; kind: "user-msg"; text: string }
  | { id: string; kind: "thinking" }
  | { id: string; kind: "halo-answer"; text: string; sources?: Array<{ label: string; value: string }>; followUps?: string[] }
  | { id: string; kind: "action-plan"; plan: ActionPlanData; status: "pending" | "executing" | "done" | "error" | "declined"; result?: string }
  | { id: string; kind: "confirmation"; logId: string; actions: VoiceAction[] }
  | { id: string; kind: "panel-opened"; panel: PanelType; label: string }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string };

// ─── CSS ──────────────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes dcBounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
@keyframes dcIn { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
@keyframes dcGlow {
  0%,100%{opacity:0.5;filter:drop-shadow(0 0 24px rgba(180,255,68,0.35))}
  50%{opacity:0.85;filter:drop-shadow(0 0 48px rgba(180,255,68,0.65))}
}
`;

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

async function apiFetch(path: string, opts?: RequestInit): Promise<any> {
  const res = await fetch(path, { ...opts, credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
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
            <button key={i} onClick={() => onFollowUp(q)}
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
      <button onClick={onReopen}
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HaloCommand() {
  const qc = useQueryClient();

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
              setMessages(prev => prev.map(m => m.id === planId ? { ...m as any, status: "done" as const, result: r.result } : m));
            } catch {
              setMessages(prev => prev.map(m => m.id === planId ? { ...m as any, status: "error" as const } : m));
            }
          } else {
            setMessages(prev => [...prev, { id: planId, kind: "action-plan" as const, plan, status: "pending" as const }]);
          }
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
  }, [brainReady, input, conversationId, health, openPanel, parseVoice, scrollDown]);

  const falkonMode = deriveFalkonMode(health);
  const nowCount = (today?.feed ?? []).filter((c: any) => c.tier === "now").length;
  const pendingCount = (autopilot ?? []).filter((a: any) => a.status === "pending").length;
  const hasThread = messages.some(m => m.kind === "user-msg");

  const promptChips = suggestedPrompts?.slice(0, 3) ?? [
    "What needs my attention?",
    "Open live map",
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
                setMessages(prev => prev.map(m => m.id === planMsg.id ? { ...m as any, status: "done" as const, result: r.result } : m));
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
      <div className="h-full flex flex-col bg-[#080D17]">

        {!hasThread ? (
          /* SEED STATE */
          <div className="flex-1 flex flex-col items-center justify-center px-8 pb-8">
            {/* Ring */}
            <div className="mb-8" style={{ animation: "dcIn 0.4s ease-out 0.05s both" }}>
              <div className="w-[80px] h-[80px] rounded-full bg-[#B4FF44]/7 border border-[#B4FF44]/18 grid place-items-center"
                style={{ animation: "dcGlow 3.5s ease-in-out infinite" }}>
                <HaloRing className="w-[36px] h-[36px] text-[#B4FF44]" />
              </div>
            </div>

            {/* Greeting */}
            <div className="text-center mb-2" style={{ animation: "dcIn 0.4s ease-out 0.12s both" }}>
              <h1 className="text-[40px] font-bold text-white leading-none tracking-[-0.025em]">
                {timeGreeting()}
              </h1>
              <p className="text-[15px] text-white/32 mt-3 font-medium">
                {falkonMode === "ASSISTED"
                  ? "Auto-pilot active — safe actions execute automatically."
                  : "Ask me anything about your operations."}
              </p>
            </div>

            {/* Critical alerts */}
            {(nowCount > 0 || pendingCount > 0) && (
              <div className="mt-5 text-center space-y-1.5" style={{ animation: "dcIn 0.4s ease-out 0.18s both" }}>
                {nowCount > 0 && (
                  <p className="text-[14px]">
                    <span className="text-[#E11D48]/90 font-semibold">{nowCount} item{nowCount !== 1 ? "s" : ""}</span>
                    <span className="text-white/35"> need immediate attention</span>
                  </p>
                )}
                {pendingCount > 0 && (
                  <p className="text-[14px]">
                    <span className="text-[#F59E0B]/90 font-semibold">{pendingCount} autopilot action{pendingCount !== 1 ? "s" : ""}</span>
                    <span className="text-white/35"> waiting for review</span>
                  </p>
                )}
              </div>
            )}

            {/* Composer */}
            <div className="w-full max-w-2xl mt-8 mb-6" style={{ animation: "dcIn 0.4s ease-out 0.22s both" }}>
              <ComposerInput value={input} onChange={setInput} onSubmit={() => handleSubmit()} onVoice={() => setVoiceOpen(true)} busy={parseVoice.isPending} />
            </div>

            {/* Prompt chips */}
            <div className="w-full max-w-2xl" style={{ animation: "dcIn 0.4s ease-out 0.3s both" }}>
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-white/18 mb-3 text-center">Suggestions</div>
              <div className="flex gap-2 justify-center flex-wrap">
                {promptChips.map((chip, i) => (
                  <button key={i} onClick={() => handleSubmit(chip)}
                    className="text-[13px] text-white/40 px-5 py-2.5 rounded-[12px] bg-white/[0.034] border border-white/[0.06] hover:bg-white/[0.06] hover:text-white/60 transition-all active:scale-[0.98]">
                    {chip}
                  </button>
                ))}
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
      <VoiceCaptureDialog open={voiceOpen} onOpenChange={setVoiceOpen} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
  );
}

// ─── Shared composer ──────────────────────────────────────────────────────────

function ComposerInput({ value, onChange, onSubmit, onVoice, busy }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVoice: () => void;
  busy: boolean;
}) {
  return (
    <div className="relative flex items-center bg-white/[0.052] border border-white/10 rounded-[18px] overflow-hidden shadow-[0_8px_40px_rgba(0,0,0,0.4)] hover:border-white/15 transition-colors focus-within:border-[#B4FF44]/28 focus-within:bg-white/[0.065]">
      <button onClick={onVoice}
        className="ml-3.5 w-9 h-9 rounded-full grid place-items-center text-white/25 hover:text-[#B4FF44]/65 hover:bg-[#B4FF44]/8 transition-all active:scale-[0.92] shrink-0">
        <Mic className="w-[16px] h-[16px]" strokeWidth={2} />
      </button>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        placeholder="Ask HALO anything…"
        className="flex-1 h-[56px] bg-transparent px-3 text-[15px] text-white placeholder:text-white/20 focus:outline-none"
      />
      <button onClick={onSubmit} disabled={!value.trim() || busy}
        className="mr-3.5 w-10 h-10 rounded-full grid place-items-center bg-white text-[#0A0F1A] shadow-[0_2px_14px_rgba(255,255,255,0.12)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-30 disabled:scale-100 shrink-0">
        {busy ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Send className="w-[14px] h-[14px]" strokeWidth={2.2} />}
      </button>
    </div>
  );
}
