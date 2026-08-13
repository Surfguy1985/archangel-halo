/**
 * Halo One — the property-manager-first conversational home.
 *
 * This is the default landing screen for every PM client link. It surfaces:
 *   1. Property scope and health at a glance
 *   2. "Needs You" — only the human decisions that actually require the PM
 *   3. "Happening Now" — a calm operational pulse of active work
 *   4. An inline conversational command bar powered by the existing Concierge
 *
 * All existing board, unit, map, hub, and team views remain fully intact as
 * deep-link expert views reachable from the nav rail below. Nothing is removed.
 *
 * Design: dark navy, #B4FF44 lime accent, Apple-caliber typography/spacing.
 * Thread persists at module level across navigation back from detail views.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useParams } from 'wouter';
import {
  useGetClientBoard,
  useDispatchClientBoardAction,
  getGetClientBoardQueryKey,
  getGetClientPmBoardQueryKey,
  type ClientBoardCardView,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useSessionExchange } from '@/hooks/useSessionExchange';
import { useToast } from '@/hooks/use-toast';
import { useBoardEvents } from '@workspace/board-ui';
import {
  Mic,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  LayoutGrid,
  MapPin,
  BookOpen,
  Users,
  Footprints,
  Activity,
  Bell,
  X,
  Check,
  Sparkles,
  DollarSign,
  Wrench,
  Home,
  FileText,
  Clock,
  TriangleAlert,
  ArrowRight,
  Shield,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Chip = { id: string; label: string; summary: string; confirmToken: string; expiresAt: string };

type TMsg =
  | { id: string; kind: 'greeting' }
  | { id: string; kind: 'needs-you' }
  | { id: string; kind: 'happening-now' }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'thinking'; status?: string }
  | { id: string; kind: 'assistant'; text: string; chips?: Chip[] }
  | { id: string; kind: 'success'; text: string }
  | { id: string; kind: 'error'; text: string };

// Module-level thread persistence — survives navigation to detail views
let _savedThread: TMsg[] | null = null;
let _savedToken: string | null = null;

// ─── Animations ───────────────────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes h1MsgIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes h1Bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30%            { transform: translateY(-5px); }
}
@keyframes h1Ambient {
  0%, 100% { opacity: 0.20; transform: scaleY(0.55); }
  50%       { opacity: 0.52; transform: scaleY(1); }
}
@keyframes h1Pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}
@media (prefers-reduced-motion: reduce) {
  .h1-msg { animation: none !important; }
}
`;

const AMBIENT_MSGS = [
  'Monitoring active turns…',
  'Checking crew check-in status…',
  'Reviewing invoice timelines…',
  'Syncing Falkon vendor network…',
  'Tracking unit readiness…',
  'Watching for move-in delays…',
];

const PM_PROMPTS = [
  "Show my turns",
  "Who's on site?",
  "What am I approving today?",
  "What could delay tomorrow's move-ins?",
  "Is there a risk to any units this week?",
  "I need an HVAC tech here today",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getLaneLabel(lane: string): string {
  const map: Record<string, string> = {
    requested: 'Requested',
    in_progress: 'In Progress',
    review: 'Under Review',
    alerts: 'Alert',
    done: 'Done',
    scheduled: 'Scheduled',
    pending: 'Pending',
  };
  return map[lane] ?? lane.replace(/_/g, ' ');
}

function getLaneColor(lane: string): string {
  const map: Record<string, string> = {
    requested: '#6366F1',
    in_progress: '#3B82F6',
    review: '#F59E0B',
    alerts: '#E11D48',
    scheduled: '#22C55E',
    pending: '#8B5CF6',
  };
  return map[lane] ?? '#B4FF44';
}

function getCardIcon(card: ClientBoardCardView) {
  const key = card.cardKey ?? '';
  const cat = (card.category ?? '').toLowerCase();
  if (key.includes('invoice') || cat === 'invoice') return DollarSign;
  if (key.includes('work') || key.includes('request') || cat === 'request') return Wrench;
  if (key.includes('job') || cat === 'job') return Home;
  if (key.includes('walk')) return Footprints;
  return FileText;
}

function getCardIconColor(card: ClientBoardCardView): string {
  const key = card.cardKey ?? '';
  const cat = (card.category ?? '').toLowerCase();
  if (key.includes('invoice') || cat === 'invoice') return '#B4FF44';
  if (key.includes('work') || key.includes('request')) return '#6366F1';
  if (key.includes('job')) return '#3B82F6';
  if (key.includes('walk')) return '#22C55E';
  return '#F59E0B';
}

// Format assistant SSE text — strip ``` code fences, trim leading/trailing.
function formatAssistantText(text: string): string {
  return text.replace(/```[a-z]*\n?/g, '').trim();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ThinkingBubble({ status }: { status?: string }) {
  return (
    <div className="flex items-end gap-2 mb-3">
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <Sparkles className="w-[10px] h-[10px] text-[#B4FF44]" />
      </div>
      <div className="bg-[#0D1E33] border border-white/7 rounded-[16px] rounded-bl-[4px] px-4 py-3 flex items-center gap-2">
        {status ? (
          <span className="text-[12px] text-white/40 italic">{status}</span>
        ) : (
          [0, 1, 2].map(i => (
            <div
              key={i}
              className="w-[5px] h-[5px] rounded-full bg-[#B4FF44]/50"
              style={{ animation: `h1Bounce 1.2s ease-in-out ${i * 0.18}s infinite` }}
            />
          ))
        )}
      </div>
    </div>
  );
}

function AssistantBubble({ text, chips, onConfirm, confirmedIds }: {
  text: string;
  chips?: Chip[];
  onConfirm: (chip: Chip) => void;
  confirmedIds: Set<string>;
}) {
  const formatted = formatAssistantText(text);
  if (!formatted && !chips?.length) return null;
  return (
    <div className="flex items-end gap-2 mb-3 h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="w-[22px] h-[22px] rounded-full bg-[#B4FF44]/12 border border-[#B4FF44]/25 grid place-items-center shrink-0">
        <Sparkles className="w-[10px] h-[10px] text-[#B4FF44]" />
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
                  <div className="text-[11.5px] text-white/40 mb-2.5">{chip.summary}</div>
                  <button
                    onClick={() => !done && onConfirm(chip)}
                    disabled={done}
                    className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[12px] font-bold transition-all active:scale-[0.96] ${
                      done
                        ? 'bg-[#22C55E]/15 text-[#22C55E]/70 border border-[#22C55E]/20 cursor-not-allowed'
                        : 'bg-[#B4FF44] text-[#07101E] hover:scale-[1.02]'
                    }`}
                  >
                    <Check className="w-3 h-3" strokeWidth={3} />
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
      <div className="max-w-[80%] bg-[#B4FF44] text-[#07101E] rounded-[16px] rounded-br-[4px] px-4 py-3 shadow-[0_4px_14px_rgba(180,255,68,0.20)]">
        <p className="text-[13.5px] font-semibold leading-relaxed">{text}</p>
      </div>
    </div>
  );
}

// ─── Needs You Section ────────────────────────────────────────────────────────

function NeedsYouSection({
  cards,
  token,
  onResolved,
  onAskHalo,
}: {
  cards: ClientBoardCardView[];
  token: string;
  onResolved: () => void;
  onAskHalo: (context: string) => void;
}) {
  const dispatch = useDispatchClientBoardAction();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [acting, setActing] = useState<Record<string, string>>({});
  const [resolved, setResolved] = useState<Set<string>>(new Set());

  const doAction = async (card: ClientBoardCardView, actionKey: string) => {
    const cKey = card.cardKey ?? '';
    setActing(p => ({ ...p, [cKey]: actionKey }));
    try {
      const result = await dispatch.mutateAsync({
        token,
        data: { action: actionKey, cardKey: cKey, payload: {} },
      });
      if (!result.ok) {
        toast({ title: result.reason ?? result.message ?? 'Action blocked', variant: 'destructive' });
      } else {
        setResolved(p => new Set([...p, cKey]));
        qc.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
        qc.invalidateQueries({ queryKey: getGetClientPmBoardQueryKey(token) });
        onResolved();
        toast({ title: result.message ?? 'Done' });
      }
    } catch (err: any) {
      toast({ title: err?.data?.error ?? 'Something went wrong', variant: 'destructive' });
    } finally {
      setActing(p => { const n = { ...p }; delete n[cKey]; return n; });
    }
  };

  const visible = cards.filter(c => !resolved.has(c.cardKey ?? ''));

  if (visible.length === 0) {
    return (
      <div className="flex items-center gap-3 bg-[#22C55E]/6 border border-[#22C55E]/12 rounded-[16px] px-4 py-4 mb-3">
        <CheckCircle2 className="w-[15px] h-[15px] text-[#22C55E] shrink-0" />
        <div>
          <div className="text-[13px] font-semibold text-[#22C55E]/80">You're caught up.</div>
          <div className="text-[11.5px] text-white/30 mt-0.5">
            Halo One will surface anything that needs a decision.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      {visible.slice(0, 6).map(card => {
        const Icon = getCardIcon(card);
        const iconColor = getCardIconColor(card);
        const cKey = card.cardKey ?? '';
        const primaryAction = card.actions?.find(a => a.kind === 'primary');
        const secondaryAction = card.actions?.find(a =>
          a.kind === 'secondary' && a.label.toLowerCase().includes('decline')
        );
        const isActing = !!acting[cKey];

        return (
          <div
            key={cKey}
            className="bg-[#080F1E] border border-white/7 rounded-[18px] p-4"
          >
            {/* Card header */}
            <div className="flex items-start gap-3 mb-3">
              <div
                className="w-8 h-8 rounded-[10px] grid place-items-center shrink-0 mt-0.5"
                style={{ background: `${iconColor}12`, border: `1px solid ${iconColor}22` }}
              >
                <Icon className="w-4 h-4" style={{ color: iconColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-white/88 leading-snug">{card.title}</div>
                {card.description && (
                  <div className="text-[12px] text-white/42 mt-1 leading-snug line-clamp-2">{card.description}</div>
                )}
              </div>
              {card.amount != null && card.amount > 0 && (
                <div className="text-[14px] font-bold text-white/75 tabular-nums shrink-0">
                  ${card.amount.toLocaleString()}
                </div>
              )}
            </div>

            {/* Lane + due info */}
            <div className="flex items-center gap-2 mb-3.5">
              <div
                className="text-[9.5px] font-bold tracking-[0.14em] uppercase px-2 py-0.5 rounded-full"
                style={{
                  background: `${getLaneColor(card.lane ?? '')}12`,
                  color: getLaneColor(card.lane ?? ''),
                  border: `1px solid ${getLaneColor(card.lane ?? '')}22`,
                }}
              >
                {getLaneLabel(card.lane ?? '')}
              </div>
              {card.dueOn && (
                <div className="flex items-center gap-1 text-[10.5px] text-white/30">
                  <Clock className="w-2.5 h-2.5" />
                  Due {card.dueOn}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {primaryAction && (
                <button
                  onClick={() => doAction(card, primaryAction.key)}
                  disabled={isActing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#B4FF44] text-[#07101E] text-[12.5px] font-bold hover:scale-[1.02] active:scale-[0.97] transition-transform disabled:opacity-50 shrink-0"
                >
                  {isActing && acting[cKey] === primaryAction.key ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" strokeWidth={2.5} />
                  )}
                  {primaryAction.label}
                </button>
              )}
              {secondaryAction && (
                <button
                  onClick={() => doAction(card, secondaryAction.key)}
                  disabled={isActing}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/55 text-[12.5px] font-bold hover:text-white/80 hover:bg-white/8 active:scale-[0.97] transition-all disabled:opacity-50 shrink-0"
                >
                  {isActing && acting[cKey] === secondaryAction.key ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  {secondaryAction.label}
                </button>
              )}
              <button
                onClick={() => onAskHalo(`Tell me more about: ${card.title}`)}
                className="ml-auto flex items-center gap-1 text-[11.5px] text-[#B4FF44]/50 hover:text-[#B4FF44]/80 transition-colors px-2 py-1.5 rounded-lg hover:bg-[#B4FF44]/5 active:scale-[0.96]"
              >
                <Sparkles className="w-3 h-3" />
                Ask Halo
              </button>
            </div>
          </div>
        );
      })}
      {visible.length > 6 && (
        <div className="text-center text-[11.5px] text-white/30 py-1">
          +{visible.length - 6} more — open the Board for full detail
        </div>
      )}
    </div>
  );
}

// ─── Happening Now ────────────────────────────────────────────────────────────

function HappeningNowStrip({
  cards,
  onNavigate,
}: {
  cards: ClientBoardCardView[];
  onNavigate: (path: string) => void;
}) {
  // Active, non-done, non-needs-action cards = operational pulse
  const active = cards.filter(c =>
    c.lane && c.lane !== 'done' && !c.needsAction
  );

  const byLane = active.reduce<Record<string, ClientBoardCardView[]>>((acc, c) => {
    const l = c.lane ?? 'other';
    if (!acc[l]) acc[l] = [];
    acc[l].push(c);
    return acc;
  }, {});

  const groups = Object.entries(byLane)
    .filter(([, cs]) => cs.length > 0)
    .sort(([a], [b]) => {
      const order = ['in_progress', 'scheduled', 'review', 'requested', 'alerts'];
      return (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99);
    });

  if (groups.length === 0) {
    return (
      <div className="flex items-center gap-2.5 bg-white/[0.025] border border-white/5 rounded-[14px] px-4 py-3.5 mb-3">
        <Activity className="w-3.5 h-3.5 text-white/22 shrink-0" />
        <span className="text-[12.5px] text-white/30">No active operations right now.</span>
      </div>
    );
  }

  return (
    <div className="space-y-2 mb-3">
      {groups.map(([lane, cs]) => {
        const color = getLaneColor(lane);
        const label = getLaneLabel(lane);
        return (
          <div
            key={lane}
            onClick={() => onNavigate('/board')}
            className="flex items-center gap-3 bg-white/[0.028] border border-white/5 rounded-[13px] px-3.5 py-3 cursor-pointer hover:bg-white/[0.042] transition-colors active:scale-[0.98]"
          >
            <div
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: color, boxShadow: `0 0 6px ${color}66` }}
            />
            <div className="flex-1 min-w-0">
              <span className="text-[12.5px] text-white/72 font-medium">
                {cs.length} {cs.length === 1 ? 'item' : 'items'} — {label}
              </span>
              {cs.length <= 2 && (
                <div className="text-[11px] text-white/30 truncate mt-0.5">
                  {cs.map(c => c.title).join(' · ')}
                </div>
              )}
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-white/18 shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  label,
  count,
  accent,
}: {
  icon: typeof Activity;
  label: string;
  count?: number;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5 px-0.5">
      <Icon className="w-3 h-3" style={{ color: accent ?? 'rgba(255,255,255,0.25)' }} />
      <span
        className="text-[9.5px] font-bold tracking-[0.2em] uppercase"
        style={{ color: accent ?? 'rgba(255,255,255,0.25)' }}
      >
        {label}
      </span>
      {count != null && count > 0 && (
        <span
          className="ml-1 min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-bold grid place-items-center"
          style={{
            background: accent ? `${accent}18` : 'rgba(255,255,255,0.06)',
            color: accent ?? 'rgba(255,255,255,0.5)',
            border: `1px solid ${accent ? `${accent}28` : 'rgba(255,255,255,0.08)'}`,
          }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Greeting Card ────────────────────────────────────────────────────────────

function GreetingCard({
  propertyName,
  needsYouCount,
  happeningCount,
}: {
  propertyName: string;
  needsYouCount: number;
  happeningCount: number;
}) {
  const h = new Date().getHours();
  const greeting =
    h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="relative overflow-hidden bg-[linear-gradient(150deg,#0D1E35_0%,#060D18_100%)] rounded-[22px] p-5 mb-4 border border-white/6 shadow-[0_16px_48px_rgba(0,0,0,0.4)]">
      {/* Ambient glow */}
      <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-[#B4FF44] opacity-[0.06] blur-[50px] pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-28 h-20 rounded-full bg-[#3B82F6] opacity-[0.03] blur-[40px] pointer-events-none" />

      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-[13px] h-[13px] text-[#B4FF44]/60" />
          <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-[#B4FF44]/55">
            Halo One
          </span>
        </div>

        <div className="text-[22px] font-bold text-white leading-tight tracking-[-0.01em] mb-1">
          {greeting}.
        </div>
        <div className="text-[13px] text-white/45 font-medium mb-4">{propertyName}</div>

        <div className="flex items-center gap-2 flex-wrap">
          {needsYouCount > 0 ? (
            <div className="flex items-center gap-1.5 bg-[#E11D48]/10 border border-[#E11D48]/18 rounded-full px-3 py-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-[#E11D48]" style={{ animation: 'h1Pulse 1.8s ease-in-out infinite' }} />
              <span className="text-[11px] font-bold text-[#E11D48]/85">
                {needsYouCount} need{needsYouCount !== 1 ? '' : 's'} you
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-[#22C55E]/8 border border-[#22C55E]/15 rounded-full px-3 py-1.5">
              <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
              <span className="text-[11px] font-bold text-[#22C55E]/80">All clear</span>
            </div>
          )}
          {happeningCount > 0 && (
            <div className="flex items-center gap-1.5 bg-white/5 border border-white/8 rounded-full px-3 py-1.5">
              <Activity className="w-3 h-3 text-white/45" />
              <span className="text-[11px] font-medium text-white/45">
                {happeningCount} active
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function HaloOne() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();

  // Session exchange (required for mutations)
  useSessionExchange(token);

  // ── Board data ─────────────────────────────────────────────────────────────
  const { data: board, isLoading, error } = useGetClientBoard(token, {
    query: {
      queryKey: getGetClientBoardQueryKey(token),
      refetchInterval: 30_000,
    },
  });

  // Live updates via SSE
  useBoardEvents(token ? `/api/client/${token}/board/events` : null, () => {
    qc.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
  });

  // ── Thread state ───────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<TMsg[]>(() => {
    if (_savedToken === token && _savedThread) return _savedThread;
    return [
      { id: 'greeting', kind: 'greeting' },
      { id: 'needs-you', kind: 'needs-you' },
      { id: 'happening', kind: 'happening-now' },
    ];
  });

  useEffect(() => {
    _savedThread = messages;
    _savedToken = token;
  }, [messages, token]);

  // ── Input ──────────────────────────────────────────────────────────────────
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  // ── Ambient ────────────────────────────────────────────────────────────────
  const [ambientIdx, setAmbientIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setAmbientIdx(i => (i + 1) % AMBIENT_MSGS.length), 7000);
    return () => clearInterval(t);
  }, []);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 80);
  }, []);

  // ── Send a message to the concierge ───────────────────────────────────────
  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);

    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      { id: uid, kind: 'user', text: msg },
      { id: aid, kind: 'thinking', status: 'Thinking…' },
    ]);
    scrollToBottom();

    const update = (fn: (m: TMsg) => TMsg) =>
      setMessages(prev => prev.map(m => (m.id === aid ? fn(m) : m)));

    try {
      const sessionToken =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(`halo_client_session_${token}`)
          : null;
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
        update(() => ({
          id: aid,
          kind: 'assistant',
          text: j?.error ?? 'Halo One is unavailable right now — try again in a moment.',
        }));
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      // Start with empty assistant message
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
          let data: any = null;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
          if (event === 'status') {
            update(m => ({ ...m, kind: 'thinking', status: data.text }));
          }
          if (event === 'delta') {
            accumulated += data.text;
            update(m =>
              m.kind === 'thinking'
                ? { id: aid, kind: 'assistant', text: accumulated }
                : { ...(m as Extract<TMsg, { kind: 'assistant' }>), text: accumulated }
            );
          }
          if (event === 'chips') {
            update(m =>
              m.kind === 'assistant'
                ? { ...m, chips: data.chips as Chip[] }
                : m
            );
          }
        }
      }

      // Final cleanup
      setMessages(prev =>
        prev.map(m =>
          m.id === aid && m.kind === 'thinking'
            ? { id: aid, kind: 'assistant', text: accumulated || 'Done.' }
            : m
        )
      );
    } catch {
      update(() => ({
        id: aid,
        kind: 'assistant',
        text: 'Connection dropped — please try again.',
      }));
    } finally {
      setBusy(false);
      scrollToBottom();
    }
  };

  // ── Confirm a concierge chip ───────────────────────────────────────────────
  const handleConfirmChip = async (chip: Chip) => {
    try {
      const sessionToken =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(`halo_client_session_${token}`)
          : null;
      const resp = await fetch(`/api/client/${token}/concierge/confirm`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ confirmToken: chip.confirmToken }),
      });
      const data = await resp.json();
      setConfirmedIds(prev => new Set([...prev, chip.confirmToken]));
      setMessages(prev => [
        ...prev,
        { id: `sys-${Date.now()}`, kind: 'success', text: data.ok ? (data.message ?? 'Done.') : data.message },
      ]);
      qc.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
    } catch {
      toast({ title: 'Confirmation expired — ask Halo One again', variant: 'destructive' });
    }
  };

  // ── Derived values ─────────────────────────────────────────────────────────
  const cards = board?.cards ?? [];
  const needsYouCards = cards.filter(c => c.needsAction);
  const happeningCards = cards.filter(c => !c.needsAction && c.lane && c.lane !== 'done');
  const propertyName = board?.propertyName ?? 'Your Property';
  const logoUrl = board?.logoUrl;
  const unreadMessages = board?.unreadMessages ?? 0;
  const permissions = board?.viewer?.permissions ?? [];

  // ── Render thread message ──────────────────────────────────────────────────
  const renderMsg = (msg: TMsg): React.ReactNode => {
    switch (msg.kind) {
      case 'greeting':
        return (
          <GreetingCard
            propertyName={propertyName}
            needsYouCount={needsYouCards.length}
            happeningCount={happeningCards.length}
          />
        );

      case 'needs-you':
        return (
          <div className="mb-4">
            <SectionHeader
              icon={TriangleAlert}
              label="Needs You"
              count={needsYouCards.length}
              accent={needsYouCards.length > 0 ? '#E11D48' : undefined}
            />
            <NeedsYouSection
              cards={needsYouCards}
              token={token}
              onResolved={() => {}}
              onAskHalo={text => { setInput(text); send(text); }}
            />
          </div>
        );

      case 'happening-now':
        return (
          <div className="mb-4">
            <SectionHeader
              icon={Activity}
              label="Happening Now"
              count={happeningCards.length}
            />
            <HappeningNowStrip
              cards={happeningCards}
              onNavigate={path => setLocation(`/${token}${path}`)}
            />
          </div>
        );

      case 'user':
        return <UserBubble text={msg.text} />;

      case 'thinking':
        return <ThinkingBubble status={msg.status} />;

      case 'assistant':
        return (
          <AssistantBubble
            text={msg.text}
            chips={msg.chips}
            onConfirm={handleConfirmChip}
            confirmedIds={confirmedIds}
          />
        );

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

      default:
        return null;
    }
  };

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-[#040D1C] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-2xl bg-[#B4FF44]/10 border border-[#B4FF44]/20 grid place-items-center">
            <Sparkles className="w-5 h-5 text-[#B4FF44]" />
          </div>
          <div className="flex gap-1">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full bg-[#B4FF44]/40"
                style={{ animation: `h1Bounce 1.2s ease-in-out ${i * 0.2}s infinite` }}
              />
            ))}
          </div>
          <span className="text-[11px] font-bold tracking-[0.22em] uppercase text-white/25">
            Halo One
          </span>
        </div>
      </div>
    );
  }

  if (error || !board) {
    return (
      <div className="min-h-[100dvh] bg-[#040D1C] flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-[#E11D48]/12 border border-[#E11D48]/22 grid place-items-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-[#E11D48]" />
          </div>
          <div className="text-[18px] font-bold text-white mb-2">Invalid or expired link</div>
          <div className="text-[13px] text-white/40 leading-relaxed">
            This link may have expired or been revoked. Contact your property management team for a new link.
          </div>
        </div>
      </div>
    );
  }

  const conversationActive = messages.some(m =>
    m.kind === 'user' || m.kind === 'assistant' || m.kind === 'thinking' || m.kind === 'success' || m.kind === 'error'
  );

  return (
    <>
      <style>{KEYFRAMES}</style>

      <div className="min-h-[100dvh] bg-[#040D1C] flex flex-col">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="flex items-center gap-2.5 px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-3 shrink-0 border-b border-white/5 bg-[#040D1C] sticky top-0 z-40">
          {logoUrl ? (
            <img src={logoUrl} alt={propertyName} className="h-6 object-contain shrink-0" />
          ) : (
            <div className="flex items-center gap-2 shrink-0">
              <Sparkles className="w-4 h-4 text-[#B4FF44]" />
              <span className="text-[13px] font-bold tracking-[0.04em] text-white/90">Halo One</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-white/50 truncate">{propertyName}</div>
          </div>

          {/* Unread badge */}
          {unreadMessages > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#E11D48]/10 border border-[#E11D48]/18 shrink-0">
              <Bell className="w-3 h-3 text-[#E11D48]" />
              <span className="text-[10px] font-bold text-[#E11D48]/85">{unreadMessages}</span>
            </div>
          )}

          {/* Board link */}
          <button
            onClick={() => setLocation(`/${token}/board`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 border border-white/8 text-[10.5px] font-bold text-white/40 hover:text-white/70 hover:bg-white/8 transition-all active:scale-[0.95] shrink-0"
          >
            <LayoutGrid className="w-3 h-3" />
            <span className="hidden sm:inline">Board</span>
          </button>
        </header>

        {/* ── Thread ──────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-2 overscroll-none">
          {messages.map(msg => (
            <div
              key={msg.id}
              className="h1-msg"
              style={{ animation: 'h1MsgIn 0.22s ease-out both' }}
            >
              {renderMsg(msg)}
            </div>
          ))}

          {/* PM suggested prompts (shown when conversation is empty) */}
          {!conversationActive && (
            <div className="mt-2 mb-4">
              <div className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/18 mb-3 px-0.5">
                Ask Halo One
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PM_PROMPTS.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => send(prompt)}
                    className="text-left px-3.5 py-3 rounded-[13px] bg-white/[0.03] border border-white/6 text-[12.5px] text-white/40 hover:text-white/65 hover:bg-white/[0.05] transition-all active:scale-[0.97] leading-snug"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-4" />
        </div>

        {/* ── Ambient strip ────────────────────────────────────────────────── */}
        <div className="px-4 py-1.5 flex items-center gap-2.5 border-t border-white/4 shrink-0">
          <div className="flex gap-[3px] shrink-0">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-[3px] h-[9px] rounded-full bg-[#B4FF44]"
                style={{ animation: `h1Ambient 2.2s ease-in-out ${i * 0.35}s infinite` }}
              />
            ))}
          </div>
          <span className="text-[10.5px] text-white/20 font-medium flex-1 truncate">
            {AMBIENT_MSGS[ambientIdx]}
          </span>
        </div>

        {/* ── Command bar ──────────────────────────────────────────────────── */}
        <div className="px-4 pb-[calc(10px+env(safe-area-inset-bottom))] pt-2.5 shrink-0 bg-[#040D1C] border-t border-white/5">
          <div className="flex items-center gap-2">
            {/* Input */}
            <div className="relative flex-1">
              <Sparkles className="absolute left-3 top-1/2 -translate-y-1/2 w-[12px] h-[12px] text-[#B4FF44]/38 pointer-events-none" />
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                placeholder="Ask Halo One anything…"
                disabled={busy}
                className="w-full h-11 rounded-full bg-white/5 border border-white/8 pl-[32px] pr-4 text-[13.5px] text-white placeholder:text-white/22 focus:outline-none focus:border-[#B4FF44]/35 focus:ring-1 focus:ring-[#B4FF44]/12 focus:bg-white/6 disabled:opacity-50 transition-all"
              />
            </div>

            {/* Send */}
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || busy}
              className="w-11 h-11 rounded-full bg-[#B4FF44] grid place-items-center text-[#07101E] shadow-[0_4px_16px_rgba(180,255,68,0.28)] hover:scale-105 active:scale-[0.94] transition-transform disabled:opacity-40 disabled:scale-100 shrink-0"
            >
              {busy ? (
                <Loader2 className="w-[15px] h-[15px] animate-spin" />
              ) : (
                <Send className="w-[14px] h-[14px]" strokeWidth={2.5} />
              )}
            </button>
          </div>

          {/* Nav chips */}
          <div className="flex gap-2 mt-2.5 overflow-x-auto pb-0.5 scrollbar-hide">
            {[
              { label: 'Board', icon: LayoutGrid, path: '/board', color: '#6366F1' },
              { label: 'Units', icon: Home, path: '/units', color: '#3B82F6', perm: 'unit_map' },
              { label: 'Map', icon: MapPin, path: '/map', color: '#22C55E', perm: 'unit_map' },
              { label: 'Hub', icon: BookOpen, path: '/hub', color: '#F59E0B', perm: 'hub' },
              { label: 'Team', icon: Users, path: '/team', color: '#8B5CF6', perm: 'team_admin' },
              { label: 'Walk', icon: Footprints, path: '/walk/', color: '#B4FF44', external: true },
            ]
              .filter(c => !c.perm || permissions.includes(c.perm))
              .map(chip => {
                const Icon = chip.icon;
                return (
                  <button
                    key={chip.label}
                    onClick={() => {
                      if (chip.external) window.open(chip.path, '_blank', 'noopener');
                      else setLocation(`/${token}${chip.path}`);
                    }}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/7 text-[10.5px] font-bold text-white/38 hover:text-white/65 hover:bg-white/8 transition-all active:scale-[0.95]"
                  >
                    <Icon className="w-3 h-3" style={{ color: chip.color }} />
                    {chip.label}
                  </button>
                );
              })}
          </div>
        </div>
      </div>
    </>
  );
}
