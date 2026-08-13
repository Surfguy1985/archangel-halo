/**
 * Halo One — the client / property-manager conversational home.
 *
 * FIXED SEED: opens with a centered full-screen welcome matching the premium
 * near-black HALO design language — glowing ring, "Hi." greeting, one large
 * rounded command composer, four Try Asking cards scoped to the PM's role.
 *
 * THREAD: once the PM sends a message the seed fades and the conversation fills
 * the screen. All existing board actions (approve, decline, dispatch, pay) remain
 * fully functional through the ConciergeChat SSE endpoint and ConfirmCard chips.
 *
 * Role safety: every PM-facing action goes through the existing
 * /api/client/:token/concierge endpoint with HMAC sessions. Consequential
 * mutations only execute after the PM taps a confirm chip (jti claimed in DB
 * pre-execution). Vendor/crew surfaces are NOT exposed here.
 *
 * "Board" nav: a bottom strip exposes Chat (active) and Board (the full rails
 * board, units, map, hub). Nothing is removed — the existing board is one tap
 * away.
 *
 * Thread persists at module level across navigations.
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
  Home,
  MessageSquare,
  Sparkles,
  Wrench,
  DollarSign,
  CheckSquare,
  FileText,
  X,
  Footprints,
  MapPin,
  BookOpen,
  Users,
  Bell,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

type Chip = { id: string; label: string; summary: string; confirmToken: string; expiresAt: string };

type TMsg =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'thinking'; status?: string }
  | { id: string; kind: 'assistant'; text: string; chips?: Chip[] }
  | { id: string; kind: 'success'; text: string }
  | { id: string; kind: 'error'; text: string }
  | { id: string; kind: 'needs-you' }
  | { id: string; kind: 'happening-now' };

// ─── Module-level thread persistence ─────────────────────────────────────────

let _savedThread: TMsg[] | null = null;
let _savedToken: string | null = null;

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
@media (prefers-reduced-motion: reduce) {
  .h1-msg, .h1-seed { animation: none !important; }
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

// ─── Try Asking cards (client-scoped) ─────────────────────────────────────────

type TryAskCard = {
  label: string;
  sub: string;
  icon: typeof DollarSign;
  iconColor: string;
  query: string;
};

const CLIENT_TRY_ASKING: TryAskCard[] = [
  {
    label: "What needs my approval?",
    sub: "Decisions waiting on you",
    icon: CheckSquare,
    iconColor: "#E11D48",
    query: "What needs my approval right now?",
  },
  {
    label: "Status of my units",
    sub: "Turns, occupancy & active jobs",
    icon: Home,
    iconColor: "#3B82F6",
    query: "What's the status of my units?",
  },
  {
    label: "Who's on site today?",
    sub: "Active crews and check-ins",
    icon: Users,
    iconColor: "#22C55E",
    query: "Who's on site at my property today?",
  },
  {
    label: "Submit a work request",
    sub: "Log a new maintenance need",
    icon: Wrench,
    iconColor: "#F59E0B",
    query: "I need to submit a work request",
  },
];

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
                        : 'bg-[#B4FF44] text-[#07101E] hover:scale-[1.02]'
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
  cards,
  token,
  onAsk,
}: {
  cards: ClientBoardCardView[];
  token: string;
  onAsk: (text: string) => void;
}) {
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
    } catch (e: any) {
      toast({ title: e?.data?.error ?? 'Something went wrong', variant: 'destructive' });
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
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#B4FF44] text-[#07101E] text-[11.5px] font-bold hover:scale-[1.02] active:scale-[0.97] transition-transform disabled:opacity-50 shrink-0">
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

// ─── Happening Now strip ──────────────────────────────────────────────────────

function HappeningNow({
  cards,
  onNavigate,
}: {
  cards: ClientBoardCardView[];
  onNavigate: () => void;
}) {
  const active = cards.filter(c => c.lane && c.lane !== 'done' && !c.needsAction);
  const byLane = active.reduce<Record<string, number>>((acc, c) => {
    const l = c.lane ?? 'other'; acc[l] = (acc[l] ?? 0) + 1; return acc;
  }, {});
  const groups = Object.entries(byLane).sort(([a], [b]) => {
    const order = ['in_progress', 'scheduled', 'review', 'requested', 'alerts'];
    return (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99);
  }).slice(0, 3);

  if (groups.length === 0) return (
    <div className="flex items-center gap-2.5 bg-white/[0.022] border border-white/5 rounded-[13px] px-4 py-3 mb-3">
      <span className="text-[12px] text-white/28">No active operations right now.</span>
    </div>
  );

  return (
    <div className="space-y-1.5 mb-3">
      {groups.map(([lane, count]) => {
        const color = getLaneColor(lane);
        const label = ({ in_progress: 'In Progress', scheduled: 'Scheduled', review: 'Under Review', requested: 'Requested', alerts: 'Alert' })[lane] ?? lane.replace(/_/g, ' ');
        return (
          <button key={lane} onClick={onNavigate}
            className="w-full flex items-center gap-3 bg-white/[0.025] border border-white/5 rounded-[12px] px-4 py-3 hover:bg-white/[0.04] transition-colors active:scale-[0.98]">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}55` }} />
            <span className="text-[12.5px] text-white/68 font-medium flex-1 text-left">{count} {count === 1 ? 'item' : 'items'} — {label}</span>
            <ChevronRight className="w-3.5 h-3.5 text-white/18 shrink-0" />
          </button>
        );
      })}
    </div>
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

  // Thread
  const [messages, setMessages] = useState<TMsg[]>(() => {
    if (_savedToken === token && _savedThread) return _savedThread;
    return [];
  });

  useEffect(() => { _savedThread = messages; _savedToken = token; }, [messages, token]);

  // Input
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

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

  // Send to concierge
  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);

    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;

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
          let data: any = null;
          try { data = JSON.parse(dataLine.slice(6)); } catch { continue; }
          if (event === 'status') update(m => ({ ...m, kind: 'thinking', status: data.text }));
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
              m.kind === 'assistant' ? { ...m, chips: data.chips as Chip[] } : m
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
  }, [busy, token, scrollToBottom]);

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

  const hasThread = messages.some(m => m.kind === 'user');

  const renderMsg = (msg: TMsg): React.ReactNode => {
    switch (msg.kind) {
      case 'needs-you':
        return (
          <div className="mb-4">
            <SectionLabel label="Needs You" count={needsYouCards.length} accent={needsYouCards.length > 0 ? '#E11D48' : undefined} />
            <NeedsYouInline cards={needsYouCards} token={token} onAsk={text => { setInput(text); send(text); }} />
          </div>
        );
      case 'happening-now':
        return (
          <div className="mb-4">
            <SectionLabel label="Happening Now" count={happeningCards.length} />
            <HappeningNow cards={happeningCards} onNavigate={() => setLocation(`/${token}/board`)} />
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
      default: return null;
    }
  };

  // Loading / Error
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
          <div className="flex-1 flex flex-col items-center justify-center px-5 pb-2 overflow-hidden">
            {/* Glowing ring */}
            <div className="mb-6 h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.05s both' }}>
              <div className="w-[68px] h-[68px] rounded-full bg-[#B4FF44]/7 border border-[#B4FF44]/18 grid place-items-center"
                style={{ animation: 'h1Glow 3.5s ease-in-out infinite' }}>
                <HaloRingIcon className="w-[30px] h-[30px] text-[#B4FF44]" />
              </div>
            </div>

            {/* Greeting */}
            <div className="text-center mb-2 h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.12s both' }}>
              <h1 className="text-[34px] font-bold text-white leading-none tracking-[-0.02em] mb-2">
                {timeGreet}.
              </h1>
              {needsYouCards.length > 0 ? (
                <p className="text-[13.5px] text-white/38 font-medium">
                  {needsYouCards.length} decision{needsYouCards.length !== 1 ? 's' : ''} waiting for you.
                </p>
              ) : (
                <p className="text-[13.5px] text-white/38 font-medium">Your property command center.</p>
              )}
            </div>

            {/* Status chips */}
            <div className="flex items-center gap-2 mb-7 flex-wrap justify-center h1-seed"
              style={{ animation: 'h1SeedIn 0.5s ease-out 0.18s both' }}>
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
            <div className="w-full max-w-sm mb-6 h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.22s both' }}>
              <div className="relative flex items-center bg-white/[0.048] border border-white/10 rounded-[18px] overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.30)] hover:border-white/15 transition-all focus-within:border-[#B4FF44]/30 focus-within:bg-white/[0.062]">
                <Sparkles className="ml-4 w-[13px] h-[13px] text-[#B4FF44]/35 shrink-0 pointer-events-none" />
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (input.trim()) send(input); } }}
                  placeholder="Ask Halo One anything…"
                  className="flex-1 h-[54px] bg-transparent px-3 text-[14px] text-white placeholder:text-white/20 focus:outline-none"
                />
                <button
                  onClick={() => { if (input.trim()) send(input); }}
                  disabled={!input.trim() || busy}
                  className="mr-3 w-9 h-9 rounded-full grid place-items-center bg-[#B4FF44] text-[#07101E] shadow-[0_4px_14px_rgba(180,255,68,0.28)] hover:scale-105 active:scale-[0.94] transition-transform disabled:opacity-32 disabled:scale-100 shrink-0"
                >
                  {busy ? <Loader2 className="w-[13px] h-[13px] animate-spin" /> : <ChevronRight className="w-[15px] h-[15px]" strokeWidth={2.5} />}
                </button>
              </div>
            </div>

            {/* Try Asking */}
            <div className="w-full max-w-sm h1-seed" style={{ animation: 'h1SeedIn 0.5s ease-out 0.30s both' }}>
              <div className="text-[9.5px] font-bold tracking-[0.22em] uppercase text-white/20 mb-3 text-center">
                Try Asking
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {CLIENT_TRY_ASKING.map(card => {
                  const Icon = card.icon;
                  return (
                    <button key={card.label} onClick={() => send(card.query)}
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
            {/* Show decision inbox and happening now if there's activity */}
            {(needsYouCards.length > 0 || happeningCards.length > 0) && messages.length === 1 && (
              <div className="px-4 pt-3 pb-0 shrink-0">
                {needsYouCards.length > 0 && (
                  <div>
                    <SectionLabel label="Needs You" count={needsYouCards.length} accent="#E11D48" />
                    <NeedsYouInline cards={needsYouCards.slice(0, 2)} token={token}
                      onAsk={t => { setInput(t); send(t); }} />
                  </div>
                )}
              </div>
            )}

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-4 pt-3 pb-2 overscroll-none">
              {messages.map(msg => (
                <div key={msg.id} className="h1-msg" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
                  {renderMsg(msg)}
                </div>
              ))}

              {/* Follow-up suggestions */}
              {messages.length > 0 && messages[messages.length - 1]?.kind !== 'thinking' && (
                <div className="flex gap-2 flex-wrap mt-2 mb-1">
                  {["What needs approval?", "Show active jobs", "Invoice status", "Who's on site?"].map(p => (
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
                <button onClick={() => { if (input.trim()) send(input); }} disabled={!input.trim() || busy}
                  className="w-11 h-11 rounded-full bg-[#B4FF44] grid place-items-center text-[#07101E] shadow-[0_4px_14px_rgba(180,255,68,0.26)] hover:scale-105 active:scale-[0.94] transition-transform disabled:opacity-38 disabled:scale-100 shrink-0">
                  {busy ? <Loader2 className="w-[14px] h-[14px] animate-spin" /> : <Send className="w-[14px] h-[14px]" strokeWidth={2.5} />}
                </button>
              </div>
            </div>
          </>
        )}

        {/* ── Bottom nav: Chat | Board ──────────────────────────────────── */}
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
