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
  Paperclip, ArrowUp, Bell, MoreHorizontal, Loader2,
  CheckCircle2, AlertCircle, MapPin, Columns3, CircleDollarSign,
  List, CalendarDays, Mic, LayoutGrid, BrainCircuit, MessageSquare, Headphones, Building2,
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

import haloLogo from "../assets/halo-logo.png";
import { BriefingCard, NowStrip, useBriefingItems, BriefingCardLoading } from "@/components/command/BriefingCard";
import { ReminderCard, type ReminderData } from "@/components/command/ReminderCard";
import { DispatchCard, type DispatchData } from "@/components/command/DispatchCard";
import { LiveMapCard } from "@/components/command/LiveMapCard";
import { LensCard, type LensType } from "@/components/command/LensCard";
import { VoiceCaptureSheet } from "@/components/VoiceCaptureSheet";
import { EarpieceMode } from "@/components/EarpieceMode";
import { ArrivalDetection } from "@/components/ArrivalSheet";
import { NotificationsDrawer } from "@/components/NotificationsDrawer";
import { MinimalMenuSheet } from "@/components/MinimalMenuSheet";
import { ClientBoardPicker } from "@/components/ClientBoardPicker";
import { FalkonControlCenter } from "@/components/command/FalkonControlCenter";
import { ConfirmCard } from "@/components/command/ConfirmCard";
import { LiveMapPanel } from "@/components/panels/LiveMapPanel";
import { KanbanPanel } from "@/components/panels/KanbanPanel";
import { MoneyPanel } from "@/components/panels/MoneyPanel";
import { LiveLinkCard, type LiveLinkData } from "@/components/LiveLinkCard";
import { useFalkonHealth } from "@/lib/falkonNetwork";
import { HaloIntelligenceView } from "@/components/HaloIntelligenceView";

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
  | { id: string; kind: "live-link-card"; data: LiveLinkData }
  | { id: string; kind: "exchange-product-card"; products: ExchangeProductSummary[]; activationState: string }
  | { id: string; kind: "exchange-status-card"; statusData: ExchangeStatusData }
  | { id: string; kind: "success"; text: string }
  | { id: string; kind: "error"; text: string }
  | { id: string; kind: "mission"; title: string; steps: Array<{ plan: ActionPlanData; status: "pending" | "executing" | "done" | "error" | "declined"; result?: string }> }
  | { id: string; kind: "briefing-card"; mode?: "default" | "team-vs-personal" }
  | { id: string; kind: "live-map-card"; query?: string }
  | { id: string; kind: "dispatch-card"; data: DispatchData }
  | { id: string; kind: "reminder-card"; reminder: ReminderData }
  | { id: string; kind: "lens-card"; lensType: LensType; query?: string };

// ─── Exchange result parser ───────────────────────────────────────────────────
// Called after every auto-execute / manual-execute to check whether the action
// returned Exchange-typed JSON (exchange_products or exchange_status). Returns
// the TMsg shape (minus id) so callers can spread it in directly.

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

// ─── Live link result parser ──────────────────────────────────────────────────

function parseSupplyResult(result: unknown): { packet: string; poNo?: string } | null {
  if (!result || typeof result !== "string") return null;
  try {
    const p = JSON.parse(result);
    if (p.type === "supply_order") return { packet: p.packet, poNo: p.poNo };
    return null;
  } catch {
    return null;
  }
}

function parseSmsResult(result: unknown): string | null {
  if (!result || typeof result !== "string") return null;
  try {
    const p = JSON.parse(result);
    if (p.type === "sms_sent") return `Texted ${p.crewName}.`;
    if (p.type === "sms_draft") return `Draft for ${p.crewName}: ${p.body}${p.reason ? ` (${p.reason})` : ""}`;
    if (p.type === "schedule") return `Scheduled ${p.jobNo}${p.unitNo ? ` · Unit ${p.unitNo}` : ""} for ${p.scheduledOn}${p.crewName ? ` · ${p.crewName}` : ""}.`;
    return null;
  } catch {
    return null;
  }
}

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
@keyframes haloAura {
  0%,100%{filter:drop-shadow(0 0 6px rgba(180,255,68,0.45)) drop-shadow(0 0 18px rgba(180,255,68,0.18))}
  50%{filter:drop-shadow(0 0 14px rgba(180,255,68,0.75)) drop-shadow(0 0 36px rgba(180,255,68,0.28))}
}
@keyframes hcScan { 0%{transform:translateY(-40%);opacity:0} 40%{opacity:.35} 100%{transform:translateY(140%);opacity:0} }
@media(prefers-reduced-motion:reduce){
  .hc-in{animation:none!important}
  @keyframes haloAura{0%,100%{filter:none}}
}
`;

// ─── Angel Halo Ring ──────────────────────────────────────────────────────────

function AngelHalo() {
  return (
    <svg
      width="128" height="48" viewBox="0 0 128 48" fill="none"
      style={{ animation: "haloAura 3.2s ease-in-out infinite", display: "block" }}
    >
      <defs>
        <linearGradient id="hg-m" x1="0%" y1="50%" x2="100%" y2="50%">
          <stop offset="0%"   stopColor="#3A5A0C" stopOpacity="0" />
          <stop offset="18%"  stopColor="#6D9B12" stopOpacity="1" />
          <stop offset="38%"  stopColor="#B4FF44" stopOpacity="1" />
          <stop offset="50%"  stopColor="#E8FFB0" stopOpacity="1" />
          <stop offset="62%"  stopColor="#B4FF44" stopOpacity="1" />
          <stop offset="82%"  stopColor="#6D9B12" stopOpacity="1" />
          <stop offset="100%" stopColor="#3A5A0C" stopOpacity="0" />
        </linearGradient>
        <filter id="hglow-m" x="-25%" y="-100%" width="150%" height="380%">
          <feGaussianBlur stdDeviation="3.5" result="b1" />
          <feGaussianBlur stdDeviation="9"   result="b2" />
          <feMerge>
            <feMergeNode in="b2" />
            <feMergeNode in="b1" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse
        cx="64" cy="24" rx="57" ry="18"
        stroke="url(#hg-m)" strokeWidth="4.5" fill="none"
        filter="url(#hglow-m)"
      />
    </svg>
  );
}

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
  // Already a valid ISO / parseable date — accept as-is
  const direct = new Date(raw);
  if (!isNaN(direct.getTime()) && /\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/.test(raw)) {
    return direct.toISOString();
  }
  const s = raw.toLowerCase().trim();
  const now = new Date();

  // "in N hours/minutes"
  const relH = s.match(/in\s+(\d+)\s+hour/);
  if (relH) { const d = new Date(now); d.setHours(d.getHours() + parseInt(relH[1])); return d.toISOString(); }
  const relM = s.match(/in\s+(\d+)\s+min/);
  if (relM) { const d = new Date(now); d.setMinutes(d.getMinutes() + parseInt(relM[1])); return d.toISOString(); }

  // Extract time component (default 9:00 am)
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
    return null; // unrecognised pattern
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

const MOBILE_THREAD_KEY = "halo_office_thread_v1";
const THREAD_CAP = 50;

const SERIALISABLE_KINDS = new Set([
  "user-msg", "halo-answer", "success", "error",
  "briefing-card", "live-map-card", "dispatch-card", "reminder-card", "lens-card",
]);

function loadThread(): TMsg[] {
  try {
    const raw = localStorage.getItem(MOBILE_THREAD_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as TMsg[];
    return parsed.filter(m => SERIALISABLE_KINDS.has(m.kind)).slice(-THREAD_CAP);
  } catch { return []; }
}

function saveThread(msgs: TMsg[]) {
  try {
    const serialisable = msgs.filter(m => SERIALISABLE_KINDS.has(m.kind)).slice(-THREAD_CAP);
    localStorage.setItem(MOBILE_THREAD_KEY, JSON.stringify(serialisable));
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
            className="flex-1 h-10 rounded-[11px] text-[13px] font-semibold bg-white text-[#07101E] hover:bg-white/92 active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
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

function MissionCard({
  title, steps, falkonMode, onExecuteAll, onDecline,
}: {
  title: string;
  steps: Array<{ plan: ActionPlanData; status: string; result?: string }>;
  falkonMode: FalkonMode;
  onExecuteAll: () => void;
  onDecline: () => void;
}) {
  const blocked = steps.some(s => s.plan.risk === "block");
  const needsReview = steps.some(s => s.plan.risk === "review");
  const pending = steps.every(s => s.status === "pending");
  const running = steps.some(s => s.status === "executing");
  return (
    <div
      className="rounded-[16px] px-4 py-4 mb-4 hc-in"
      style={{
        background: "rgba(8,14,24,0.92)",
        border: "1px solid rgba(180,255,68,0.14)",
        animation: "hcFadeUp 0.2s ease-out both",
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="halo-hud" style={{ color: "#B4FF44" }}>Mission</span>
        <span className="text-[11px] text-white/40">{title}</span>
      </div>
      <ol className="space-y-2 mb-4">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="halo-hud mt-0.5 w-5 shrink-0" style={{ color: s.status === "done" ? "#22C55E" : s.status === "error" ? "#E11D48" : "rgba(180,255,68,0.7)" }}>
              {s.status === "done" ? "GO" : s.status === "executing" ? "…" : String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <p className="text-[13px] text-white/80 leading-snug">{s.plan.description}</p>
              {s.result && <p className="text-[11px] text-white/35 mt-0.5 whitespace-pre-wrap">{s.result}</p>}
            </div>
          </li>
        ))}
      </ol>
      {pending && !blocked && falkonMode !== "SHADOW" && (
        <div className="flex gap-2">
          <button type="button" onClick={onExecuteAll}
            className="flex-1 h-10 rounded-[11px] text-[13px] font-semibold bg-white text-[#07101E] hover:bg-white/92 active:scale-[0.97] transition-all focus-visible:ring-2 focus-visible:ring-white/60 outline-none">
            {needsReview ? "Approve mission" : "Execute mission"}
          </button>
          <button type="button" onClick={onDecline}
            className="h-10 px-5 rounded-[11px] text-[13px] text-white/40"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
            Abort
          </button>
        </div>
      )}
      {running && <p className="text-[11px] text-[#B4FF44]/70">Running sequence…</p>}
      {falkonMode === "SHADOW" && pending && (
        <p className="text-[11px] text-white/30">SHADOW — switch to ASSISTED to fly this mission.</p>
      )}
    </div>
  );
}

// ─── Seed card data ───────────────────────────────────────────────────────────

const SEED_CARDS = [
  { Icon: LayoutGrid,   color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Structure my day", title: "Daily Brief", desc: "Now / Today / This Week priorities." },
  { Icon: List,         color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "What needs my attention right now?", title: "Mission brief", desc: "What is on fire this hour." },
  { Icon: CalendarDays, color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Open Property Pulse", title: "Property Pulse", desc: "Live sites, GPS, and crew pings." },
  { Icon: Building2,    color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Open Portfolio Pulse", title: "Portfolio Pulse", desc: "Vacancy dollars, turn days, attention." },
  { Icon: Headphones,   color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "", title: "Earpiece", desc: "AirPods. Say go, next, skip.", action: "earpiece" as const },
];

function SeedCard({ card, onSubmit, onEarpiece }: { card: typeof SEED_CARDS[number]; onSubmit: (s: string) => void; onEarpiece: () => void }) {
  return (
    <button
      onClick={() => card.action === "earpiece" ? onEarpiece() : onSubmit(card.prompt)}
      className="text-left rounded-[12px] transition-all active:scale-[0.97]"
      style={{
        padding: "12px 12px",
        background: "rgba(255,255,255,0.034)",
        border: "1px solid rgba(255,255,255,0.065)",
      }}
    >
      <div style={{
        width: 26, height: 26, borderRadius: 7, background: card.bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 8,
      }}>
        <card.Icon size={13} color={card.color} strokeWidth={2} />
      </div>
      <p style={{ fontSize: 12.5, fontWeight: 600, color: "rgba(255,255,255,0.8)", lineHeight: 1.35, marginBottom: 4 }}>
        {card.title}
      </p>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.4 }}>
        {card.desc}
      </p>
    </button>
  );
}

// ─── BriefingCardThread — self-contained wrapper used inside renderMsg ────────

function BriefingCardThread({ mode, onAction }: {
  mode?: "default" | "team-vs-personal";
  onAction: (cmd: string) => void;
}) {
  const { items, loading } = useBriefingItems();
  if (loading) return <BriefingCardLoading />;
  return <BriefingCard items={items} mode={mode ?? "default"} onAction={onAction} />;
}

// ─── Wings icon ───────────────────────────────────────────────────────────────

function WingsIcon() {
  return (
    <svg width="20" height="13" viewBox="0 0 22 14" fill="none" style={{ opacity: 0.32 }}>
      <path d="M11 7C9.5 4.5 6 2 2 2C2 5 4 8 7 9.5L11 7Z" fill="white" />
      <path d="M11 7C12.5 4.5 16 2 20 2C20 5 18 8 15 9.5L11 7Z" fill="white" />
      <ellipse cx="11" cy="7" rx="1.5" ry="1" fill="white" />
    </svg>
  );
}

// ─── Shared composer ──────────────────────────────────────────────────────────

function ComposerInput({
  value, onChange, onSubmit, onVoice, onEarpiece, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVoice?: () => void;
  onEarpiece?: () => void;
  busy: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const ready = Boolean(value.trim());

  return (
    <div
      style={{
        display: "flex", alignItems: "center",
        background: focused ? "rgba(8,14,24,0.92)" : "rgba(10,16,28,0.82)",
        border: `1px solid ${focused ? "rgba(180,255,68,0.28)" : "rgba(255,255,255,0.08)"}`,
        borderRadius: 28,
        boxShadow: focused
          ? "0 0 0 4px rgba(180,255,68,0.08), 0 12px 40px rgba(0,0,0,0.45)"
          : "0 8px 32px rgba(0,0,0,0.35)",
        transition: "all 0.2s ease",
        padding: "6px 6px 6px 16px",
      }}
    >
      <button
        type="button"
        onClick={onVoice}
        aria-label="Talk to HALO"
        className="shrink-0 grid place-items-center rounded-full transition-all active:scale-95"
        style={{ width: 36, height: 36, color: "rgba(255,255,255,0.45)" }}
      >
        <Mic size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onEarpiece}
        aria-label="Earpiece mode"
        className="shrink-0 grid place-items-center rounded-full transition-all active:scale-95"
        style={{ width: 36, height: 36, color: "rgba(180,255,68,0.85)" }}
      >
        <Headphones size={16} strokeWidth={2} />
      </button>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); } }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Command HALO…"
        style={{
          flex: 1, background: "transparent", border: "none", outline: "none",
          fontSize: 15, color: "rgba(255,255,255,0.92)", caretColor: "#B4FF44",
          padding: "10px 10px", minHeight: 44,
        }}
      />
      <Paperclip size={14} strokeWidth={2} style={{ color: "rgba(255,255,255,0.18)", flexShrink: 0, marginRight: 8 }} />
      <button
        type="button"
        onClick={onSubmit}
        disabled={!ready || busy}
        aria-label="Send"
        style={{
          width: 36, height: 36, borderRadius: "50%", flexShrink: 0, cursor: ready ? "pointer" : "default",
          background: ready ? "#B4FF44" : "rgba(255,255,255,0.08)",
          border: "none",
          display: "grid", placeItems: "center",
          color: ready ? "#07101E" : "rgba(255,255,255,0.28)",
          transition: "all 0.18s ease",
          boxShadow: ready ? "0 0 18px rgba(180,255,68,0.35)" : "none",
          opacity: busy ? 0.55 : 1,
        }}
      >
        {busy
          ? <Loader2 size={14} className="animate-spin" />
          : <ArrowUp size={15} strokeWidth={2.4} />
        }
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
  const [messages, setMessages] = useState<TMsg[]>(() => loadThread());
  const [input, setInput] = useState("");

  // Persist thread to localStorage whenever it changes
  useEffect(() => { debouncedSaveThread(messages); }, [messages]);

  // ── Brain conversation ────────────────────────────────────────────────────
  const [conversationId, setConversationId] = useState<string | null>(() => {
    try { return sessionStorage.getItem("halo_convo_id"); } catch { return null; }
  });
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[] | null>(null);
  const [brainReady, setBrainReady] = useState(false);

  // ── Panels ────────────────────────────────────────────────────────────────
  const [activePanel, setActivePanel] = useState<PanelType | null>(null);

  // ── View mode — persisted so the user's preference survives navigation ───
  const [isIntelView, setIsIntelView] = useState<boolean>(() => {
    try { return localStorage.getItem("halo_view") === "intel"; } catch { return false; }
  });
  const toggleView = useCallback(() => {
    setIsIntelView(v => {
      const next = !v;
      try { localStorage.setItem("halo_view", next ? "intel" : "chat"); } catch {}
      return next;
    });
  }, []);

  // ── Overlays ──────────────────────────────────────────────────────────────
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [earpieceOpen, setEarpieceOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientBoardOpen, setClientBoardOpen] = useState(false);
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
            // Merge server history with persisted local thread.
            // IDs cannot be used for dedup (local: u-*/t-* generated; server: r-${serverId}).
            // Instead fingerprint by kind+text so locally captured brain messages aren't duplicated,
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

    if (detectPortfolioIntent(raw)) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "halo-answer" as const, text: "Opening Portfolio Pulse." }
          : m
      ));
      navigate("/portfolio");
      return;
    }

    // ── Daily surfaces first: Pulse is the dashboard, panels stay overlays ─
    if (detectPulseIntent(raw)) {
      setMessages(prev => prev.map(m =>
        m.id === thinkId
          ? { id: thinkId, kind: "halo-answer" as const, text: "Opening Property Pulse." }
          : m
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
        // Voice parser returns create_reminder { text, remindAt (ISO or natural), entityRef, entityType }
        const vr = await parseVoice.mutateAsync({ data: { transcript: raw } });
        const ra = vr?.actions?.find((a: any) => a.tool === "create_reminder") as any;
        const f = ra?.fields ?? {};
        // If voice parser found nothing useful, fall back to posting raw text with no date
        const reminderText = String(f.text ?? ra?.summary ?? raw).trim();
        // Resolve entity if given (best-effort)
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
          // Resolve names→IDs from live data
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
          // Could not resolve IDs — fall through to brain which can ask for clarification
        }
      } catch { /* fall through to brain */ }
    }

    // ── Panel intent ──────────────────────────────────────────────────────
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
    // Every brain failure is remembered: falling through to the generic
    // "try asking about your jobs" prompt makes a real outage look like HALO
    // simply got dumb, which is the hardest failure of all to report.
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
          try { sessionStorage.setItem("halo_convo_id", convoId!); } catch {}
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
              brainError = null; // recovered — don't report the stale-id 404
            }
          } catch (e2) { brainError = e2; }
        }
      }
    }

    if (brainResult) {
      if (brainResult.type === "lens" && brainResult.lensKind) {
        // Inline-first: inject LensCard into the thread; panel opens as secondary
        const lensType = brainResult.lensKind as LensType;
        const panel = BRAIN_LENS_TO_PANEL[brainResult.lensKind as string];
        const label = panel ? (PANEL_MAP.find(p => p.panel === panel)?.label ?? brainResult.lensKind) : brainResult.lensKind;
        setMessages(prev => [
          ...prev.map(m => m.id === thinkId
            ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text || `Here's the ${label} view.`, followUps: brainResult.suggestedFollowUps }
            : m),
          { id: `lens-${Date.now()}`, kind: "lens-card" as const, lensType, query: raw },
        ]);
        scrollDown();
        return;
      }

      if (brainResult.type === "voice_action") {
        setMessages(prev => prev.map(m =>
          m.id === thinkId
            ? { id: thinkId, kind: "halo-answer" as const, text: brainResult.text, followUps: brainResult.suggestedFollowUps }
            : m
        ));
        const plans: ActionPlanData[] = Array.isArray(brainResult.actionPlans) && brainResult.actionPlans.length
          ? brainResult.actionPlans
          : brainResult.actionPlan
            ? [brainResult.actionPlan as ActionPlanData]
            : [];
        const falkonModeNow = deriveFalkonMode(health);
        if (plans.length > 1) {
          const missionId = `ms-${Date.now()}`;
          const autoFly = falkonModeNow === "ASSISTED" && plans.every(p => p.risk === "auto");
          setMessages(prev => [...prev, {
            id: missionId,
            kind: "mission" as const,
            title: `${plans.length} steps`,
            steps: plans.map(p => ({ plan: p, status: autoFly ? "executing" as const : "pending" as const })),
          }]);
          if (autoFly) {
            void (async () => {
              for (let i = 0; i < plans.length; i++) {
                try {
                  const r = await apiFetch("/api/command/actions/execute", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(plans[i]),
                  });
                  const pretty = parseSmsResult(r.result) || parseSupplyResult(r.result)?.packet || r.result;
                  const llData = parseLiveLinkResult(r.result);
                  setMessages(prev => {
                    const next = prev.map(m => {
                      if (m.id !== missionId || m.kind !== "mission") return m;
                      const steps = m.steps.map((s, idx) => idx === i ? { ...s, status: "done" as const, result: typeof pretty === "string" ? pretty : s.plan.description } : s);
                      return { ...m, steps };
                    });
                    if (llData) next.push({ id: `ll-${Date.now()}-${i}`, kind: "live-link-card" as const, data: llData });
                    return next;
                  });
                } catch {
                  setMessages(prev => prev.map(m => {
                    if (m.id !== missionId || m.kind !== "mission") return m;
                    return { ...m, steps: m.steps.map((s, idx) => idx === i ? { ...s, status: "error" as const } : s) };
                  }));
                  break;
                }
              }
            })();
          }
        } else if (plans[0]) {
          const plan = plans[0];
          const planId = `plan-${Date.now()}`;
          if (plan.risk === "auto" && falkonModeNow === "ASSISTED") {
            setMessages(prev => [...prev, { id: planId, kind: "action-plan" as const, plan, status: "executing" as const }]);
            scrollDown();
            try {
              const r = await apiFetch("/api/command/actions/execute", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(plan),
              });
              const llData = parseLiveLinkResult(r.result);
              const exData = parseExchangeResult(r.result);
              if (llData) {
                setMessages(prev => [
                  ...prev.map(m => m.id === planId ? { ...m as any, status: "done" as const } : m),
                  { id: `ll-${Date.now()}`, kind: "live-link-card" as const, data: llData },
                ]);
              } else if (exData) {
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

    // ── Brain reachable? ──────────────────────────────────────────────────
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
            ? { id: thinkId, kind: "halo-answer" as const, text: "Try asking about your jobs, crews, or finances — or say 'open Property Pulse'." }
            : m
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

  // ── Due-reminder resurfacing — inject any overdue reminders as ReminderCards
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
    try { localStorage.setItem("halo_view", "chat"); } catch {}
    void handleSubmit(text);
  }, [handleSubmit]);

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
                const exData = parseExchangeResult(r.result);
                if (llData) {
                  setMessages(prev => [
                    ...prev.map(m => m.id === planMsg.id ? { ...m as any, status: "done" as const } : m),
                    { id: `ll-${Date.now()}`, kind: "live-link-card" as const, data: llData },
                  ]);
                } else if (exData) {
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
      case "mission": {
        const mission = msg;
        return (
          <MissionCard
            title={mission.title}
            steps={mission.steps}
            falkonMode={falkonMode}
            onExecuteAll={async () => {
              setMessages(prev => prev.map(m => m.id !== mission.id || m.kind !== "mission" ? m : {
                ...m, steps: m.steps.map(s => ({ ...s, status: "executing" as const })),
              }));
              for (let i = 0; i < mission.steps.length; i++) {
                try {
                  const r = await apiFetch("/api/command/actions/execute", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(mission.steps[i].plan),
                  });
                  const pretty = parseSmsResult(r.result) || parseSupplyResult(r.result)?.packet || r.result;
                  const llData = parseLiveLinkResult(r.result);
                  setMessages(prev => {
                    const next = prev.map(m => {
                      if (m.id !== mission.id || m.kind !== "mission") return m;
                      return { ...m, steps: m.steps.map((s, idx) => idx === i ? { ...s, status: "done" as const, result: typeof pretty === "string" ? pretty : s.plan.description } : s) };
                    });
                    if (llData) next.push({ id: `ll-${Date.now()}-${i}`, kind: "live-link-card" as const, data: llData });
                    return next;
                  });
                  qc.invalidateQueries({ queryKey: getGetTodayQueryKey() });
                } catch {
                  setMessages(prev => prev.map(m => m.id !== mission.id || m.kind !== "mission" ? m : {
                    ...m, steps: m.steps.map((s, idx) => idx === i ? { ...s, status: "error" as const } : s),
                  }));
                  break;
                }
              }
            }}
            onDecline={() => setMessages(prev => prev.map(m => m.id !== mission.id || m.kind !== "mission" ? m : {
              ...m, steps: m.steps.map(s => ({ ...s, status: "declined" as const })),
            }))}
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
      case "exchange-product-card":
        return (
          <div style={{ background: "rgba(180,255,68,0.035)", border: "1px solid rgba(180,255,68,0.1)", borderRadius: 14, padding: "12px 14px", marginBottom: 12, animation: "hcFadeUp 0.2s ease-out both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(180,255,68,0.65)", textTransform: "uppercase" }}>Falkon Exchange</span>
              <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.3)" }}>{msg.activationState}</span>
            </div>
            {msg.products.length === 0
              ? <div style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", padding: "4px 0" }}>No products found.</div>
              : <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {msg.products.map(p => (
                    <div key={p.id} style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.055)", borderRadius: 10, padding: "8px 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255,255,255,0.82)", flex: 1, lineHeight: 1.3 }}>{p.name}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", background: "rgba(255,255,255,0.055)", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{p.category}</span>
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.38)" }}>{p.pricePerUnit != null ? `$${(p.pricePerUnit / 100).toLocaleString()} / ${p.pricingModel.replace(/_/g, " ")}` : "Custom pricing"}</span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{p.slaHours}h SLA</span>
                        {p.activeEntitlements > 0 && <span style={{ fontSize: 11, color: "rgba(180,255,68,0.65)" }}>{p.activeEntitlements} partner{p.activeEntitlements !== 1 ? "s" : ""}</span>}
                      </div>
                    </div>
                  ))}
                </div>
            }
          </div>
        );
      case "exchange-status-card":
        return (
          <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 14, padding: "12px 14px", marginBottom: 12, animation: "hcFadeUp 0.2s ease-out both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", color: "rgba(180,255,68,0.65)", textTransform: "uppercase" }}>Exchange Activation</span>
              <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 6, background: msg.statusData.prerequisitesAllMet ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.09)", color: msg.statusData.prerequisitesAllMet ? "rgba(34,197,94,0.8)" : "rgba(245,158,11,0.75)" }}>{msg.statusData.activationState}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(msg.statusData.prerequisites ?? []).map(p => (
                <div key={p.key} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ width: 15, height: 15, borderRadius: "50%", background: p.met ? "rgba(34,197,94,0.12)" : "rgba(225,29,72,0.1)", border: `1px solid ${p.met ? "rgba(34,197,94,0.3)" : "rgba(225,29,72,0.22)"}`, flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: p.met ? "#22C55E" : "#E11D48", fontWeight: 700 }}>{p.met ? "✓" : "✗"}</div>
                  <div>
                    <div style={{ fontSize: 12, color: p.met ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.42)", fontWeight: 500, lineHeight: 1.35 }}>{p.label}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 1, lineHeight: 1.4 }}>{p.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            {msg.statusData.hint && (
              <div style={{ marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.3)", fontStyle: "italic", lineHeight: 1.45 }}>{msg.statusData.hint}</div>
            )}
          </div>
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
              // Only replace the card after server confirms success
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
      default:
        return null;
    }
  };

  // ── Prompt chips (4 for the 2×2 seed grid) ───────────────────────────────
  const promptChips = suggestedPrompts?.slice(0, 4) ?? [
    "Open Property Pulse",
    "What needs my attention?",
    "Show unpaid invoices",
    "Generate a live link",
  ];

  // ── Quick-lens chips including "Brief" ────────────────────────────────────
  const QUICK_CHIPS = [
    { label: "Brief",    cmd: "Structure my day" },
    { label: "Map",      cmd: "Live crew map" },
    { label: "Money",    cmd: "Open Money" },
    { label: "Jobs",     cmd: "Job board" },
  ];

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{KEYFRAMES}</style>

      {/* ── Shell ─────────────────────────────────────────────────────────── */}
      <div
        className="halo-void flex flex-col overflow-hidden"
        style={{ minHeight: "100dvh", height: "100dvh" }}
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

          <button
            type="button"
            onClick={() => openPanel("map", "Live Map")}
            className="w-8 h-8 rounded-full grid place-items-center text-white/35 hover:text-[#B4FF44] transition-colors"
            aria-label="Live map"
            title="Live map"
          >
            <MapPin className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => navigate("/pulse")}
            className="w-8 h-8 rounded-full grid place-items-center text-[#B4FF44] hover:text-white transition-colors"
            aria-label="Property Pulse"
            title="Property Pulse"
          >
            <LayoutGrid className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setClientBoardOpen(true)}
            className="w-8 h-8 rounded-full grid place-items-center text-white/35 hover:text-[#B4FF44] transition-colors"
            aria-label="Client board"
            title="Client board"
            data-testid="button-client-board"
          >
            <PanelsTopLeft className="w-[15px] h-[15px]" strokeWidth={1.8} />
          </button>

          {/* View mode toggle — chat ↔ intelligence */}
          <button
            type="button"
            onClick={toggleView}
            className="w-8 h-8 rounded-full grid place-items-center transition-all active:scale-95"
            style={{ color: isIntelView ? "#B4FF44" : "rgba(255,255,255,0.32)" }}
            aria-label={isIntelView ? "Switch to Chat" : "Switch to Intelligence view"}
            title={isIntelView ? "Back to Chat" : "Intelligence view"}
          >
            {isIntelView
              ? <MessageSquare className="w-[15px] h-[15px]" strokeWidth={1.8} />
              : <BrainCircuit  className="w-[15px] h-[15px]" strokeWidth={1.8} />
            }
          </button>

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

          {/* Clear conversation — only when thread is active */}
          {hasThread && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                try { localStorage.removeItem(MOBILE_THREAD_KEY); } catch {}
              }}
              className="text-[10px] font-semibold text-white/25 hover:text-white/55 transition-colors px-2 py-1"
              title="Clear conversation"
            >
              Clear
            </button>
          )}

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
        {isIntelView ? (
          <HaloIntelligenceView
            onAsk={handleIntelAsk}
            input={input}
            onInputChange={setInput}
            busy={parseVoice.isPending}
          />
        ) : !hasThread ? (

          /* ── SEED STATE ─────────────────────────────────────────────────── */
          <div
            className="flex-1 flex flex-col items-center overflow-y-auto"
            style={{ padding: "28px 20px", paddingBottom: "max(28px, env(safe-area-inset-bottom))" }}
          >
            <div className="w-full flex flex-col items-center" style={{ maxWidth: 420 }}>

              {/* Angel halo ring */}
              <div style={{ animation: "hcFadeUp 0.45s ease-out 0.02s both", marginBottom: 18 }}>
                <AngelHalo />
              </div>

              {/* Greeting */}
              <div className="text-center hc-in" style={{ animation: "hcFadeUp 0.45s ease-out 0.1s both", marginBottom: 28 }}>
                <h1 className="font-display" style={{
                  fontSize: "clamp(36px, 10vw, 52px)", fontWeight: 600,
                  color: "#F4F7F9", lineHeight: 1.05, letterSpacing: "-0.04em",
                  marginBottom: 10,
                }}>
                  HALO
                </h1>
                <p className="halo-hud" style={{ color: "rgba(180,255,68,0.7)", marginBottom: 10 }}>
                  Mission control
                </p>
                <p style={{ fontSize: 14, color: "rgba(255,255,255,0.42)", lineHeight: 1.55 }}>
                  {timeGreeting()} Speak it. HALO runs the rest.
                </p>
              </div>

              {/* Now strip — auto-loaded briefing teaser */}
              {nowCount > 0 && (
                <div className="w-full hc-in mb-4" style={{ animation: "hcFadeUp 0.45s ease-out 0.14s both" }}>
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
              <div className="w-full hc-in" style={{ animation: "hcFadeUp 0.45s ease-out 0.18s both", marginBottom: 22 }}>
                <ComposerInput
                  value={input}
                  onChange={setInput}
                  onSubmit={() => handleSubmit()}
                  onVoice={() => setVoiceOpen(true)}
                  onEarpiece={() => setEarpieceOpen(true)}
                  busy={parseVoice.isPending}
                />
              </div>

              {/* TRY ASKING label + 2×2 card grid */}
              <div className="w-full hc-in" style={{ animation: "hcFadeUp 0.45s ease-out 0.26s both" }}>
                <p style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.18em",
                  color: "rgba(255,255,255,0.22)", textTransform: "uppercase",
                  marginBottom: 10,
                }}>
                  Try Asking
                </p>
                <div className="grid grid-cols-2 gap-[8px]">
                  {SEED_CARDS.map((card, i) => (
                    <SeedCard key={i} card={card} onSubmit={handleSubmit} onEarpiece={() => setEarpieceOpen(true)} />
                  ))}
                </div>
              </div>

              {/* Footer */}
              <div style={{
                marginTop: 24, display: "flex", alignItems: "center", gap: 7,
                animation: "hcFadeUp 0.45s ease-out 0.34s both",
              }}>
                <WingsIcon />
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
                  Halo can make mistakes. Always verify critical information.
                </span>
              </div>

            </div>
          </div>

        ) : (

          /* ── THREAD STATE ───────────────────────────────────────────────── */
          <>
            <div
              className="flex-1 overflow-y-auto overscroll-none"
              aria-live="polite"
              aria-atomic="false"
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
                onEarpiece={() => setEarpieceOpen(true)}
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
      <VoiceCaptureSheet
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onHeard={(text) => { void handleSubmit(text); }}
      />
      <EarpieceMode
        open={earpieceOpen}
        onClose={() => setEarpieceOpen(false)}
        onCommand={(text) => { void handleSubmit(text); }}
      />
      <ArrivalDetection />
      <NotificationsDrawer open={notifOpen} onOpenChange={setNotifOpen} />
      <MinimalMenuSheet
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onOpenClientBoard={() => {
          setMenuOpen(false);
          setClientBoardOpen(true);
        }}
      />
      <ClientBoardPicker open={clientBoardOpen} onOpenChange={setClientBoardOpen} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
  );
}
