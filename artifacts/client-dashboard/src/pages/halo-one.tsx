/**
 * Halo One — the client / property-manager conversational home.
 *
 * FULL PARITY update:
 * - Premium seed screen with property-name greeting & auto-loaded morning brief strip
 * - Six inline client-safe lenses (brief / unit-detail / crew-arrival / evidence /
 *   blocker / financial / map) rendered WITHOUT board navigation
 * - Intent routing: detectClientIntent() classifies input and dispatches the right card
 * - Voice input via Web Speech API (useSpeechInput hook)
 * - Conversation history hydrated from GET /client/:token/concierge/history on mount
 * - Board stays as explicit fallback (nav bar second position)
 *
 * Role safety: every PM-facing mutation goes through the existing
 * /api/client/:token/concierge endpoint with HMAC sessions.
 * Lens components ONLY fetch from /client/:token/* endpoints — no office API calls.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  useGetClientBoard,
  useDispatchClientBoardAction,
  getGetClientBoardQueryKey,
  useGetClientBriefing,
  getGetClientBriefingQueryKey,
  type ClientBoardCardView,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionExchange } from '@/hooks/useSessionExchange';
import { useToast } from '@/hooks/use-toast';
import { useBoardEvents } from '@workspace/board-ui';
import { useSpeechInput } from '@/hooks/useSpeechInput';
import {
  Mic,
  MicOff,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  LayoutGrid,
  Home,
  MessageSquare,
  Sparkles,
  Wrench,
  DollarSign,
  CheckSquare,
  FileText,
  X,
  MapPin,
  BookOpen,
  Users,
  Bell,
  Camera,
  Clock,
} from 'lucide-react';

// Lens components
import { ClientBriefCard } from '@/components/halo/ClientBriefCard';
import { UnitDetailCard } from '@/components/halo/UnitDetailCard';
import { CrewArrivalCard } from '@/components/halo/CrewArrivalCard';
import { ClientEvidenceCard } from '@/components/halo/ClientEvidenceCard';
import { UnitBlockerCard } from '@/components/halo/UnitBlockerCard';
import { ClientFinancialCard } from '@/components/halo/ClientFinancialCard';
import { ClientMapCard } from '@/components/halo/ClientMapCard';

// ─── Types ────────────────────────────────────────────────────────────────────

type Chip = { id: string; label: string; summary: string; confirmToken: string; expiresAt: string };

type ClientIntent =
  | { kind: 'brief' }
  | { kind: 'unit-detail'; label: string }
  | { kind: 'crew-arrival' }
  | { kind: 'evidence'; label?: string }
  | { kind: 'blocker'; label: string }
  | { kind: 'request-work'; label: string }
  | { kind: 'financial' }
  | { kind: 'map' }
  | { kind: 'board' }
  | { kind: 'concierge' };

type TMsg =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'thinking'; status?: string }
  | { id: string; kind: 'assistant'; text: string; chips?: Chip[] }
  | { id: string; kind: 'success'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'needs-you' }
  | { id: string; kind: 'happening-now' }
  | { id: string; kind: 'lens-brief' }
  | { id: string; kind: 'lens-unit'; label: string }
  | { id: string; kind: 'lens-crew' }
  | { id: string; kind: 'lens-evidence'; label?: string }
  | { id: string; kind: 'lens-blocker'; label: string }
  | { id: string; kind: 'lens-financial' }
  | { id: string; kind: 'lens-map' };

// ─── Module-level thread persistence ─────────────────────────────────────────

let _savedThread: TMsg[] | null = null;
let _savedToken: string | null = null;
const _hydratedFor = new Set<string>(); // prevent re-fetch on in-app navigation

// ─── Keyframes ───────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes h1Bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30%            { transform: translateY(-5px); }
}
@keyframes h1MsgIn {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes h1Ambient {
  0%, 100% { opacity: 0.20; transform: scaleY(0.55); }
  50%       { opacity: 0.55; transform: scaleY(1); }
}
@keyframes h1Glow {
  0%, 100% { opacity: 0.50; filter: drop-shadow(0 0 22px rgba(180,255,68,0.38)); }
  50%       { opacity: 0.82; filter: drop-shadow(0 0 42px rgba(180,255,68,0.68)); }
}
@keyframes h1SeedIn {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes h1Pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
@keyframes h1MicPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(228,29,72,0.35); }
  50%       { box-shadow: 0 0 0 6px rgba(228,29,72,0); }
}
@media (prefers-reduced-motion: reduce) {
  .h1-msg, .h1-seed { animation: none !important; }
  @keyframes h1Glow { 0%, 100% { opacity: 0.65; filter: none; } }
  @keyframes h1Ambient { 0%, 100% { opacity: 0.35; transform: scaleY(0.8); } }
}
`;

// ─── Ambient messages ─────────────────────────────────────────────────────────

const AMBIENT_MSGS = [
  'Monitoring active turns…',
  'Checking crew check-in status…',
  'Reviewing invoice timelines…',
  'Watching for move-in delays…',
  'Tracking unit readiness…',
  'Scanning for pending approvals…',
];

// ─── Intent detection ─────────────────────────────────────────────────────────

function detectClientIntent(input: string): ClientIntent {
  const t = input.toLowerCase().trim();

  // Board navigation explicit requests
  if (/\b(open|show|go to|see|view)\b.*\bboard\b|\bboard\b.*(open|show|view)/.test(t) ||
      t === 'board') {
    return { kind: 'board' };
  }

  // Financial
  if (/\b(spend|spent|cost|total|invoice|financial|budget|paid|outstanding|overdue|money|dollar)\b/.test(t)) {
    return { kind: 'financial' };
  }

  // Map
  if (/\b(map|location|where.*property|property.*map|show.*map)\b/.test(t)) {
    return { kind: 'map' };
  }

  // Crew arrival
  if (/\b(crew|arrived|check[\s-]?in|on[\s-]?site|there yet|show up|checked in)\b/.test(t) &&
      !/unit\s+\w+/.test(t)) {
    return { kind: 'crew-arrival' };
  }

  // Evidence / photos
  if (/\b(photo|before|after|evidence|picture|image|pic)\b/.test(t)) {
    const unitMatch = t.match(/unit\s+([a-z0-9\-]+)/i) ?? t.match(/\b([0-9]{3,4}[a-z]?)\b/);
    return { kind: 'evidence', label: unitMatch?.[1] };
  }

  // Blocker / what's preventing
  if (/\b(prevent|block|hold|delay|why.*not ready|what.*stop|barrier|obstacle|issue)\b/.test(t)) {
    const unitMatch = t.match(/unit\s+([a-z0-9\-]+)/i) ?? t.match(/\b([0-9]{3,4}[a-z]?)\b/);
    if (unitMatch) return { kind: 'blocker', label: unitMatch[1] };
  }

  // Unit detail — "show me unit 312" / "unit 312 status"
  const unitMatch = t.match(/unit\s+([a-z0-9\-]+)/i) ??
    (t.includes('show') || t.includes('status') || t.includes('what') || t.includes('tell')
      ? t.match(/\b([0-9]{3,4}[a-z]?)\b/) : null);
  if (unitMatch) {
    const label = unitMatch[1];
    // request-work sub-intent
    if (/\b(request|submit|need.*work|work.*request|fix|repair|replace)\b/.test(t)) {
      return { kind: 'request-work', label };
    }
    return { kind: 'unit-detail', label };
  }

  // Brief
  if (/\b(brief|briefing|morning|today|priority|urgent|delay|move[\s-]?in|risk)\b/.test(t)) {
    return { kind: 'brief' };
  }

  // Default: pass through to concierge
  return { kind: 'concierge' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLaneColor(lane: string): string {
  const map: Record<string, string> = {
    requested: '#6366F1', in_progress: '#3B82F6', review: '#F59E0B',
    alerts: '#E11D48', scheduled: '#22C55E', pending: '#8B5CF6',
  };
  return map[lane] ?? '#B4FF44';
}

function formatText(text: string): string {
  return text.replace(/```[a-z]*\n?/g, '').trim();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HaloRingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6a6 6 0 0 1 6 6" />
      <path d="M6 12a6 6 0 0 1 6-6" />
    </svg>
  );
}

function ThinkingBubble({ status }: { status?: string }) {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRingIcon className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-2">
        {status ? (
          <span className="text-[12px] text-white/38 italic">{status}</span>
        ) : (
          [0, 1, 2].map(i => (
            <div key={i} className="w-[5px] h-[5px] rounded-full bg-[#B4FF44]/50"
              style={{ animation: `h1Bounce 1.2s ease-in-out ${i * 0.18}s infinite` }} />
          ))
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ text, chips, onConfirm, confirmedIds }: {
  text: string; chips?: Chip[]; onConfirm: (chip: Chip) => void; confirmedIds: Set<string>;
}) {
  const formatted = formatText(text);
  if (!formatted && !chips?.length) return null;
  return (
    <div className="flex items-end gap-2 mb-3 h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <HaloRingIcon className="w-[11px] h-[11px] text-[#B4FF44]" />
      </div>
      <div className="max-w-[86%]">
        {formatted && (
          <div className="bg-[#0C1B30] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 shadow-sm">
            <p className="text-[13.5px] text-white/80 leading-relaxed whitespace-pre-wrap">{formatted}</p>
          </div>
        )}
        {chips && chips.length > 0 && (
          <div className="mt-2 space-y-2">
            {chips.map(chip => {
              const done = confirmedIds.has(chip.confirmToken);
              return (
                <div key={chip.id} className="bg-[#0A1628] border border-[#B4FF44]/18 rounded-[14px] px-3.5 py-3">
                  <div className="text-[12.5px] font-semibold text-white/80 mb-0.5">{chip.label}</div>
                  <div className="text-[11.5px] text-white/38 mb-2.5">{chip.summary}</div>
                  <button
                    onClick={() => !done && onConfirm(chip)}
                    disabled={done}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-[0.96] ${
                      done
                        ? 'bg-[#22C55E]/12 text-[#22C55E]/65 border border-[#22C55E]/18 cursor-not-allowed'
                        : 'bg-white text-[#0A0F1A] hover:bg-white/92 hover:scale-[1.02]'
                    }`}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {done ? 'Done' : 'Confirm'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end mb-3 h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="max-w-[80%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-3 shadow-[0_4px_16px_rgba(180,255,68,0.20)]">
        <p className="text-[13.5px] font-semibold leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// ─── Needs You inline summary ─────────────────────────────────────────────────

function NeedsYouInline({
  cards, token, onAsk,
}: { cards: ClientBoardCardView[]; token: string; onAsk: (text: string) => void }) {
  const dispatch = useDispatchClientBoardAction();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [acting, setActing] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const doAction = async (card: ClientBoardCardView, actionKey: string) => {
    const k = card.cardKey ?? '';
    setActing(p => ({ ...p, [k]: actionKey }));
    try {
      const r = await dispatch.mutateAsync({ token, data: { action: actionKey, cardKey: k, payload: {} } });
      if (!r.ok) { toast({ title: r.reason ?? 'Action blocked', variant: 'destructive' }); }
      else {
        setResolved(p => new Set([...p, k]));
        qc.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        toast({ title: r.message ?? 'Done' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      toast({ title: err?.data?.error ?? 'Something went wrong', variant: 'destructive' });
    } finally {
      setActing(p => { const n = { ...p }; delete n[k]; return n; });
    }
  };

  const visible = cards.filter(c => !resolved.has(c.cardKey ?? '')).slice(0, 4);
  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-3 bg-[#22C55E]/6 border border-[#22C55E]/12 rounded-[14px] px-4 py-3 mb-3">
        <CheckCircle2 className="w-[14px] h-[14px] text-[#22C55E] shrink-0" />
        <span className="text-[12.5px] font-medium text-[#22C55E]/80">You're all caught up.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 mb-3">
      {visible.map(card => {
        const k = card.cardKey ?? '';
        const primary = card.actions?.find(a => a.kind === 'primary');
        const decline = card.actions?.find(a => a.kind === 'secondary' && a.label.toLowerCase().includes('decl'));
        const laneColor = getLaneColor(card.lane ?? '');
        const isActing = !!acting[k];
        return (
          <div key={k} className="bg-[#080F1E] border border-white/7 rounded-[16px] p-4">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: laneColor }} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white/85 leading-snug">{card.title}</div>
                {card.description && (
                  <div className="text-[11.5px] text-white/40 mt-0.5 line-clamp-1">{card.description}</div>
                )}
              </div>
              {card.amount != null && card.amount > 0 && (
                <div className="text-[13px] font-bold text-white/72 tabular-nums shrink-0">${card.amount.toLocaleString()}</div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {primary && (
                <button onClick={() => doAction(card, primary.key)} disabled={isActing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#0A0F1A] text-[11.5px] font-bold hover:bg-white/92 active:scale-[0.97] transition-all disabled:opacity-50 shrink-0">
                  {isActing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {primary.label}
                </button>
              )}
              {decline && (
                <button onClick={() => doAction(card, decline.key)} disabled={isActing}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 text-white/50 text-[11.5px] font-bold hover:text-white/75 active:scale-[0.97] transition-all disabled:opacity-50 shrink-0">
                  {decline.label}
                </button>
              )}
              <button onClick={() => onAsk(`Tell me more about: ${card.title}`)}
                className="ml-auto text-[11px] text-[#B4FF44]/45 hover:text-[#B4FF44]/75 transition-colors px-2 py-1.5 rounded-lg hover:bg-[#B4FF44]/5 active:scale-[0.96] flex items-center gap-1">
                <Sparkles className="w-2.5 h-2.5" /> Ask
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Compact brief strip (seed state top item) ─────────────────────────────────

const FINANCIAL_BRIEF_CATEGORIES = new Set(['Invoices']);

function CompactBriefStrip({ token, permissions, onAsk }: { token: string; permissions: string[]; onAsk: (q: string) => void }) {
  const hasFinancialAccess = permissions.includes('invoices') || permissions.includes('financial');
  const { data, isLoading } = useGetClientBriefing(token, {
    query: { queryKey: getGetClientBriefingQueryKey(token) },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-[11px] bg-white/[0.03] border border-white/6 mb-5">
        <Loader2 className="w-3 h-3 text-[#B4FF44]/40 animate-spin shrink-0" />
        <span className="text-[11px] text-white/28">Checking for urgent items…</span>
      </div>
    );
  }

  const filtered = (data?.items ?? []).filter(
    item => hasFinancialAccess || !FINANCIAL_BRIEF_CATEGORIES.has(item.category)
  );
  const top = filtered[0];
  if (!top) return null;

  const isUrgent = top.urgency >= 75;
  const accentColor = isUrgent ? '#E11D48' : '#F59E0B';

  return (
    <button
      onClick={() => onAsk(`Tell me about: ${top.title}`)}
      className="w-full flex items-start gap-2.5 px-3 py-2.5 rounded-[12px] border mb-5 text-left hover:bg-white/[0.03] transition-colors active:scale-[0.98]"
      style={{
        background: `${accentColor}06`,
        borderColor: `${accentColor}20`,
      }}
    >
      <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
        style={{ background: accentColor, animation: isUrgent ? 'h1Pulse 1.8s ease-in-out infinite' : 'none' }} />
      <div className="flex-1 min-w-0">
        <span className="text-[11.5px] font-semibold leading-snug" style={{ color: `${accentColor}CC` }}>
          {top.title}
        </span>
        {top.body && (
          <span className="text-[10.5px] text-white/30 ml-1.5">{top.body}</span>
        )}
      </div>
      <ChevronRight className="w-3 h-3 shrink-0 mt-0.5" style={{ color: `${accentColor}50` }} />
    </button>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionLabel({ label, count, accent }: { label: string; count?: number; accent?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2.5 px-0.5">
      <span className="text-[9.5px] font-bold tracking-[0.22em] uppercase"
        style={{ color: accent ?? 'rgba(255,255,255,0.22)' }}>
        {label}
      </span>
      {count != null && count > 0 && (
        <span className="min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-bold grid place-items-center"
          style={{
            background: accent ? `${accent}15` : 'rgba(255,255,255,0.05)',
            color: accent ?? 'rgba(255,255,255,0.45)',
            border: `1px solid ${accent ? `${accent}25` : 'rgba(255,255,255,0.08)'}`,
          }}>
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Try Asking cards (client-scoped, per spec) ───────────────────────────────

type TryAskCard = {
  label: string;
  sub: string;
  icon: typeof DollarSign;
  iconColor: string;
  queryFn: (firstActiveUnit?: string) => string;
};

const CLIENT_TRY_ASKING: TryAskCard[] = [
  {
    label: "What could delay tomorrow's move-ins?",
    sub: "Move-in risk & blockers",
    icon: AlertCircle,
    iconColor: "#E11D48",
    queryFn: () => "What could delay tomorrow's move-ins?",
  },
  {
    label: "Show me a unit",
    sub: "Unit status & crew",
    icon: Home,
    iconColor: "#3B82F6",
    queryFn: (unit) => unit ? `Show me Unit ${unit}` : "Show me the status of my units",
  },
  {
    label: "Show before/after photos",
    sub: "Evidence & job progress",
    icon: Camera,
    iconColor: "#8B5CF6",
    queryFn: () => "Show me the before and after photos",
  },
  {
    label: "Has the crew arrived?",
    sub: "Active crews & check-ins",
    icon: Users,
    iconColor: "#22C55E",
    queryFn: () => "Has the crew arrived?",
  },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function HaloOne() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  useSessionExchange(token);

  // Board data
  const { data: board, isLoading, error } = useGetClientBoard(token, {
    query: { queryKey: getGetClientBoardQueryKey(token), refetchInterval: 30_000 },
  });

  useBoardEvents(token ? `/api/client/${token}/board/events` : null, () => {
    qc.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
  });

  // Thread — restored from module-level cache on in-app nav
  const [messages, setMessages] = useState<TMsg[]>(() => {
    if (_savedToken === token && _savedThread) return _savedThread;
    return [];
  });

  useEffect(() => { _savedThread = messages; _savedToken = token; }, [messages, token]);

  // Conversation history hydration from server (once per token per session)
  useEffect(() => {
    if (!token || _hydratedFor.has(token)) return;
    const sessionToken = typeof localStorage !== 'undefined'
      ? localStorage.getItem(`halo_client_session_${token}`) : null;
    if (!sessionToken) return; // guest sessions skip hydration
    _hydratedFor.add(token);

    fetch(`/api/client/${token}/concierge/history`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${sessionToken}` },
    })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then((data: { messages?: Array<{ id: string; role: string; content: string; chips?: Chip[] }> } | null) => {
        if (!data?.messages?.length) return;
        const hydrated: TMsg[] = data.messages.map(m => ({
          id: m.id,
          kind: m.role === 'user' ? 'user' : 'assistant',
          text: m.content,
          ...(m.role === 'assistant' && m.chips?.length ? { chips: m.chips } : {}),
        } as TMsg));
        setMessages(prev => {
          // Only prepend if thread is still empty (avoid clobbering user's session)
          if (prev.length > 0) return prev;
          return hydrated;
        });
      });
  }, [token]);

  // Input state
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [voiceError, setVoiceError] = useState<string | null>(null);

  // Ambient
  const [ambientIdx, setAmbientIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAmbientIdx(i => (i + 1) % AMBIENT_MSGS.length), 7000);
    return () => clearInterval(t);
  }, []);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // ─── Speech input ────────────────────────────────────────────────────────────

  const { listening, start: startListening, stop: stopListening, supported: speechSupported } = useSpeechInput({
    onResult: (transcript) => {
      setVoiceError(null);
      setInput(transcript);
      // Auto-submit after short delay so user sees the transcript
      setTimeout(() => send(transcript), 120);
    },
    onError: (msg) => {
      setVoiceError(msg);
      setTimeout(() => setVoiceError(null), 4000);
    },
  });

  const handleMicClick = useCallback(() => {
    if (listening) { stopListening(); return; }
    setVoiceError(null);
    startListening();
  }, [listening, startListening, stopListening]);

  // ─── Send message ─────────────────────────────────────────────────────────────

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);

    // Detect intent and dispatch inline lens or concierge
    const intent = detectClientIntent(msg);

    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;

    if (intent.kind === 'board') {
      setMessages(prev => [...prev, { id: uid, kind: 'user', text: msg }]);
      scrollToBottom();
      setBusy(false);
      setLocation(`/${token}/board`);
      return;
    }

    if (intent.kind !== 'concierge') {
      // Render inline lens
      let lensMsg: TMsg;
      switch (intent.kind) {
        case 'brief': lensMsg = { id: aid, kind: 'lens-brief' }; break;
        case 'unit-detail': lensMsg = { id: aid, kind: 'lens-unit', label: intent.label }; break;
        case 'crew-arrival': lensMsg = { id: aid, kind: 'lens-crew' }; break;
        case 'evidence': lensMsg = { id: aid, kind: 'lens-evidence', label: intent.label }; break;
        case 'blocker': lensMsg = { id: aid, kind: 'lens-blocker', label: intent.label }; break;
        case 'request-work': lensMsg = { id: aid, kind: 'lens-unit', label: intent.label }; break;
        case 'financial': lensMsg = { id: aid, kind: 'lens-financial' }; break;
        case 'map': lensMsg = { id: aid, kind: 'lens-map' }; break;
        default: lensMsg = { id: aid, kind: 'lens-brief' };
      }
      setMessages(prev => [...prev, { id: uid, kind: 'user', text: msg }, lensMsg]);
      scrollToBottom();
      setBusy(false);
      return;
    }

    // Concierge SSE path
    setMessages(prev => [...prev,
      { id: uid, kind: 'user', text: msg },
      { id: aid, kind: 'thinking', status: 'Thinking…' },
    ]);
    scrollToBottom();

    const update = (fn: (m: TMsg) => TMsg) =>
      setMessages(prev => prev.map(m => (m.id === aid ? fn(m) : m)));

    try {
      const sessionToken = typeof localStorage !== 'undefined'
        ? localStorage.getItem(`halo_client_session_${token}`) : null;
      const resp = await fetch(`/api/client/${token}/concierge`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ message: msg }),
      });

      if (!resp.ok || !resp.body) {
        const j = await resp.json().catch(() => null);
        update(() => ({ id: aid, kind: 'assistant', text: j?.error ?? 'Halo One is unavailable right now.' }));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      update(() => ({ id: aid, kind: 'assistant', text: '', chips: [] }));

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const raw = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const eventLine = raw.split('\n').find(l => l.startsWith('event: '));
          const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.slice(7).trim();
          let data: unknown = null;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
          const d = data as Record<string, unknown>;
          if (event === 'status') update(m => ({ ...m, kind: 'thinking', status: String(d.text) }));
          if (event === 'delta') {
            accumulated += String(d.text);
            update(m =>
              m.kind === 'thinking'
                ? { id: aid, kind: 'assistant', text: accumulated }
                : { ...(m as Extract<TMsg, { kind: 'assistant' }>), text: accumulated }
            );
          }
          if (event === 'chips') {
            update(m =>
              m.kind === 'assistant' ? { ...m, chips: (d.chips as Chip[]) } : m
            );
          }
        }
      }
      setMessages(prev => prev.map(m =>
        m.id === aid && m.kind === 'thinking'
          ? { id: aid, kind: 'assistant', text: accumulated || 'Done.' }
          : m
      ));
    } catch {
      update(() => ({ id: aid, kind: 'assistant', text: 'Connection dropped — try again.' }));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  }, [busy, token, scrollToBottom, setLocation]);

  // Confirm chip
  const handleConfirmChip = async (chip: Chip) => {
    try {
      const sessionToken = typeof localStorage !== 'undefined'
        ? localStorage.getItem(`halo_client_session_${token}`) : null;
      const resp = await fetch(`/api/client/${token}/concierge/confirm`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ confirmToken: chip.confirmToken }),
      });
      const data = await resp.json();
      setConfirmedIds(prev => new Set([...prev, chip.confirmToken]));
      setMessages(prev => [...prev,
        { id: `sys-${Date.now()}`, kind: data.ok ? 'success' : 'error', text: data.message },
      ]);
      qc.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    } catch {
      toast({ title: 'Confirmation expired — ask Halo One again', variant: 'destructive' });
    }
  };

  // Derived
  const cards = board?.cards ?? [];
  const needsYouCards = cards.filter(c => c.needsAction);
  const happeningCards = cards.filter(c => !c.needsAction && c.lane && c.lane !== 'done');
  const propertyName = board?.propertyName ?? 'Your Property';
  const logoUrl = board?.logoUrl;
  const unreadMessages = board?.unreadMessages ?? 0;
  const permissions = board?.viewer?.permissions ?? [];

  // First active unit for dynamic seed card label
  const firstActiveUnit = cards.find(c => c.unitNo && c.lane !== 'done')?.unitNo ?? undefined;

  const hasThread = messages.some(m => m.kind === 'user');

  // ─── Render messages ──────────────────────────────────────────────────────────

  const renderMsg = (msg: TMsg): React.ReactNode => {
    switch (msg.kind) {
      case 'needs-you':
        return (
          <div className="mb-4">
            <SectionLabel label="Needs You" count={needsYouCards.length} accent={needsYouCards.length > 0 ? '#E11D48' : undefined} />
            <NeedsYouInline cards={needsYouCards} token={token} onAsk={text => { setInput(text); send(text); }} />
          </div>
        );
      case 'user': return <UserBubble text={msg.text} />;
      case 'thinking': return <ThinkingBubble status={msg.status} />;
      case 'assistant':
        return <AssistantBubble text={msg.text} chips={msg.chips} onConfirm={handleConfirmChip} confirmedIds={confirmedIds} />;
      case 'success':
        return (
          <div className="flex items-center gap-2.5 bg-[#22C55E]/8 border border-[#22C55E]/18 rounded-[13px] px-4 py-3 mb-3 h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
            <CheckCircle2 className="w-4 h-4 text-[#22C55E] shrink-0" />
            <span className="text-[13px] text-[#22C55E]/85">{msg.text}</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2.5 bg-[#E11D48]/8 border border-[#E11D48]/18 rounded-[13px] px-4 py-3 mb-3 h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
            <AlertCircle className="w-4 h-4 text-[#E11D48] shrink-0" />
            <span className="text-[13px] text-[#E11D48]/85">{msg.text}</span>
          </div>
        );
      // ── Lens messages ────────────────────────────────────────────────────────
      case 'lens-brief':
        return <ClientBriefCard token={token} topN={5} permissions={permissions} onAsk={q => send(q)} />;
      case 'lens-unit':
        return (
          <UnitDetailCard
            unitLabel={msg.label}
            cards={cards}
            token={token}
            permissions={permissions}
          />
        );
      case 'lens-crew':
        return <CrewArrivalCard cards={cards} />;
      case 'lens-evidence':
        return <ClientEvidenceCard unitLabel={msg.label} cards={cards} />;
      case 'lens-blocker':
        return <UnitBlockerCard unitLabel={msg.label} cards={cards} token={token} permissions={permissions} onAsk={q => send(q)} />;
      case 'lens-financial':
        return <ClientFinancialCard token={token} permissions={permissions} />;
      case 'lens-map':
        return (
          <ClientMapCard
            token={token}
            permissions={permissions}
            onNavigateMap={() => setLocation(`/${token}/map`)}
          />
        );
      default: return null;
    }
  };

  // ─── Loading / Error ──────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <>
        <style>{KEYFRAMES}</style>
        <div className="min-h-[100dvh] bg-[#070C16] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 rounded-2xl bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center"
              style={{ animation: 'h1Glow 3s ease-in-out infinite' }}>
              <HaloRingIcon className="w-5 h-5 text-[#B4FF44]" />
            </div>
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#B4FF44]/40"
                  style={{ animation: `h1Bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
              ))}
            </div>
            <span className="text-[10px] font-bold tracking-[0.24em] uppercase text-white/22">Halo One</span>
          </div>
        </div>
      </>
    );
  }

  if (error || !board) {
    return (
      <>
        <style>{KEYFRAMES}</style>
        <div className="min-h-[100dvh] bg-[#070C16] flex items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <AlertCircle className="w-8 h-8 text-[#E11D48] mx-auto mb-4" />
            <div className="text-[18px] font-bold text-white mb-2">Invalid or expired link</div>
            <div className="text-[13px] text-white/38 leading-relaxed">Contact your property management team for a new link.</div>
          </div>
        </div>
      </>
    );
  }

  const h = new Date().getHours();
  const timeGreet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{KEYFRAMES}</style>

      <div className="min-h-[100dvh] h-[100dvh] bg-[#070C16] flex flex-col overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-2.5 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-3 shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-5 object-contain shrink-0" />
          ) : (
            <div className="flex items-center gap-1.5">
              <HaloRingIcon className="w-4 h-4 text-[#B4FF44]/70" />
              <span className="text-[12px] font-bold tracking-[0.04em] text-white/85">Halo One</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-[11.5px] font-medium text-white/38 truncate">{propertyName}</div>
          </div>

          {unreadMessages > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E11D48]/10 border border-[#E11D48]/18 shrink-0">
              <Bell className="w-3 h-3 text-[#E11D48]" />
              <span className="text-[10px] font-bold text-[#E11D48]/85">{unreadMessages}</span>
            </div>
          )}

          <button
            onClick={() => setLocation(`/${token}/board`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/8 text-[10.5px] font-bold text-white/38 hover:text-white/65 hover:bg-white/8 transition-all active:scale-[0.95] shrink-0"
          >
            <LayoutGrid className="w-3 h-3" />
            <span className="hidden sm:inline">Board</span>
          </button>
        </header>

        {/* ── Content ─────────────────────────────────────────────────────── */}
        {!hasThread ? (
          /* ─── SEED STATE ──────────────────────────────────────────────── */
          <div className="flex-1 flex flex-col items-center justify-center px-5 pb-2 overflow-y-auto">
            {/* Glowing ring */}
            <div className="mb-5 h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.05s both' }}>
              <div className="w-[64px] h-[64px] rounded-full bg-[#B4FF44]/7 border border-[#B4FF44]/18 grid place-items-center"
                style={{ animation: 'h1Glow 3.5s ease-in-out infinite' }}>
                <HaloRingIcon className="w-[28px] h-[28px] text-[#B4FF44]" />
              </div>
            </div>

            {/* Greeting with property name */}
            <div className="text-center mb-4 h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.12s both' }}>
              <h1 className="text-[30px] font-bold text-white leading-none tracking-[-0.02em] mb-1.5">
                {timeGreet}.
              </h1>
              <p className="text-[13px] text-[#B4FF44]/60 font-semibold truncate max-w-[260px]">{propertyName}</p>
              {needsYouCards.length > 0 ? (
                <p className="text-[12.5px] text-white/35 font-medium mt-1">
                  {needsYouCards.length} decision{needsYouCards.length !== 1 ? 's' : ''} waiting for you.
                </p>
              ) : (
                <p className="text-[12.5px] text-white/35 font-medium mt-1">Your property command center.</p>
              )}
            </div>

            {/* Compact brief strip — top urgent item */}
            <div className="w-full max-w-sm h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.17s both' }}>
              <CompactBriefStrip token={token} permissions={permissions} onAsk={q => send(q)} />
            </div>

            {/* Status chips */}
            <div className="flex items-center gap-2 mb-6 flex-wrap justify-center h1-seed"
              style={{ animation: 'h1SeedIn 0.5s ease-out 0.20s both' }}>
              {needsYouCards.length > 0 ? (
                <div className="flex items-center gap-1.5 bg-[#E11D48]/8 border border-[#E11D48]/16 rounded-full px-3 py-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48]" style={{ animation: 'h1Pulse 1.8s ease-in-out infinite' }} />
                  <span className="text-[10.5px] font-bold text-[#E11D48]/80">{needsYouCards.length} need{needsYouCards.length !== 1 ? '' : 's'} you</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 bg-[#22C55E]/7 border border-[#22C55E]/14 rounded-full px-3 py-1.5">
                  <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
                  <span className="text-[10.5px] font-bold text-[#22C55E]/78">All clear</span>
                </div>
              )}
              {happeningCards.length > 0 && (
                <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-full px-3 py-1.5">
                  <span className="text-[10.5px] font-medium text-white/38">{happeningCards.length} active</span>
                </div>
              )}
            </div>

            {/* Big command input */}
            <div className="w-full max-w-sm mb-5 h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.24s both' }}>
              <div className="relative flex items-center bg-white/[0.048] border border-white/10 rounded-[18px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.30)] hover:border-white/15 transition-all focus-within:border-[#B4FF44]/30 focus-within:bg-white/[0.062]">
                <Sparkles className="ml-4 w-[13px] h-[13px] text-[#B4FF44]/35 shrink-0 pointer-events-none" />
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) send(input); } }}
                  placeholder="Ask Halo One anything…"
                  className="flex-1 h-[54px] bg-transparent px-3 text-[14px] text-white placeholder:text-white/20 focus:outline-none"
                />
                {/* Mic button */}
                {speechSupported && (
                  <button
                    onClick={handleMicClick}
                    aria-label="Start voice input"
                    className={`mr-1.5 w-8 h-8 rounded-full grid place-items-center transition-all active:scale-[0.94] shrink-0 ${
                      listening
                        ? 'bg-[#E11D48] text-white'
                        : 'bg-white/8 text-white/40 hover:bg-white/12 hover:text-white/65'
                    }`}
                    style={listening ? { animation: 'h1MicPulse 1s ease-in-out infinite' } : undefined}
                  >
                    {listening ? <MicOff className="w-[13px] h-[13px]" /> : <Mic className="w-[13px] h-[13px]" />}
                  </button>
                )}
                <button
                  onClick={() => { if (input.trim()) send(input); }}
                  disabled={!input.trim() || busy}
                  aria-label="Send message"
                  className="mr-3 w-9 h-9 rounded-full grid place-items-center bg-white text-[#0A0F1A] shadow-[0_2px_12px_rgba(255,255,255,0.14)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-32 disabled:scale-100 shrink-0"
                >
                  {busy ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <ChevronRight className="w-[15px] h-[15px]" strokeWidth={2.5} />}
                </button>
              </div>
              {/* Voice error */}
              {voiceError && (
                <div className="mt-1.5 text-[11px] text-[#E11D48]/70 text-center">{voiceError}</div>
              )}
            </div>

            {/* Try Asking */}
            <div className="w-full max-w-sm h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.30s both' }}>
              <div className="text-[9.5px] font-bold tracking-[0.22em] uppercase text-white/20 mb-3 text-center">
                Try Asking
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {CLIENT_TRY_ASKING.map(card => {
                  const Icon = card.icon;
                  const queryText = card.queryFn(firstActiveUnit);
                  return (
                    <button key={card.label} onClick={() => send(queryText)}
                      className="flex flex-col items-start gap-2.5 p-4 rounded-[16px] bg-white/[0.035] border border-white/7 text-left hover:bg-white/[0.055] hover:border-white/12 transition-all active:scale-[0.97]">
                      <div className="w-7 h-7 rounded-[9px] grid place-items-center"
                        style={{ background: `${card.iconColor}12`, border: `1px solid ${card.iconColor}22` }}>
                        <Icon className="w-3.5 h-3.5" style={{ color: card.iconColor }} />
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold text-white/55 leading-snug">{card.label}</div>
                        <div className="text-[10.5px] text-white/22 mt-0.5 leading-snug">{card.sub}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* ─── THREAD STATE ───────────────────────────────────────────── */
          <>
            {/* Decision inbox if there's activity */}
            {needsYouCards.length > 0 && messages.length === 1 && (
              <div className="px-4 pt-3 pb-0 shrink-0">
                <SectionLabel label="Needs You" count={needsYouCards.length} accent="#E11D48" />
                <NeedsYouInline cards={needsYouCards.slice(0, 2)} token={token}
                  onAsk={t => { setInput(t); send(t); }} />
              </div>
            )}

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 overscroll-none" aria-live="polite" aria-atomic="false">
              {messages.map(msg => (
                <div key={msg.id} className="h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
                  {renderMsg(msg)}
                </div>
              ))}

              {/* Follow-up suggestions */}
              {messages.length > 0 && messages[messages.length - 1]?.kind !== 'thinking' && (
                <div className="flex gap-2 flex-wrap mt-2 mb-1">
                  {["What could delay move-ins?", "Has the crew arrived?", "Show before/after photos", "What's the spend?"].map(p => (
                    <button key={p} onClick={() => send(p)}
                      className="text-[11px] font-medium text-white/30 px-3 py-1.5 rounded-full bg-white/[0.025] border border-white/5 hover:text-white/55 hover:bg-white/[0.045] transition-all active:scale-[0.96]">
                      {p}
                    </button>
                  ))}
                </div>
              )}
              <div ref={bottomRef} className="h-3" />
            </div>

            {/* Ambient */}
            <div className="px-4 py-1.5 flex items-center gap-2.5 border-t border-white/[0.04] shrink-0">
              <div className="flex gap-[3px] shrink-0">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-[3px] h-[9px] rounded-full bg-[#B4FF44]"
                    style={{ animation: `h1Ambient 2.2s ease-in-out ${i * 0.35}s infinite` }} />
                ))}
              </div>
              <span className="text-[10.5px] text-white/20 font-medium flex-1 truncate">{AMBIENT_MSGS[ambientIdx]}</span>
              <button onClick={() => setMessages([])}
                className="flex items-center gap-1 text-[10px] text-white/16 hover:text-white/40 transition-colors px-1.5 py-1 rounded-md hover:bg-white/5">
                <X className="w-2.5 h-2.5" /> New chat
              </button>
            </div>

            {/* Command bar */}
            <div className="px-4 pt-2.5 pb-2 shrink-0 bg-[#070C16] border-t border-white/[0.05]">
              {/* Voice error */}
              {voiceError && (
                <div className="mb-1.5 text-[11px] text-[#E11D48]/70 text-center">{voiceError}</div>
              )}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[#B4FF44]/35 pointer-events-none" />
                  <input value={input} onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) send(input); } }}
                    placeholder="Ask Halo One anything…"
                    disabled={busy}
                    className="w-full h-11 rounded-full bg-white/5 border border-white/8 pl-[30px] pr-4 text-[13.5px] text-white placeholder:text-white/22 focus:outline-none focus:border-[#B4FF44]/32 focus:ring-1 focus:ring-[#B4FF44]/10 disabled:opacity-50 transition-all"
                  />
                </div>
                {/* Mic button */}
                {speechSupported && (
                  <button
                    onClick={handleMicClick}
                    aria-label="Start voice input"
                    disabled={busy}
                    className={`w-11 h-11 rounded-full grid place-items-center transition-all active:scale-[0.94] disabled:opacity-50 shrink-0 ${
                      listening
                        ? 'bg-[#E11D48] text-white'
                        : 'bg-white/5 border border-white/8 text-white/40 hover:text-white/65 hover:bg-white/8'
                    }`}
                    style={listening ? { animation: 'h1MicPulse 1s ease-in-out infinite' } : undefined}
                  >
                    {listening ? <MicOff className="w-[14px] h-[14px]" /> : <Mic className="w-[14px] h-[14px]" />}
                  </button>
                )}
                <button onClick={() => { if (input.trim()) send(input); }} disabled={!input.trim() || busy}
                  className="w-11 h-11 rounded-full bg-white grid place-items-center text-[#0A0F1A] shadow-[0_2px_12px_rgba(255,255,255,0.14)] hover:bg-white/92 active:scale-[0.94] transition-all disabled:opacity-38 disabled:scale-100 shrink-0">
                  {busy ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Send className="w-[14px] h-[14px]" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Bottom nav: Chat | Board | [Map] | [Hub] ─────────────────── */}
        <div className="shrink-0 flex items-center border-t border-white/[0.05] bg-[#070C16] pb-[env(safe-area-inset-bottom)]">
          <button className="flex-1 flex flex-col items-center gap-1 py-2.5 text-[#B4FF44]">
            <div className="relative">
              <MessageSquare className="w-[17px] h-[17px]" strokeWidth={2} />
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#B4FF44]" />
            </div>
            <span className="text-[9.5px] font-bold tracking-[0.06em]">Chat</span>
          </button>
          <div className="w-px h-8 bg-white/[0.06]" />
          <button onClick={() => setLocation(`/${token}/board`)}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 text-white/28 hover:text-white/55 transition-colors active:scale-[0.95]">
            <LayoutGrid className="w-[17px] h-[17px]" strokeWidth={1.9} />
            <span className="text-[9.5px] font-medium tracking-[0.06em]">Board</span>
          </button>
          {permissions.includes('unit_map') && (
            <>
              <div className="w-px h-8 bg-white/[0.06]" />
              <button onClick={() => setLocation(`/${token}/map`)}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 text-white/28 hover:text-white/55 transition-colors active:scale-[0.95]">
                <MapPin className="w-[17px] h-[17px]" strokeWidth={1.9} />
                <span className="text-[9.5px] font-medium tracking-[0.06em]">Map</span>
              </button>
            </>
          )}
          {permissions.includes('hub') && (
            <>
              <div className="w-px h-8 bg-white/[0.06]" />
              <button onClick={() => setLocation(`/${token}/hub`)}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 text-white/28 hover:text-white/55 transition-colors active:scale-[0.95]">
                <BookOpen className="w-[17px] h-[17px]" strokeWidth={1.9} />
                <span className="text-[9.5px] font-medium tracking-[0.06em]">Hub</span>
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
