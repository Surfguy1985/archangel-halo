import React, { useState } from 'react';
import { ClientBoardCardView } from '@workspace/api-client-react';
import { useDispatchClientBoardAction } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { Camera, User } from 'lucide-react';
import { format } from 'date-fns';
import {
  specFor,
  derived,
  heatColor,
  PRIORITY_CHIP,
  TONES,
  MetricTone,
} from './templateSpec';

interface BoardCardProps {
  card: ClientBoardCardView;
  token: string;
  readOnly: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
}

type Metric = { label: string; value: string; tone: MetricTone };

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function slaPercent(card: ClientBoardCardView, targetDays: number): number {
  const due = card.dueOn || card.scheduledOn;
  if (!due) return 30;
  const dueMs = parseLocalDate(due).getTime() + 86_400_000;
  const startMs = dueMs - targetDays * 86_400_000;
  const pct = ((Date.now() - startMs) / (dueMs - startMs)) * 100;
  return Math.max(4, Math.min(140, pct));
}

function stagePct(card: ClientBoardCardView): number {
  if (!card.pipeline || card.pipeline.length < 2 || card.stageIndex == null) return 0;
  return Math.round((card.stageIndex / (card.pipeline.length - 1)) * 100);
}

function fmtDue(d?: string | null): string {
  if (!d) return '—';
  try {
    return format(parseLocalDate(d), 'MMM d');
  } catch {
    return d;
  }
}

function metricsFor(card: ClientBoardCardView): [Metric, Metric, Metric] {
  const due = card.dueOn || card.scheduledOn;
  const overdue = !!due && parseLocalDate(due).getTime() + 86_400_000 < Date.now();
  const dueTone: MetricTone = overdue ? 'bad' : due ? 'ink' : 'mute';
  const pct = stagePct(card);
  const pctTone: MetricTone = pct >= 80 ? 'good' : pct >= 40 ? 'ink' : 'warn';
  const photos = card.photos?.length ?? 0;

  switch (card.template) {
    case 'invoice': {
      const amt = card.amount != null ? `$${card.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—';
      return [
        { label: 'AMOUNT', value: amt, tone: 'ink' },
        { label: 'STATUS', value: (card.status ?? '—').toUpperCase(), tone: card.status === 'paid' ? 'good' : card.status === 'sent' ? 'warn' : 'mute' },
        { label: 'DUE', value: fmtDue(card.dueOn), tone: dueTone },
      ];
    }
    case 'crew':
      return [
        { label: 'ON PROP', value: card.crew?.onSite ? 'YES' : 'NO', tone: card.crew?.onSite ? 'good' : 'mute' },
        { label: 'STAGE', value: `${pct}%`, tone: pctTone },
        { label: 'PHOTOS', value: String(photos), tone: photos > 0 ? 'good' : 'mute' },
      ];
    case 'request':
      return [
        { label: 'NEEDED', value: fmtDue(card.dueOn), tone: dueTone },
        { label: 'STATUS', value: (card.status ?? 'PENDING').toUpperCase(), tone: card.status === 'pending' ? 'warn' : 'mute' },
        { label: 'UNIT', value: card.unitNo ?? '—', tone: 'ink' },
      ];
    case 'custom':
      return [
        { label: 'DUE', value: fmtDue(card.dueOn), tone: dueTone },
        { label: 'PRIORITY', value: (card.priority ?? 'none').toUpperCase(), tone: card.priority === 'urgent' || card.priority === 'high' ? 'bad' : 'mute' },
        { label: 'LANE', value: card.lane.replace('_', ' ').toUpperCase(), tone: 'ink' },
      ];
    default:
      return [
        { label: card.scheduledOn ? 'SCHED' : 'DUE', value: fmtDue(due), tone: dueTone },
        { label: 'STAGE', value: `${pct}%`, tone: pctTone },
        { label: 'PHOTOS', value: String(photos), tone: photos > 0 ? 'good' : 'mute' },
      ];
  }
}

function cardCode(card: ClientBoardCardView): string {
  const spec = specFor(card.template);
  const m = card.subtitle?.match(/(?:Job|WO)\s+([\w-]+)/i);
  if (m) return `${spec.codePrefix}-${m[1]!.replace(/^J-/, '')}`;
  return `${spec.codePrefix}-${card.cardKey.slice(-4).toUpperCase()}`;
}

function alertLabels(card: ClientBoardCardView): { name: string; color: string }[] {
  const out: { name: string; color: string }[] = [];
  const due = card.dueOn || card.scheduledOn;
  if (due && parseLocalDate(due).getTime() + 86_400_000 < Date.now() && card.lane !== 'done')
    out.push({ name: 'Overdue', color: '#e11d48' });
  if (card.priority === 'urgent') out.push({ name: 'Sev 1', color: '#be123c' });
  if (card.template !== 'custom') out.push({ name: 'Auto-gen', color: '#475569' });
  if (card.photos && card.photos.length > 0) out.push({ name: 'Evidence', color: '#65a30d' });
  return out.slice(0, 3);
}

export function BoardCard({ card, token, readOnly, onDragStart, onDragEnd }: BoardCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dispatchAction = useDispatchClientBoardAction();
  const [isDispatching, setIsDispatching] = useState(false);

  const spec = specFor(card.template);
  const d = derived(spec.accent);
  const heat = slaPercent(card, spec.slaTargetDays);
  const rail = card.lane === 'done' ? TONES.good : heatColor(heat);
  const metrics = metricsFor(card);
  const prio = PRIORITY_CHIP[card.priority ?? 'none'] ?? PRIORITY_CHIP.none;
  const labels = alertLabels(card);
  const draggable = !readOnly;

  const handleAction = (e: React.MouseEvent, action: string) => {
    e.stopPropagation();
    if (readOnly) {
      toast({ title: 'Sign in required', description: 'You are viewing as a guest.', variant: 'destructive' });
      return;
    }
    setIsDispatching(true);
    dispatchAction.mutate(
      { token, data: { action, cardKey: card.cardKey, payload: {} } },
      {
        onSuccess: (outcome) => {
          if (!outcome.ok) {
            toast({ title: 'Action blocked', description: outcome.reason || outcome.message, variant: 'destructive' });
          } else {
            toast({ title: 'Done', description: outcome.message || 'Completed' });
            queryClient.invalidateQueries({ queryKey: getGetClientBoardQueryKey(token) });
          }
        },
        onError: () => toast({ title: 'Error', description: 'Network error', variant: 'destructive' }),
        onSettled: () => setIsDispatching(false),
      },
    );
  };

  const actionBtns = (card.actions ?? []).filter((a) => a.kind !== 'link');
  const linkBtns = (card.actions ?? []).filter((a) => a.kind === 'link');
  const primaryBtn = actionBtns.find((a) => a.kind === 'primary') ?? linkBtns[0] ?? actionBtns[0];
  const secondaryBtn = (card.actions ?? []).find((a) => a !== primaryBtn) ?? null;

  const renderDecision = (btn: typeof primaryBtn | undefined, primary: boolean) => {
    const cls = primary
      ? 'flex-1 h-[40px] rounded-[14px] bg-[#d8f84e] text-[#101c33] text-[11px] font-[800] uppercase tracking-wider shadow-[0_2px_12px_rgba(216,248,78,0.3)] hover:shadow-[0_4px_16px_rgba(216,248,78,0.4)] hover:brightness-105 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:active:scale-100'
      : 'flex-1 h-[40px] rounded-[14px] border border-black/10 bg-white shadow-sm text-[11px] font-[800] uppercase tracking-wider text-[#101c33] hover:bg-black/[0.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:active:scale-100';
    
    if (!btn)
      return (
        <div className={cls} style={{ opacity: 0.35, pointerEvents: 'none' as const, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          —
        </div>
      );
    if (btn.href)
      return (
        <a
          href={btn.href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`${cls} flex items-center justify-center`}
        >
          {btn.label}
        </a>
      );
    return (
      <button
        type="button"
        disabled={isDispatching || readOnly}
        onClick={(e) => handleAction(e, btn.key)}
        className={cls}
      >
        {btn.label}
      </button>
    );
  };

  const renderEvidence = () => {
    if (card.photos && card.photos.length > 0) {
      const pair = card.photos.slice(0, 2);
      return (
        <div className="grid h-full grid-cols-2 gap-2">
          {pair.map((p, i) => (
            <div key={i} className="relative overflow-hidden rounded-[14px] border border-black/5 shadow-inner">
              <img src={p.url} alt={p.phase ?? 'photo'} className="h-full w-full object-cover transition-transform duration-500 hover:scale-110" />
              {p.phase && (
                <span className="absolute left-2 top-2 rounded-md bg-black/60 backdrop-blur-md px-1.5 py-0.5 text-[8.5px] font-[800] uppercase tracking-wider text-white shadow-sm">
                  {p.phase}
                </span>
              )}
            </div>
          ))}
          {pair.length === 1 && (
            <div className="flex items-center justify-center rounded-[14px] border-2 border-dashed border-black/5 bg-black/[0.01] text-[10px] font-bold uppercase text-[#8c8a81]">
              Awaiting after
            </div>
          )}
        </div>
      );
    }
    if (card.template === 'crew' && card.crew) {
      return (
        <div className="flex h-full flex-col justify-center gap-2 rounded-[14px] px-4 border border-black/5 bg-white shadow-sm">
          <div className="flex items-center gap-3">
            {card.crew.selfieUrl ? (
              <img src={card.crew.selfieUrl} alt={card.crew.name} className="h-11 w-11 rounded-full object-cover shadow-sm border border-black/5" />
            ) : (
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/5 shadow-inner text-sm font-extrabold text-[#101c33]">
                {card.crew.name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-[800] text-[#101c33] leading-tight">{card.crew.name}</div>
              <div className="text-[11px] font-[600] text-muted-foreground">{card.crew.trade ?? 'Crew'}</div>
            </div>
            <span
              className="ml-auto rounded-md px-2 py-0.5 text-[9px] font-[800] uppercase tracking-wider shadow-sm"
              style={card.crew.onSite ? { background: '#dcefe4', color: TONES.good } : { background: '#edebe4', color: '#6e6c63' }}
            >
              {card.crew.onSite ? 'On site' : 'Off site'}
            </span>
          </div>
          {card.crew.lastSeenAt && (
            <div className="text-[10px] font-[600] text-muted-foreground mt-1">
              Last seen {format(new Date(card.crew.lastSeenAt), 'MMM d, h:mm a')}
            </div>
          )}
        </div>
      );
    }
    
    const lines = [card.description, card.notes]
      .filter(Boolean)
      .join('\n')
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 3);
      
    return (
      <div className="flex h-full flex-col justify-center gap-2.5 overflow-hidden rounded-[14px] px-4 py-3 border border-black/5 bg-white shadow-sm">
        {lines.length > 0 ? (
          lines.map((l, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <span className="mt-1.5 h-[5px] w-[5px] shrink-0 rounded-full shadow-sm" style={{ background: spec.accent }} />
              <span className="line-clamp-1 text-[11.5px] font-[600] text-[#101c33] leading-snug">{l}</span>
            </div>
          ))
        ) : (
          <span className="text-[11px] font-[600] italic text-muted-foreground">No evidence yet</span>
        )}
      </div>
    );
  };

  const stageChip = card.pipeline && card.stageIndex != null && card.stageIndex < card.pipeline.length
      ? card.pipeline[card.stageIndex]
      : null;

  return (
    <div
      id={`card-${card.cardKey}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative flex h-[430px] w-full flex-col overflow-hidden rounded-[24px] border shadow-[0_4px_24px_rgba(0,0,0,0.03)] transition-all duration-300 hover:shadow-[0_8px_32px_rgba(0,0,0,0.06)] bg-white ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ borderColor: 'rgba(0,0,0,0.06)' }}
    >
      {/* SLA rail glowing track */}
      <div className="h-[4px] w-full shrink-0 relative overflow-hidden bg-black/5">
        <div className="h-full absolute left-0 top-0 transition-all duration-1000 ease-out" style={{ width: `${Math.min(100, heat)}%`, background: rail, boxShadow: `0 0 10px ${rail}` }} />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5 pt-4">
        {/* Identity */}
        <div className="flex h-[24px] items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-sm shadow-sm" style={{ background: spec.accent }} />
          <span className="font-mono text-[11px] font-[800] tracking-tight text-[#101c33]">{cardCode(card)}</span>
          <span
            className="rounded-md px-1.5 py-0.5 text-[8.5px] font-[800] uppercase tracking-wider shadow-sm"
            style={{ background: prio.bg, color: prio.fg }}
          >
            {card.priority ?? 'none'}
          </span>
          {stageChip && (
            <span className="ml-auto truncate rounded-md px-2 py-0.5 text-[8.5px] font-[800] uppercase tracking-wider shadow-sm" style={{ background: d.unitChip, color: '#101c33' }}>
              {stageChip}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 h-[44px] text-[16px] font-[800] leading-tight text-[#101c33]">
          {card.title}
        </h3>

        {/* Context */}
        <div className="flex h-[24px] items-center gap-2 overflow-hidden">
          {card.unitNo && (
            <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[9.5px] font-[800] shadow-sm" style={{ background: d.unitChip, color: '#101c33' }}>
              {card.unitNo}
            </span>
          )}
          <span className="truncate text-[11px] font-[700] text-muted-foreground">
            {card.subtitle || spec.categoryLabel}
          </span>
        </div>

        {/* Metric triad */}
        <div className="grid h-[64px] grid-cols-3 divide-x divide-black/5 rounded-[14px] bg-black/[0.015] border border-black/5 shadow-inner">
          {metrics.map((m, i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-0.5 px-1">
              <span className="text-[8.5px] font-[800] uppercase tracking-widest text-muted-foreground">{m.label}</span>
              <span className="max-w-full truncate text-[15px] font-[800]" style={{ color: TONES[m.tone] }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>

        {/* Evidence */}
        <div className="h-[114px] shrink-0 overflow-hidden">{renderEvidence()}</div>

        {/* Labels & Tags */}
        <div className="flex h-[24px] items-center gap-1.5 overflow-hidden">
          <span className="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-[800] uppercase tracking-wider text-white shadow-sm" style={{ background: spec.accent }}>
            {spec.categoryLabel}
          </span>
          {labels.map((l) => (
            <span key={l.name} className="shrink-0 rounded-md px-2 py-0.5 text-[9px] font-[800] uppercase tracking-wider text-white shadow-sm" style={{ background: l.color }}>
              {l.name}
            </span>
          ))}
        </div>
      </div>

      {/* Decision row pushes to bottom, slightly overlaying footer area visually if we wanted, but let's keep it clean */}
      <div className="flex h-[40px] shrink-0 items-stretch gap-2 px-5 mb-4">
        {renderDecision(primaryBtn, true)}
        {renderDecision(secondaryBtn ?? undefined, false)}
      </div>

      {/* Footer */}
      <div className="flex h-[44px] shrink-0 items-center gap-3 px-5 border-t border-black/5 bg-black/[0.015]">
        {card.crew?.selfieUrl ? (
          <img src={card.crew.selfieUrl} alt={card.crew.name} className="h-6 w-6 rounded-full object-cover shadow-sm" />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm border border-black/5">
            <User className="h-3 w-3" style={{ color: spec.accent }} />
          </div>
        )}
        <span className="truncate text-[10.5px] font-[800] text-[#101c33]">
          {card.crew?.name ?? (card.template === 'custom' ? 'Your card' : 'Unassigned')}
        </span>
        <span className="ml-auto text-[10.5px] font-[800]" style={{ color: rail }}>
          {fmtDue(card.dueOn || card.scheduledOn)}
        </span>
        {card.photos && card.photos.length > 0 && (
          <span className="flex items-center gap-1 text-[10.5px] font-[800] text-muted-foreground">
            <Camera className="h-3 w-3" />
            {card.photos.length}
          </span>
        )}
      </div>
    </div>
  );
}