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
  List, CalendarDays, Mic, LayoutGrid, MapPin, BrainCircuit, MessageSquare, Headphones, Building2,
  PanelsTopLeft,
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
import { EarpieceMode } from "@/components/EarpieceMode";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { FalkonControlCenter } from "@/components/command/FalkonControlCenter";
import { isFalkonFormationIntent, useFalkonHealth } from "@/lib/falkonNetwork";
import { LiveMapPanel } from "@/components/panels/LiveMapPanel";
import { KanbanPanel } from "@/components/panels/KanbanPanel";
import { MoneyPanel } from "@/components/panels/MoneyPanel";
import { HaloIntelligenceView } from "@/components/HaloIntelligenceView";
import { BriefingCard, NowStrip, useBriefingItems, BriefingCardLoading } from "@/components/command/BriefingCard";
import { ReminderCard, type ReminderData } from "@/components/command/ReminderCard";
import { DispatchCard, type DispatchData } from "@/components/command/DispatchCard";
import { LiveMapCard } from "@/components/command/LiveMapCard";
import { LensCard, type LensType } from "@/components/command/LensCard";
import { AnswerBody, type StructuredAnswer } from "@/components/command/AnswerBody";
import { ProposalCard, type CommandProposal } from "@/components/command/ProposalCard";
import { ClientBoardPicker } from "@/components/ClientBoardPicker";

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
  | { id: string; kind: "halo-answer"; text: string; answer?: StructuredAnswer | null; proposals?: CommandProposal[]; sources?: Array<{ label: string; value: string }>; followUps?: string[] }
  | { id: string; kind: "action-plan"; plan: ActionPlanData; status: "pending" | "executing" | "done" | "error" | "declined"; result?: string }
  | { id: string; kind: "confirmation"; logId: string; actions: VoiceAction[] }
  | { id: string; kind: "panel-opened"; panel: PanelType; label: string }
  | { id: string; kind: "exchange-product-card"; products: ExchangeProductSummary[]; activationState: string }
  | { id: string; kind: "exchange-status-card"; statusData: ExchangeStatusData }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "briefing-card"; mode?: "default" | "team-vs-personal" }
  | { id: string; kind: "live-map-card"; query?: string }
  | { id: string; kind: "dispatch-card"; data: DispatchData }
  | { id: string; kind: "reminder-card"; reminder: ReminderData }
  | { id: string; kind: "lens-card"; lensType: LensType; query?: string };

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
@media(prefers-reduced-motion:reduce){
  .dc-in{animation:none!important}
  @keyframes haloAura{0%,100%{filter:none}}
}
`;

// ─── BriefingCardThread — self-contained wrapper used inside renderMsg ────────

function BriefingCardThread({ mode, onAction }: {
  mode?: "default" | "team-vs-personal";
  onAction: (cmd: string) => void;
}) {
  const { items, loading } = useBriefingItems();
  if (loading) return <BriefingCardLoading />;
  return <BriefingCard items={items} mode={mode ?? "default"} onAction={onAction} />;
}

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

// ─── Planning intent detection ────────────────────────────────────────────────

const PLANNING_PATTERNS = [
  /structure\s+my\s+day/i, /run\s+my\s+morning/i, /morning\s+brief/i,
  /what\s+needs\s+me/i, /what\s+needs\s+attention/i, /what\s+is\s+on\s+fire/i,
  /what\s+are\s+the\s+five\s+things/i, /what\s+could\s+hurt\s+us/i,
  /daily\s+brief/i, /my\s+brief/i, /give\s+me\s+a\s+brief/i,
  /show\s+me\s+a\s+brief/i,
];
const PERSONAL_VS_TEAM_PATTERNS = [
  /personally\s+vs\s+team/i, /personally\s+versus\s+team/i,
  /needs\s+me\s+personally/i, /what\s+needs\s+me\s+vs/i,
  /team\s+can\s+handle/i, /what\s+can\s+the\s+team/i,
];
const MAP_LENS_PATTERNS = [
  /live\s+crew\s+map/i, /show\s+me\s+the\s+map/i, /crew\s+locations?/i,
  /where\s+is\s+(everyone|the\s+crew)/i,
];

function detectPlanningIntent(text: string): "default" | "team-vs-personal" | null {
  if (PERSONAL_VS_TEAM_PATTERNS.some(p => p.test(text))) return "team-vs-personal";
  if (PLANNING_PATTERNS.some(p => p.test(text))) return "default";
  return null;
}

function detectMapLensIntent(text: string): boolean {
  return MAP_LENS_PATTERNS.some(p => p.test(text));
}

const DISPATCH_PATTERNS = [
  /\bdispatch\s+/i, /\bassign\s+\w+\s+to\s+job/i, /\bsend\s+\w+\s+to\s+(job|unit|site)/i,
  /\breplace\s+the\s+crew\s+on/i, /\bswap\s+crew/i,
];
/**
 * Normalize a voice-parser `remindAt` value (ISO string or natural language)
 * to a valid ISO datetime string, or null if unrecognised.
 * Examples: "tomorrow 9am" → ISO, "next Tuesday at 3pm" → ISO, "in 2 hours" → ISO.
 */
function parseNaturalRemindAt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const direct = new Date(raw);
  if (!isNaN(direct.getTime()) && /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(raw)) {
    return direct.toISOString();
  }
  const s = raw.toLowerCase().trim();
  const now = new Date();

  const relH = s.match(/in\s+(\d+)\s+hour/);
  if (relH) { const d = new Date(now); d.setHours(d.getHours() + parseInt(relH[1])); return d.toISOString(); }
  const relM = s.match(/in\s+(\d+)\s+min/);
  if (relM) { const d = new Date(now); d.setMinutes(d.getMinutes() + parseInt(relM[1])); return d.toISOString(); }

  let h = 9; let m = 0;
  const tm = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (tm) {
    h = parseInt(tm[1]); m = tm[2] ? parseInt(tm[2]) : 0;
    if (tm[3] === "pm" && h < 12) h += 12;
    if (tm[3] === "am" && h === 12) h = 0;
  } else {
    const bare = s.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
    if (bare) { h = parseInt(bare[1]); m = bare[2] ? parseInt(bare[2]) : 0; }
  }

  const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
  let base = new Date(now);

  if (/tomorrow/.test(s)) {
    base.setDate(base.getDate() + 1);
  } else if (/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(s)) {
    const nm = s.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (nm) { const t = DAYS.indexOf(nm[1]); let d = t - base.getDay(); if (d <= 0) d += 7; base.setDate(base.getDate() + d); }
  } else if (/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/.test(s)) {
    const dm = s.match(/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/);
    if (dm) { const t = DAYS.indexOf(dm[1]); let d = t - base.getDay(); if (d <= 0) d += 7; base.setDate(base.getDate() + d); }
  } else {
    return null;
  }

  base.setHours(h, m, 0, 0);
  return base.toISOString();
}

const REMINDER_PATTERNS = [
  /\bremind\s+me\b/i, /\bset\s+a?\s*reminder\b/i, /\breminder\s+for\b/i,
  /\bdon.t\s+forget\s+to\b/i,
];

function detectDispatchIntent(text: string): boolean {
  return DISPATCH_PATTERNS.some(p => p.test(text));
}
function detectReminderIntent(text: string): boolean {
  return REMINDER_PATTERNS.some(p => p.test(text));
}

// ─── Thread localStorage persistence ─────────────────────────────────────────

const DESKTOP_THREAD_KEY = "halo_desktop_thread_v1";
const THREAD_CAP = 50;

const SERIALISABLE_KINDS = new Set([
  "user-msg", "halo-answer", "success", "error",
  "briefing-card", "live-map-card", "dispatch-card", "reminder-card", "lens-card",
]);

function loadThread(): TMsg[] {
  try {
    const raw = localStorage.getItem(DESKTOP_THREAD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TMsg[];
    return parsed.filter(m => SERIALISABLE_KINDS.has(m.kind)).slice(-THREAD_CAP);
  } catch { return []; }
}

function saveThread(msgs: TMsg[]) {
  try {
    const serialisable = msgs.filter(m => SERIALISABLE_KINDS.has(m.kind)).slice(-THREAD_CAP);
    localStorage.setItem(DESKTOP_THREAD_KEY, JSON.stringify(serialisable));
  } catch {}
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSaveThread(msgs: TMsg[]) {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => saveThread(msgs), 500);
}

function detectPortfolioIntent(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    /\bportfolio\s*pulse\b/.test(lower) ||
    /\bopen\s+(the\s+)?portfolio\b/.test(lower) ||
    /\bshow\s+(the\s+)?portfolio\b/.test(lower) ||
    /\bclient\s+board\s+pulse\b/.test(lower)
  );
}

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

function HaloAnswerBubble({ text, answer, proposals, sources, followUps, onFollowUp }: {
  text: string;
  answer?: StructuredAnswer | null;
  proposals?: CommandProposal[];
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
          <AnswerBody answer={answer} text={text} />
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
      {/* Approve/dismiss is resolved server-side; the card renders its own
          resolved state so it can never be acted on twice. */}
      {(proposals ?? []).map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
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
            className="flex-1 h-9 rounded-[10px] bg-white text-[#07101E] text-[12.5px] font-bold hover:bg-white/92 active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-white/60 outline-none">
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
  { Icon: List,         color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Structure my day", title: "Daily Brief", desc: "Now / Today / This Week priorities." },
  { Icon: LayoutGrid,   color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "What needs me personally vs team?", title: "My vs Team", desc: "Decisions only you can make." },
  { Icon: CalendarDays, color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Open Property Pulse", title: "Property Pulse", desc: "Live sites, GPS, and crew pings." },
  { Icon: Building2,    color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Open Portfolio Pulse", title: "Portfolio Pulse", desc: "Vacancy dollars, turn days, attention." },
  { Icon: Headphones,   color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "", title: "Earpiece", desc: "AirPods. Say go, next, skip.", action: "earpiece" as const },
];

function SeedCard({ card, onSubmit, onEarpiece }: { card: typeof SEED_CARDS[number]; onSubmit: (s: string) => void; onEarpiece: () => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={() => card.action === "earpiece" ? onEarpiece() : onSubmit(card.prompt)}
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

function ComposerInput({ value, onChange, onSubmit, onVoice, onEarpiece, busy }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVoice?: () => void;
  onEarpiece?: () => void;
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
      <button type="button" onClick={onEarpiece} aria-label="Earpiece mode" style={{ width: 36, height: 36, borderRadius: "50%", color: "rgba(180,255,68,0.85)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Headphones size={16} strokeWidth={2} />
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

export default function HaloCommand({ compact = false }: { compact?: boolean } = {}) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();

  const { data: today } = useGetToday({ query: { queryKey: getGetTodayQueryKey(), refetchInterval: 15_000 } });
  const { data: autopilot } = useListAutopilotActions({ query: { queryKey: getListAutopilotActionsQueryKey(), refetchInterval: 20_000 } });
  const { data: health } = useFalkonHealth();
  const parseVoice = useParseVoice();

  const [messages, setMessages] = useState<TMsg[]>(() => loadThread());
  const [input, setInput] = useState("");

  // Persist thread to localStorage whenever it changes
  useEffect(() => { debouncedSaveThread(messages); }, [messages]);
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("halo_desktop_convo_id"); } catch { return null; }
  });
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  const [brainReady, setBrainReady] = useState(false);
  const [activePanel, setActivePanel] = useState<PanelType | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [earpieceOpen, setEarpieceOpen] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const [clientBoardOpen, setClientBoardOpen] = useState(false);

  // ── View mode — persisted so the user's preference survives navigation ───
  const [isIntelView, setIsIntelView] = useState<boolean>(() => {
    try { return localStorage.getItem("halo_desktop_view") === "intel"; } catch { return false; }
  });
  const toggleView = useCallback(() => {
    setIsIntelView(v => {
      const next = !v;
      try { localStorage.setItem("halo_desktop_view", next ? "intel" : "chat"); } catch {}
      return next;
    });
  }, []);

  const bottomRef = useRef<HTMLDivElement>(null);
  /** Conversational rendering of the last answer, for voice read-back. */
  const lastSpeechRef = useRef<string | null>(null);
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
              // meta.answer is the structured form; without it (older rows)
              // AnswerBody normalizes the plain text so no markdown shows.
              if (m.role === "assistant" && m.content) return [{ id: `r-${m.id}`, kind: "halo-answer" as const, text: m.content, answer: m.meta?.answer ?? null }];
              return [];
            });
            // Merge server history with persisted local thread.
            // IDs cannot be used for dedup (local: generated; server: r-${serverId}).
            // Fingerprint by kind+text so locally captured brain messages aren't duplicated,
            // while truly server-only entries (e.g. from another device) are prepended.
            setMessages(prev => {
              if (prev.length === 0) return restored;
              const localSigs = new Set(
                prev.map(m => `${m.kind}::${"text" in m ? (m as {text: string}).text : ""}`)
              );
              const serverOnly = restored.filter(m => {
                const sig = `${m.kind}::${"text" in m ? (m as {text: string}).text : ""}`;
                return !localSigs.has(sig);
              });
              return serverOnly.length > 0 ? [...serverOnly, ...prev] : prev;
            });
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
    // Cleared per turn; the answer branch fills it with the conversational
    // rendering so the earpiece can read a sentence instead of the bullets.
    lastSpeechRef.current = null;

    const userId = `u-${Date.now()}`;
    const thinkId = `t-${Date.now()}`;
    setMessages(prev => [...prev,
      { id: userId, kind: "user-msg" as const, text: raw },
      { id: thinkId, kind: "thinking" as const },
    ]);
    scrollDown();

    if (detectPortfolioIntent(raw)) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: "Opening Portfolio Pulse." } : m
      ));
      navigate("/portfolio");
      return;
    }

    if (detectPulseIntent(raw)) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: "Opening Property Pulse." } : m
      ));
      navigate("/pulse");
      return;
    }

    // ── Planning intent (briefing) — before panel/voice routing ──────────
    const planningMode = detectPlanningIntent(raw);
    if (planningMode) {
      setMessages(prev => [
        ...prev.filter(m => m.id !== thinkId),
        { id: thinkId, kind: "briefing-card" as const, mode: planningMode },
      ]);
      debouncedSaveThread([...messages, { id: userId, kind: "user-msg" as const, text: raw }]);
      scrollDown();
      return;
    }

    // ── Map lens intent ───────────────────────────────────────────────────
    if (detectMapLensIntent(raw)) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "live-map-card" as const, query: raw } : m
      ));
      scrollDown();
      return;
    }

    // ── Reminder intent — parse via voice to extract datetime + entity ───
    if (detectReminderIntent(raw)) {
      try {
        const vr = await parseVoice.mutateAsync({ data: { transcript: raw } });
        const ra = vr?.actions?.find((a: any) => a.tool === "create_reminder") as any;
        const f = ra?.fields ?? {};
        const reminderText = String(f.text ?? ra?.summary ?? raw).trim();
        let entityType: string | null = f.entityType ?? null;
        let entityId: string | null = null;
        let entityLabel: string | null = null;
        if (f.entityRef) {
          const [jobsR, crewsR, propsR] = await Promise.all([
            fetch("/api/jobs", { credentials: "include" }).then(r => r.ok ? r.json() : null),
            fetch("/api/crews", { credentials: "include" }).then(r => r.ok ? r.json() : null),
            fetch("/api/properties", { credentials: "include" }).then(r => r.ok ? r.json() : null),
          ]);
          const ref = String(f.entityRef).toLowerCase();
          const job = (jobsR?.jobs ?? jobsR as any[])?.find((j: any) => j.jobNo?.toLowerCase() === ref);
          const crew = !job && (crewsR?.crews ?? crewsR as any[])?.find((c: any) => c.name?.toLowerCase().includes(ref));
          const prop = !job && !crew && (propsR?.properties ?? propsR as any[])?.find((p: any) => p.name?.toLowerCase().includes(ref));
          if (job)       { entityType = "job";      entityId = job.id;  entityLabel = job.jobNo; }
          else if (crew) { entityType = "crew";     entityId = crew.id; entityLabel = crew.name; }
          else if (prop) { entityType = "property"; entityId = prop.id; entityLabel = prop.name; }
        }
        const res = await apiFetch("/api/reminders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: reminderText,
            remindAt: parseNaturalRemindAt(f.remindAt),  // normalise natural-language → ISO
            entityType,
            entityId,
            entityLabel,
          }),
        });
        const r = res?.reminder ?? {};
        const reminder: ReminderData = {
          id: r.id ?? `r-${Date.now()}`,
          text: r.text ?? reminderText,
          dueAt: r.remindAt ?? null,
          entityType: r.entityType ?? null,
          entityLabel: r.entityLabel ?? null,
          mode: "set",
        };
        setMessages(prev => prev.map(m =>
          m.id === thinkId ? { id: thinkId, kind: "reminder-card" as const, reminder } : m
        ));
      } catch {
        setMessages(prev => prev.map(m =>
          m.id === thinkId ? { id: thinkId, kind: "halo-answer" as const, text: "Couldn't save that reminder — try again." } : m
        ));
      }
      scrollDown();
      return;
    }

    // ── Dispatch intent — parse via voice then show DispatchCard ──────────
    if (detectDispatchIntent(raw)) {
      try {
        const vr = await parseVoice.mutateAsync({ data: { transcript: raw } });
        // Voice parse returns { tool, fields } — discriminate on `tool`
        const dispatchAction = vr?.actions?.find((a: any) => a.tool === "dispatch_crew") as any;
        if (dispatchAction) {
          const f = dispatchAction.fields ?? {};
          const jobNoStr = String(f.jobNo ?? "").toLowerCase();
          const crewNameStr = String(f.crewName ?? "").toLowerCase();
          const [jobsRes, crewsRes] = await Promise.all([
            fetch("/api/jobs", { credentials: "include" }).then(r => r.ok ? r.json() : { jobs: [] }),
            fetch("/api/crews", { credentials: "include" }).then(r => r.ok ? r.json() : { crews: [] }),
          ]);
          const matchedJob = (jobsRes.jobs ?? jobsRes as any[])?.find(
            (j: any) => j.jobNo?.toLowerCase() === jobNoStr || jobNoStr.includes(j.jobNo?.toLowerCase()),
          );
          const matchedCrew = (crewsRes.crews ?? crewsRes as any[])?.find(
            (c: any) => c.name?.toLowerCase().includes(crewNameStr) || crewNameStr.includes(c.name?.toLowerCase()),
          );
          if (matchedJob && matchedCrew) {
            const dispatchData: DispatchData = {
              jobId:             matchedJob.id,
              jobTitle:          matchedJob.title ?? matchedJob.jobNo ?? "Job",
              jobNo:             matchedJob.jobNo ?? null,
              propertyName:      matchedJob.propertyName ?? null,
              scheduledOn:       matchedJob.scheduledOn ?? null,
              currentCrewName:   matchedJob.crewLeaderName ?? null,
              proposedCrewId:    matchedCrew.id,
              proposedCrewName:  matchedCrew.name,
              proposedCrewTrade: matchedCrew.trade ?? null,
            };
            setMessages(prev => prev.map(m =>
              m.id === thinkId ? { id: thinkId, kind: "dispatch-card" as const, data: dispatchData } : m
            ));
            scrollDown();
            return;
          }
          // Could not resolve IDs — fall through to brain for clarification
        }
      } catch { /* fall through to brain */ }
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
    // Every brain failure is remembered: falling through to the generic
    // "try a command like…" prompt makes a real outage look like HALO simply
    // got dumb, which is the hardest failure of all to report.
    let brainError: unknown = null;

    // No conversation yet (first load raced the sign-in, or that create failed):
    // mint one now rather than silently skipping the brain for the whole session.
    if (!convoId) {
      try {
        const fresh = await apiFetch("/api/command/conversations", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "executive" }),
        });
        if (fresh?.conversation?.id) {
          convoId = fresh.conversation.id;
          setConversationId(convoId);
          try { sessionStorage.setItem("halo_desktop_convo_id", convoId!); } catch {}
        }
      } catch (e) { brainError = e; }
    }

    if (convoId) {
      try {
        brainResult = await apiFetch(`/api/command/conversations/${convoId}/ask`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: raw, role: "executive" }),
        });
      } catch (e: any) {
        brainError = e;
        if (e?.message?.startsWith("404")) {
          // Stale conversation id (server-side thread gone, or a new sign-in
          // re-scoped it). Mint a fresh one and retry the same question.
          // Never clear the thread here — it holds this question's thinking
          // bubble, and every branch below updates that placeholder by id, so
          // wiping it makes the recovered answer render nowhere.
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
              brainError = null; // recovered — don't report the stale-id 404
            }
          } catch (e2) { brainError = e2; }
        }
      }
    }

    if (brainResult) {
      if (brainResult.type === "lens" && brainResult.lensKind) {
        // Inline-first: inject LensCard into the thread; panel is secondary
        const lensType = brainResult.lensKind as LensType;
        const panel = BRAIN_LENS_TO_PANEL[brainResult.lensKind as string];
        const label = panel ? (PANEL_MAP.find(p => p.panel === panel)?.label ?? brainResult.lensKind) : brainResult.lensKind;
        setMessages(prev => [
          ...prev.map(m => m.id === thinkId
            ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text || `Here's the ${label} view.`, answer: brainResult.answer, followUps: brainResult.suggestedFollowUps }
            : m),
          { id: `lens-${Date.now()}`, kind: "lens-card" as const, lensType, query: raw },
        ]);
        scrollDown();
        return;
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
          ? {
              id: thinkId,
              kind: "halo-answer" as const,
              text: brainResult.text,
              answer: brainResult.answer,
              proposals: brainResult.proposals,
              sources: brainResult.sources,
              followUps: brainResult.suggestedFollowUps,
            }
          : m
      ));
      scrollDown();
      // Voice surfaces read this, never the on-screen bullets.
      lastSpeechRef.current = (brainResult.speech as string | undefined) ?? null;
      return;
    }

    // A failed ask is reported, never disguised as a canned suggestion.
    if (brainError) {
      const status = brainError instanceof ApiFetchError ? brainError.status : 0;
      const text =
        status === 401
          ? "Your office session expired — sign in again and I'll pick this straight back up."
          : status === 429
            ? "That's a lot of questions at once. Give it a few seconds and ask again."
            : `I couldn't reach the HALO brain just now${status ? ` (${status})` : ""}. Send it again and I'll retry.`;
      setMessages(prev => prev.map(m =>
        m.id === thinkId ? { id: thinkId, kind: "error" as const, text } : m
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

  useEffect(() => {
    const onGo = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (text) void handleSubmit(text);
    };
    window.addEventListener("halo-field-go", onGo);
    return () => window.removeEventListener("halo-field-go", onGo);
  }, [handleSubmit]);

  // ── Due-reminder resurfacing — inject overdue reminders as ReminderCards ──
  useEffect(() => {
    if (!brainReady) return;
    const sessionKey = `halo_due_reminders_${new Date().toLocaleDateString("en-CA")}`;
    if (sessionStorage.getItem(sessionKey)) return;
    void fetch("/api/reminders", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then((j: { reminders?: Array<{ id: string; text: string; remindAt?: string | null; entityType?: string | null; entityLabel?: string | null }> } | null) => {
        if (!j?.reminders?.length) return;
        const now = Date.now();
        const due = j.reminders.filter(r => r.remindAt && new Date(r.remindAt).getTime() <= now);
        if (!due.length) return;
        sessionStorage.setItem(sessionKey, "1");
        setMessages(prev => [
          ...prev,
          ...due.map(r => ({
            id: `due-${r.id}`,
            kind: "reminder-card" as const,
            reminder: {
              id: r.id,
              text: r.text,
              dueAt: r.remindAt ?? null,
              entityType: r.entityType ?? null,
              entityLabel: r.entityLabel ?? null,
              mode: "due" as const,
            },
          })),
        ]);
      })
      .catch(() => {});
  }, [brainReady]);

  useEffect(() => {
    if (!brainReady) return;
    const hour = new Date().getHours();
    if (hour < 5 || hour > 11) return;
    const key = `halo_watch_${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
    if (sessionStorage.getItem(key)) return;
    void fetch("/api/field/watch", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { spoken?: string | null; prompt?: string | null } | null) => {
        if (!j?.spoken) return;
        sessionStorage.setItem(key, "1");
        setMessages((prev) => [
          ...prev,
          { id: `watch-${Date.now()}`, kind: "halo-answer" as const, text: j.spoken!, followUps: j.prompt ? ["Run the first Watch item"] : undefined },
        ]);
      })
      .catch(() => {});
  }, [brainReady]);

  // ── Intel view submit — switches to chat then sends ─────────────────────
  const handleIntelAsk = useCallback((text: string) => {
    setIsIntelView(false);
    try { localStorage.setItem("halo_desktop_view", "chat"); } catch {}
    void handleSubmit(text);
  }, [handleSubmit]);

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
      case "halo-answer": return <HaloAnswerBubble text={msg.text} answer={msg.answer} proposals={msg.proposals} sources={msg.sources} followUps={msg.followUps} onFollowUp={handleSubmit} />;
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
      case "lens-card":
        return <LensCard lensType={msg.lensType} query={msg.query} onHandleSubmit={handleSubmit} />;
      case "briefing-card":
        return <BriefingCardThread mode={msg.mode} onAction={handleSubmit} />;
      case "live-map-card":
        return <LiveMapCard query={msg.query} />;
      case "dispatch-card":
        return (
          <DispatchCard
            data={msg.data}
            onConfirm={async (d) => {
              // POST /jobs/:id/dispatch — transactionally replaces crewLeaderId + scheduledOn
              const scheduledOn = d.scheduledOn ?? new Date().toLocaleDateString("en-CA");
              await apiFetch(`/api/jobs/${d.jobId}/dispatch`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ crewLeaderId: d.proposedCrewId, scheduledOn }),
              });
            }}
            onCancel={() => setMessages(prev => prev.map(m =>
              m.id === msg.id ? { id: msg.id, kind: "halo-answer" as const, text: "Dispatch cancelled." } : m
            ))}
          />
        );
      case "reminder-card":
        return (
          <ReminderCard
            reminder={msg.reminder}
            onDismiss={async (id) => {
              // Must NOT swallow — let ReminderCard catch and show its error/retry UI
              await apiFetch(`/api/reminders/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "dismiss" }),
              });
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { id: msg.id, kind: "success" as const, text: "Reminder dismissed." } : m
              ));
            }}
            onSnooze={async (id) => {
              await apiFetch(`/api/reminders/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "snooze", snoozeMinutes: 60 }),
              });
              setMessages(prev => prev.map(m =>
                m.id === msg.id ? { id: msg.id, kind: "success" as const, text: "Snoozed 1 hour." } : m
              ));
            }}
          />
        );
      default: return null;
    }
  };

  // ── Compact module render — thread + composer only, no hero, no header ────
  if (compact) {
    return (
      <>
        <style>{KEYFRAMES}</style>
        <div className="halo-void flex flex-col h-full min-h-0">
          {/* Re-homed header actions (from the old full-screen HaloCommand header) */}
          <div className="flex items-center gap-1 px-3 pt-2.5 pb-1.5 shrink-0">
            <button type="button" onClick={() => openPanel("map", "Live Map")} className="w-8 h-8 rounded-full grid place-items-center text-white/40 hover:text-[#B4FF44]" aria-label="Live map" title="Live map">
              <MapPin className="w-[15px] h-[15px]" />
            </button>
            <button type="button" onClick={() => openPanel("kanban", "Job Board")} className="w-8 h-8 rounded-full grid place-items-center text-white/40 hover:text-[#B4FF44]" aria-label="Job board" title="Job board">
              <LayoutGrid className="w-[15px] h-[15px]" />
            </button>
            <button type="button" onClick={() => setClientBoardOpen(true)} className="w-8 h-8 rounded-full grid place-items-center text-white/40 hover:text-[#B4FF44]" aria-label="Client board" title="Client board" data-testid="button-client-board">
              <PanelsTopLeft className="w-[15px] h-[15px]" />
            </button>
            <div className="flex-1" />
            {hasThread && (
              <button
                type="button"
                onClick={() => { setMessages([]); try { localStorage.removeItem(DESKTOP_THREAD_KEY); } catch {} }}
                className="text-[11px] font-medium text-white/25 hover:text-white/55 transition-colors px-2 py-1"
                title="Clear conversation"
              >
                Clear
              </button>
            )}
          </div>
          {!hasThread ? (
            /* Empty-state instruction card (short, no wall of text) */
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 min-h-0">
              <div
                className="rounded-[14px] border border-white/8 bg-white/[0.03] px-4 py-4 mb-3"
                style={{ animation: "dcIn 0.3s ease-out both" }}
              >
                <p className="text-[13px] font-semibold text-white/80 mb-1.5">Live operations map</p>
                <p className="text-[12px] text-white/45 leading-relaxed mb-3">
                  This page shows your properties and crews live on the map. Drag this
                  window by its title bar to move it, or hit <span className="text-white/70">✕</span> to
                  hide it — the chat icon in the nav brings it back.
                </p>
                <p className="text-[10px] font-bold tracking-[0.16em] uppercase text-white/25 mb-2">Try asking</p>
                <div className="flex flex-col gap-2">
                  {["Who's on site today?", "What units are complete?", "What's the work schedule?"].map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleSubmit(q)}
                      className="text-left text-[12.5px] text-white/60 px-3 py-2 rounded-[10px] bg-white/[0.04] border border-white/6 hover:text-white/85 hover:bg-white/[0.07] transition-all active:scale-[0.98]"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
              <div ref={bottomRef} className="h-1" />
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 min-h-0" aria-live="polite" aria-atomic="false">
              {messages.map(msg => (
                <div key={msg.id}>{renderMsg(msg)}</div>
              ))}
              <div ref={bottomRef} className="h-2" />
            </div>
          )}

          <div className="px-3 py-3 border-t border-white/[0.05] shrink-0">
            <ComposerInput value={input} onChange={setInput} onSubmit={() => handleSubmit()} onVoice={() => setVoiceOpen(true)} onEarpiece={() => setEarpieceOpen(true)} busy={parseVoice.isPending} />
          </div>
        </div>

        {/* Panels — overlay above the map */}
        <LiveMapPanel open={activePanel === "map"}    onClose={() => setActivePanel(null)} />
        <KanbanPanel  open={activePanel === "kanban"} onClose={() => setActivePanel(null)} />
        <MoneyPanel   open={activePanel === "money"}  onClose={() => setActivePanel(null)} />

        {/* Overlays */}
        <VoiceCaptureDialog open={voiceOpen} onOpenChange={setVoiceOpen} onHeard={(text) => { void handleSubmit(text); }} />
        <EarpieceMode open={earpieceOpen} onClose={() => setEarpieceOpen(false)} onCommand={async (text) => { await handleSubmit(text); return lastSpeechRef.current; }} />
        {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
        <ClientBoardPicker open={clientBoardOpen} onOpenChange={setClientBoardOpen} />
      </>
    );
  }

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
          <button type="button" onClick={() => setClientBoardOpen(true)} className="w-9 h-9 rounded-full grid place-items-center text-white/40 hover:text-[#B4FF44]" aria-label="Client board" title="Client board" data-testid="button-client-board">
            <PanelsTopLeft className="w-4 h-4" />
          </button>

          {/* View mode toggle — chat ↔ intelligence */}
          <button
            type="button"
            onClick={toggleView}
            className="w-9 h-9 rounded-full grid place-items-center transition-all"
            style={{ color: isIntelView ? "#B4FF44" : "rgba(255,255,255,0.32)" }}
            aria-label={isIntelView ? "Switch to Chat" : "Switch to Intelligence view"}
            title={isIntelView ? "Back to Chat" : "Intelligence view"}
          >
            {isIntelView
              ? <MessageSquare className="w-4 h-4" />
              : <BrainCircuit  className="w-4 h-4" />
            }
          </button>

          {/* Clear conversation */}
          {hasThread && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                try { localStorage.removeItem(DESKTOP_THREAD_KEY); } catch {}
              }}
              className="text-[11px] font-medium text-white/25 hover:text-white/55 transition-colors px-2 py-1"
              title="Clear conversation"
            >
              Clear
            </button>
          )}
        </header>

        {isIntelView ? (
          <HaloIntelligenceView
            onAsk={handleIntelAsk}
            input={input}
            onInputChange={setInput}
            busy={parseVoice.isPending}
          />
        ) : !hasThread ? (
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
                  {timeGreeting()} Speak it. HALO runs the rest.
                </p>
              </div>

              {/* Now strip */}
              {nowCount > 0 && (
                <div className="w-full mb-6" style={{ animation: "dcIn 0.5s ease-out 0.14s both", maxWidth: 680 }}>
                  <NowStrip
                    count={nowCount}
                    onExpand={() => setMessages(prev => [
                      ...prev,
                      { id: `u-brief-${Date.now()}`, kind: "user-msg" as const, text: "What needs my attention now?" },
                      { id: `brief-${Date.now()}`, kind: "briefing-card" as const, mode: "default" as const },
                    ])}
                  />
                </div>
              )}

              {/* Composer */}
              <div className="w-full" style={{ animation: "dcIn 0.5s ease-out 0.18s both", marginBottom: 28 }}>
                <ComposerInput value={input} onChange={setInput} onSubmit={() => handleSubmit()} onVoice={() => setVoiceOpen(true)} onEarpiece={() => setEarpieceOpen(true)} busy={parseVoice.isPending} />
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
                    <SeedCard key={i} card={card} onSubmit={handleSubmit} onEarpiece={() => setEarpieceOpen(true)} />
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
            <div className="flex-1 overflow-y-auto px-6 pt-5 pb-3 max-w-3xl mx-auto w-full" aria-live="polite" aria-atomic="false">
              {messages.map(msg => (
                <div key={msg.id}>{renderMsg(msg)}</div>
              ))}
              <div ref={bottomRef} className="h-4" />
            </div>

            <div className="px-6 py-4 border-t border-white/[0.04] shrink-0">
              <div className="max-w-3xl mx-auto">
                <ComposerInput value={input} onChange={setInput} onSubmit={() => handleSubmit()} onVoice={() => setVoiceOpen(true)} onEarpiece={() => setEarpieceOpen(true)} busy={parseVoice.isPending} />
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
      <EarpieceMode open={earpieceOpen} onClose={() => setEarpieceOpen(false)} onCommand={async (text) => { await handleSubmit(text); return lastSpeechRef.current; }} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
      <ClientBoardPicker open={clientBoardOpen} onOpenChange={setClientBoardOpen} />
    </>
  );
}

