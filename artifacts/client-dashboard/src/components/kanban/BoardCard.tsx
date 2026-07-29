import React, { useState } from 'react';
import { ClientBoardCardView } from '@workspace/api-client-react';
import { useDispatchClientBoardAction } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { Camera, User, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import {
  specFor,
  derived,
  heatColor,
  PRIORITY_CHIP,
  cardTint,
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

function stagePct(card: ClientBoardCardView, spec: any): number {
  const pipeline = spec.pipeline || [];
  if (pipeline.length < 2 || card.stageIndex == null) return 0;
  return Math.round((card.stageIndex / (pipeline.length - 1)) * 100);
}

function fmtDue(d?: string | null): string {
  if (!d) return '—';
  try {
    return format(parseLocalDate(d), 'MMM d');
  } catch {
    return d;
  }
}

function metricsFor(card: ClientBoardCardView, spec: any): [Metric, Metric, Metric] {
  const due = card.dueOn || card.scheduledOn;
  const overdue = !!due && parseLocalDate(due).getTime() + 86_400_000 < Date.now();
  const dueTone: MetricTone = overdue ? 'bad' : due ? 'ink' : 'mute';
  const pct = stagePct(card, spec);
  const pctTone: MetricTone = pct >= 80 ? 'good' : pct >= 40 ? 'ink' : 'warn';
  const photos = card.photos?.length ?? 0;

  if (card.amount != null) {
    return [
      { label: 'AMOUNT', value: `$${card.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, tone: 'ink' },
      { label: 'STATUS', value: (card.status ?? '—').toUpperCase(), tone: card.status === 'paid' ? 'good' : card.status === 'sent' ? 'warn' : 'mute' },
      { label: 'DUE', value: fmtDue(card.dueOn), tone: dueTone },
    ];
  }

  return [
    { label: card.scheduledOn ? 'SCHED' : 'DUE', value: fmtDue(due), tone: dueTone },
    { label: 'STAGE', value: `${pct}%`, tone: pctTone },
    { label: 'PHOTOS', value: String(photos), tone: photos > 0 ? 'good' : 'mute' },
  ];
}

function cardCode(card: ClientBoardCardView, spec: any): string {
  const m = card.subtitle?.match(/(?:Job|WO)\s+([\w-]+)/i);
  if (m) return `${spec.codePrefix}-${m[1]!.replace(/^J-/, '')}`;
  return `${spec.codePrefix}-${card.cardKey.slice(-4).toUpperCase()}`;
}

function alertLabels(card: ClientBoardCardView, spec: any): { name: string; color: string }[] {
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
  const tint = cardTint(spec);
  const d = derived(spec.accent);
  const heat = slaPercent(card, spec.slaTargetDays);
  const rail = card.lane === 'done' ? TONES.good : heatColor(heat);
  const metrics = metricsFor(card, spec);
  const prio = PRIORITY_CHIP[card.priority ?? 'none'] ?? PRIORITY_CHIP.none;
  const labels = alertLabels(card, spec);
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
      ? 'flex-1 h-[40px] rounded-[8px] bg-[#d8f84e] text-[#101c33] text-[12px] font-[800] uppercase tracking-wider shadow-sm hover:shadow-md hover:brightness-105 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center'
      : 'flex-1 h-[40px] rounded-[8px] border border-black/10 bg-white shadow-sm text-[12px] font-[800] uppercase tracking-wider text-[#101c33] hover:bg-black/[0.02] active:scale-[0.98] transition-all duration-200 disabled:opacity-50 disabled:active:scale-100 flex items-center justify-center';
    
    if (!btn)
      return (
        <div className={cls} style={{ opacity: 0.35, pointerEvents: 'none' as const }}>
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
          className={cls}
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

  const stageIndex = card.stageIndex ?? 0;
  const pipeline = spec.pipeline || [];
  const stageChip = pipeline[stageIndex];

  // A generic module preview (the checklist-style part of the dense uniform card)
  const renderModule = () => {
    if (pipeline.length === 0) return null;
    // Show 3 steps: previous, current, next (or just first 3 if at start)
    let steps = [];
    if (stageIndex === 0) {
      steps = pipeline.slice(0, 3);
    } else if (stageIndex >= pipeline.length - 1) {
      steps = pipeline.slice(-3);
    } else {
      steps = pipeline.slice(stageIndex - 1, stageIndex + 2);
    }

    return (
      <div
        className="flex flex-col gap-1.5 py-2 px-3 rounded-[8px] bg-white/70 mt-1"
        style={{ border: `1px solid ${tint.hair}` }}
      >
        {steps.map((step, idx) => {
          const stepRealIdx = pipeline.indexOf(step);
          const isDone = stepRealIdx < stageIndex;
          const isCurrent = stepRealIdx === stageIndex;
          
          return (
            <div key={step} className="flex items-center gap-2">
              {isDone ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-[#1f7a52]" />
              ) : isCurrent ? (
                <div className="h-3.5 w-3.5 flex items-center justify-center relative">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[#101c33] opacity-20"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#101c33]"></span>
                </div>
              ) : (
                <Circle className="h-3.5 w-3.5 text-black/20" />
              )}
              <span className={`text-[11px] font-[600] truncate ${isCurrent ? 'text-[#101c33] font-[800]' : 'text-muted-foreground'}`}>
                {step}
              </span>
              <div className="ml-auto flex items-center">
                {isDone ? (
                  <span className="text-[9px] font-[800] uppercase text-[#1f7a52] bg-[#1f7a52]/10 px-1.5 py-[1px] rounded-sm">Done</span>
                ) : isCurrent ? (
                  <span className="text-[9px] font-[800] uppercase text-[#101c33] bg-black/5 px-1.5 py-[1px] rounded-sm">Active</span>
                ) : (
                  <span className="text-[9px] font-[800] uppercase text-black/30">Open</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      id={`card-${card.cardKey}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative flex flex-col overflow-hidden rounded-[16px] shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] transition-all duration-200 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ background: tint.bg, border: `1px solid ${tint.bd}` }}
    >
      <div className="flex flex-col p-4 pb-0 gap-3">
        {/* Top row: id, priority, stage */}
        <div className="flex items-center gap-2 h-[20px]">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: spec.accent }} />
          <span className="font-mono text-[11px] font-[800] tracking-tight text-[#101c33]">{cardCode(card, spec)}</span>
          <span
            className="rounded-[4px] px-1.5 py-[2px] text-[9px] font-[800] uppercase tracking-wider"
            style={{ background: prio.bg, color: prio.fg }}
          >
            {card.priority ?? 'none'}
          </span>
          {stageChip && (
            <span
              className="ml-auto truncate rounded-[4px] px-1.5 py-[2px] text-[9px] font-[800] uppercase tracking-wider"
              style={{ background: tint.stageBg, color: tint.stageFg }}
            >
              {stageChip}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="line-clamp-2 text-[15px] font-[800] leading-snug text-[#101c33]">
          {card.title}
        </h3>

        {/* Meta row: unit + category */}
        <div className="flex items-center gap-2">
          {card.unitNo ? (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-[2px] text-[10px] font-[800] font-mono text-[#101c33]"
              style={{ background: tint.chip }}
            >
              {card.unitNo}
            </span>
          ) : (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-[2px] text-[10px] font-[800] text-muted-foreground"
              style={{ background: tint.chip }}
            >
              PROPERTY
            </span>
          )}
          <span className="truncate text-[11px] font-[600] text-muted-foreground">
            {card.subtitle || spec.categoryLabel}
          </span>
        </div>

        {/* Metric triad */}
        <div
          className="grid grid-cols-3 divide-x divide-black/5 rounded-[8px] bg-white/70 py-2"
          style={{ border: `1px solid ${tint.hair}` }}
        >
          {metrics.map((m, i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-0.5 px-1">
              <span className="text-[9px] font-[800] uppercase tracking-widest text-muted-foreground">{m.label}</span>
              <span className="max-w-full truncate text-[14px] font-[800]" style={{ color: TONES[m.tone] }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>

        {/* Pipeline/Checklist module */}
        {renderModule()}

        {/* Tag pills */}
        <div className="flex flex-wrap gap-1.5 mt-1">
          <span className="rounded-[4px] px-1.5 py-[2px] text-[9px] font-[800] uppercase tracking-wider text-white shadow-sm" style={{ background: spec.accent }}>
            {spec.name}
          </span>
          {labels.map((l) => (
            <span key={l.name} className="rounded-[4px] px-1.5 py-[2px] text-[9px] font-[800] uppercase tracking-wider text-white shadow-sm" style={{ background: l.color }}>
              {l.name}
            </span>
          ))}
        </div>
      </div>

      {/* Decision row */}
      <div className="flex items-center gap-2 p-4 pt-3 pb-4">
        {renderDecision(primaryBtn, true)}
        {renderDecision(secondaryBtn ?? undefined, false)}
      </div>

      {/* SLA footer strip */}
      <div
        className="flex h-[36px] items-center gap-2 px-4 relative overflow-hidden"
        style={{ background: tint.foot, borderTop: `1px solid ${tint.hair}` }}
      >
        <div className="absolute top-0 left-0 w-full h-[2px]" style={{ background: tint.track }}>
          <div className="h-full absolute left-0 top-0 transition-all duration-1000 ease-out" style={{ width: `${Math.min(100, heat)}%`, background: rail }} />
        </div>
        {card.crew?.selfieUrl ? (
          <img src={card.crew.selfieUrl} alt={card.crew.name} className="h-5 w-5 rounded-full object-cover shadow-sm" />
        ) : (
          <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm border border-black/5">
            <User className="h-3 w-3" style={{ color: spec.accent }} />
          </div>
        )}
        <span className="truncate text-[10.5px] font-[800] text-[#101c33]">
          {card.crew?.name ?? (card.template === 'custom' ? 'Your card' : 'Unassigned')}
        </span>
        <span className="ml-auto text-[10.5px] font-[800] flex items-center gap-1" style={{ color: rail }}>
          <AlertCircle className="h-3 w-3" />
          {fmtDue(card.dueOn || card.scheduledOn)}
        </span>
      </div>
    </div>
  );
}