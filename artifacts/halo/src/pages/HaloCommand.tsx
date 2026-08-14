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
  List, CalendarDays, Users, Mic, LayoutGrid,
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
  | { id: string; kind: "mission"; title: string; steps: Array<{ plan: ActionPlanData; status: "pending" | "executing" | "done" | "error" | "declined"; result?: string }> };

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
@media(prefers-reduced-motion:reduce){.hc-in{animation:none!important}}
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
            className="flex-1 h-10 rounded-[11px] text-[13px] font-semibold active:scale-[0.97]"
            style={{ background: "#B4FF44", color: "#07101E" }}>
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
  { Icon: LayoutGrid,   color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Open Property Pulse", title: "Property Pulse", desc: "Live sites, GPS, and crew pings." },
  { Icon: List,         color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "What needs my attention right now?", title: "Mission brief", desc: "What is on fire this hour." },
  { Icon: CalendarDays, color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Make a note to order drywall for unit 624 and text Kyann to schedule install for tomorrow", title: "Run a mission", desc: "Note, source, schedule, text." },
  { Icon: Users,        color: "#B4FF44", bg: "rgba(180,255,68,0.10)", prompt: "Generate a check-in link for the crew on site today", title: "Crew link", desc: "Send a check-in link instantly." },
];

function SeedCard({ card, onSubmit }: { card: typeof SEED_CARDS[number]; onSubmit: (s: string) => void }) {
  return (
    <button
      onClick={() => onSubmit(card.prompt)}
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
  value, onChange, onSubmit, onVoice, busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onVoice?: () => void;
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
                {totalNeeds > 0 && (
                  <p style={{ marginTop: 8, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                    <span style={{ color: "rgba(225,29,72,0.82)", fontWeight: 600 }}>
                      {totalNeeds} item{totalNeeds !== 1 ? "s" : ""}
                    </span>
                    {" "}need{totalNeeds === 1 ? "s" : ""} your attention
                  </p>
                )}
              </div>

              {/* Composer */}
              <div className="w-full hc-in" style={{ animation: "hcFadeUp 0.45s ease-out 0.18s both", marginBottom: 22 }}>
                <ComposerInput
                  value={input}
                  onChange={setInput}
                  onSubmit={() => handleSubmit()}
                  onVoice={() => setVoiceOpen(true)}
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
                    <SeedCard key={i} card={card} onSubmit={handleSubmit} />
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
      <VoiceCaptureSheet
        open={voiceOpen}
        onOpenChange={setVoiceOpen}
        onHeard={(text) => { void handleSubmit(text); }}
      />
      <NotificationsDrawer open={notifOpen} onOpenChange={setNotifOpen} />
      <MinimalMenuSheet open={menuOpen}    onOpenChange={setMenuOpen} />
      {controlOpen && <FalkonControlCenter onClose={() => setControlOpen(false)} />}
    </>
  );
}
