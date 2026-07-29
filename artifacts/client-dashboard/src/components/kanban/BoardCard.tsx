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

// ---------------------------------------------------------------------------
// Card anatomy (from the uploaded halo-board-templates spec):
// uniform 340x430 frame, 9 fixed regions — sla_rail, identity, title,
// context, metric_triad (exactly 3), evidence (fixed 130px), labels,
// decision (always two buttons), footer. Only bound values change.
// ---------------------------------------------------------------------------

type Metric = { label: string; value: string; tone: MetricTone };

function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

function slaPercent(card: ClientBoardCardView, targetDays: number): number {
  const due = card.dueOn || card.scheduledOn;
  if (!due) return 30; // no clock — render calm green fill
  const dueMs = parseLocalDate(due).getTime() + 86_400_000; // end of day
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
    default: // job / makeready
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
    out.push({ name: 'Overdue', color: '#c25a1e' });
  if (card.priority === 'urgent') out.push({ name: 'Sev 1', color: '#b23a2e' });
  if (card.template !== 'custom') out.push({ name: 'Auto-generated', color: '#4a6070' });
  if (card.photos && card.photos.length > 0) out.push({ name: 'Photo evidence', color: '#5c7a28' });
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

  // Decision row: always two buttons in the same place.
  const actionBtns = (card.actions ?? []).filter((a) => a.kind !== 'link');
  const linkBtns = (card.actions ?? []).filter((a) => a.kind === 'link');
  const primaryBtn = actionBtns.find((a) => a.kind === 'primary') ?? linkBtns[0] ?? actionBtns[0];
  const secondaryBtn =
    (card.actions ?? []).find((a) => a !== primaryBtn) ?? null;

  const renderDecision = (btn: typeof primaryBtn | undefined, primary: boolean) => {
    const cls = primary
      ? 'flex-1 h-8 rounded-lg bg-[#d8f84e] text-[#101c33] text-[10.5px] font-extrabold uppercase tracking-wide hover:brightness-95 disabled:opacity-50'
      : 'flex-1 h-8 rounded-lg border text-[10.5px] font-extrabold uppercase tracking-wide text-[#101c33] hover:bg-black/5 disabled:opacity-50';
    const style = primary ? undefined : { borderColor: d.border };
    if (!btn)
      return (
        <div className={cls} style={{ ...style, opacity: 0.35, pointerEvents: 'none' as const, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
          style={style}
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
        style={style}
      >
        {btn.label}
      </button>
    );
  };

  // Evidence block — fixed 130px whatever it holds; overflow clipped.
  const renderEvidence = () => {
    if (card.photos && card.photos.length > 0) {
      const pair = card.photos.slice(0, 2);
      return (
        <div className="grid h-full grid-cols-2 gap-1.5">
          {pair.map((p, i) => (
            <div key={i} className="relative overflow-hidden rounded-lg border" style={{ borderColor: d.hairline }}>
              <img src={p.url} alt={p.phase ?? 'photo'} className="h-full w-full object-cover" />
              {p.phase && (
                <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider text-white">
                  {p.phase}
                </span>
              )}
            </div>
          ))}
          {pair.length === 1 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed text-[9px] font-bold uppercase text-[#8c8a81]" style={{ borderColor: d.border }}>
              Awaiting after
            </div>
          )}
        </div>
      );
    }
    if (card.template === 'crew' && card.crew) {
      return (
        <div className="flex h-full flex-col justify-center gap-2 rounded-lg px-3" style={{ background: d.footer }}>
          <div className="flex items-center gap-2.5">
            {card.crew.selfieUrl ? (
              <img src={card.crew.selfieUrl} alt={card.crew.name} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-extrabold" style={{ color: spec.accent }}>
                {card.crew.name.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[12px] font-bold text-[#101c33]">{card.crew.name}</div>
              <div className="text-[10px] font-semibold text-[#6e6c63]">{card.crew.trade ?? 'Crew'}</div>
            </div>
            <span
              className="ml-auto rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wider"
              style={card.crew.onSite ? { background: '#dcefe4', color: TONES.good } : { background: '#edebe4', color: '#6e6c63' }}
            >
              {card.crew.onSite ? 'On site' : 'Off site'}
            </span>
          </div>
          {card.crew.lastSeenAt && (
            <div className="text-[9.5px] font-semibold text-[#6e6c63]">
              Last seen {format(new Date(card.crew.lastSeenAt), 'MMM d, h:mm a')}
            </div>
          )}
        </div>
      );
    }
    // Checklist-style fallback: description / notes lines.
    const lines = [card.description, card.notes]
      .filter(Boolean)
      .join('\n')
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 3);
    return (
      <div className="flex h-full flex-col justify-center gap-1.5 overflow-hidden rounded-lg px-3 py-2" style={{ background: d.footer }}>
        {lines.length > 0 ? (
          lines.map((l, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: spec.accent }} />
              <span className="line-clamp-1 text-[10.5px] font-semibold text-[#101c33]">{l}</span>
            </div>
          ))
        ) : (
          <span className="text-[10px] font-semibold italic text-[#8c8a81]">No evidence yet</span>
        )}
      </div>
    );
  };

  const stageChip =
    card.pipeline && card.stageIndex != null && card.stageIndex < card.pipeline.length
      ? card.pipeline[card.stageIndex]
      : null;

  return (
    <div
      id={`card-${card.cardKey}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group relative flex h-[430px] w-full flex-col overflow-hidden rounded-[14px] border shadow-sm transition-shadow hover:shadow-md ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ background: d.cardBg, borderColor: d.border }}
    >
      {/* 1 — SLA rail (3px, computed) */}
      <div className="h-[3px] w-full shrink-0" style={{ background: d.railTrack }}>
        <div className="h-full" style={{ width: `${Math.min(100, heat)}%`, background: rail }} />
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* 2 — identity: category dot · code (mono) · priority · column */}
        <div className="flex h-[24px] items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: spec.accent }} />
          <span className="font-mono text-[10px] font-bold tracking-tight text-[#101c33]">{cardCode(card)}</span>
          <span
            className="rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider"
            style={{ background: prio.bg, color: prio.fg }}
          >
            {card.priority ?? 'none'}
          </span>
          {stageChip && (
            <span className="ml-auto truncate rounded px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wider" style={{ background: d.unitChip, color: '#101c33' }}>
              {stageChip}
            </span>
          )}
        </div>

        {/* 3 — title: two lines, clamped */}
        <h3 className="line-clamp-2 h-[42px] text-[14.5px] font-[650] leading-tight text-[#101c33]">
          {card.title}
        </h3>

        {/* 4 — context: unit chip + source/refs, single line */}
        <div className="flex h-[24px] items-center gap-1.5 overflow-hidden">
          {card.unitNo && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-extrabold" style={{ background: d.unitChip, color: '#101c33' }}>
              {card.unitNo}
            </span>
          )}
          <span className="truncate text-[10.5px] font-semibold text-[#6e6c63]">
            {card.subtitle || spec.categoryLabel}
          </span>
        </div>

        {/* 5 — metric triad: exactly three, equal thirds */}
        <div className="grid h-[62px] grid-cols-3 divide-x rounded-lg border" style={{ borderColor: d.hairline }}>
          {metrics.map((m, i) => (
            <div key={i} className="flex flex-col items-center justify-center gap-0.5 px-1" style={{ borderColor: d.hairline }}>
              <span className="text-[8px] font-extrabold uppercase tracking-widest text-[#8c8a81]">{m.label}</span>
              <span className="max-w-full truncate text-[15px] font-bold" style={{ color: TONES[m.tone] }}>
                {m.value}
              </span>
            </div>
          ))}
        </div>

        {/* 6 — evidence: fixed height, clipped */}
        <div className="h-[118px] shrink-0 overflow-hidden">{renderEvidence()}</div>

        {/* 7 — labels: category first, then alerts */}
        <div className="flex h-[22px] items-center gap-1 overflow-hidden">
          <span className="shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wider text-white" style={{ background: spec.accent }}>
            {spec.categoryLabel}
          </span>
          {labels.map((l) => (
            <span key={l.name} className="shrink-0 rounded-full px-2 py-0.5 text-[8.5px] font-extrabold uppercase tracking-wider text-white" style={{ background: l.color }}>
              {l.name}
            </span>
          ))}
        </div>

        {/* 8 — decision: always two buttons in the same place */}
        <div className="flex h-[36px] items-stretch gap-1.5">
          {renderDecision(primaryBtn, true)}
          {renderDecision(secondaryBtn ?? undefined, false)}
        </div>
      </div>

      {/* 9 — footer: owner · live clock coloured by the rail · photos */}
      <div className="flex h-[38px] shrink-0 items-center gap-2 px-3" style={{ background: d.footer }}>
        {card.crew?.selfieUrl ? (
          <img src={card.crew.selfieUrl} alt={card.crew.name} className="h-6 w-6 rounded-full object-cover" />
        ) : (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white">
            <User className="h-3.5 w-3.5" style={{ color: spec.accent }} />
          </div>
        )}
        <span className="truncate text-[10px] font-bold text-[#101c33]">
          {card.crew?.name ?? (card.template === 'custom' ? 'Your card' : 'Unassigned')}
        </span>
        <span className="ml-auto text-[10px] font-extrabold" style={{ color: rail }}>
          {fmtDue(card.dueOn || card.scheduledOn)}
        </span>
        {card.photos && card.photos.length > 0 && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-[#6e6c63]">
            <Camera className="h-3 w-3" />
            {card.photos.length}
          </span>
        )}
      </div>
    </div>
  );
}
