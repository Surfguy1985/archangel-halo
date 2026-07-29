import React, { useState } from 'react';
import { ClientBoardCardView } from '@workspace/api-client-react';
import { useDispatchClientBoardAction } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { getGetClientBoardQueryKey } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
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
import { Camera, User, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { ModuleMetrics, ModuleEvidence, ModuleDecision } from './BoardCardModules';

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
  return Math.max(0, Math.min(100, pct)); // Cap at 100 per spec
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

export function cardCode(card: ClientBoardCardView, spec: any): string {
  const m = card.subtitle?.match(/(?:Job|WO)\s+([\w-]+)/i);
  if (m) return `${spec.codePrefix}-${m[1]!.replace(/^J-/, '')}`;
  return `${spec.codePrefix}-${card.cardKey.slice(-4).toUpperCase()}`;
}

function alertLabels(card: ClientBoardCardView, spec: any): { name: string; color: string }[] {
  const out: { name: string; color: string }[] = [];
  const due = card.dueOn || card.scheduledOn;
  if (due && parseLocalDate(due).getTime() + 86_400_000 < Date.now() && card.lane !== 'done')
    out.push({ name: 'Overdue', color: '#c25a1e' });
  if (card.priority === 'urgent') out.push({ name: 'Sev 1', color: '#b23a2e' });
  if (card.template !== 'custom') out.push({ name: 'Auto-gen', color: '#4a6070' });
  if (card.photos && card.photos.length > 0) out.push({ name: 'Photos', color: '#5c7a28' });
  return out.slice(0, 3);
}

export function BoardCard({ card, token, readOnly, onDragStart, onDragEnd }: BoardCardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const dispatchAction = useDispatchClientBoardAction();
  const [isDispatching, setIsDispatching] = useState(false);

  const spec = specFor(card.template);
  const tint = cardTint(spec);
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

  const stageIndex = card.stageIndex ?? 0;
  const pipeline = spec.pipeline || [];
  const stageChip = pipeline[stageIndex];

  const cardModule = (card as any).module;
  
  // Evidence list building (exactly 3 rows)
  const rows = [];
  if (pipeline.length > 0) {
    const current = pipeline[stageIndex];
    rows.push({
      bar: TONES.warn,
      text: current,
      meta: 'Current stage',
      chip: { label: 'ACTIVE', bg: '#101C33', fg: '#FFFFFF' }
    });
  }
  if (card.photos && card.photos.length > 0) {
    rows.push({
      bar: TONES.good,
      text: `${card.photos.length} attached`,
      meta: 'Evidence uploaded',
      chip: { label: 'VIEW', bg: '#F1F0EC', fg: '#101C33' }
    });
  }
  if (card.amount) {
    rows.push({
      bar: TONES.ink,
      text: `$${card.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      meta: 'Invoice Total',
      chip: { label: card.status?.toUpperCase() || 'OPEN', bg: '#F1F0EC', fg: '#101C33' }
    });
  }
  
  if (rows.length < 3 && card.dueOn) {
    const overdue = parseLocalDate(card.dueOn).getTime() + 86_400_000 < Date.now();
    rows.push({
      bar: overdue ? TONES.bad : TONES.mute,
      text: fmtDue(card.dueOn),
      meta: 'Scheduled deadline',
      chip: { label: overdue ? 'LATE' : 'DUE', bg: overdue ? '#b23a2e' : '#F1F0EC', fg: overdue ? '#fff' : '#101C33' }
    });
  }

  while (rows.length < 3) {
    rows.push({ bar: 'transparent', text: '—', meta: '', chip: null });
  }

  return (
    <div
      id={`card-${card.cardKey}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative flex flex-col overflow-hidden rounded-[14px] shadow-[0_1px_2px_rgba(16,28,51,0.05)] hover:shadow-[0_12px_30px_rgba(16,28,51,0.15)] hover:-translate-y-[2px] transition-all duration-160 w-[340px] h-[430px] shrink-0 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      style={{ background: tint.bg, border: `1px solid ${tint.bd}` }}
    >
      {/* 1. SLA rail - 3px */}
      <div className="absolute top-0 left-0 w-full h-[3px]" style={{ background: tint.track }}>
        <div className="h-full absolute left-0 top-0 transition-[width] duration-500 ease-linear" style={{ width: `${heat}%`, background: rail }} />
      </div>

      <div className="flex flex-col px-4 pt-[8px] flex-1 min-h-0">
        {/* 2. Identity - 30px */}
        <div className="flex items-center h-[30px] gap-2">
          <span className="h-[7px] w-[7px] shrink-0 rounded-[2px]" style={{ background: spec.accent }} />
          <span className="font-mono text-[10px] font-[700] tracking-[0.08em] text-[#6E6C63]">{cardCode(card, spec)}</span>
          <div className="flex-1" />
          <span
            className="rounded-[4px] px-1.5 py-[2px] text-[8.5px] font-[800] uppercase tracking-wider"
            style={{ background: prio.bg, color: prio.fg }}
          >
            {card.priority ?? 'none'}
          </span>
          {stageChip && (
            <span
              className="max-w-[104px] truncate rounded-[4px] px-1.5 py-[2px] text-[8.5px] font-[800] uppercase tracking-wider"
              style={{ background: tint.stageBg, color: tint.stageFg }}
            >
              {stageChip}
            </span>
          )}
        </div>

        {/* 3. Title - 42px */}
        <div className="h-[42px]">
          <h3 className="line-clamp-2 text-[14.5px] font-[650] leading-[1.28] tracking-[-0.014em] text-[#101c33]">
            {card.title}
          </h3>
        </div>

        {/* 4. Context - 24px */}
        <div className="flex items-center h-[24px] gap-2">
          {card.unitNo ? (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-[2px] text-[10px] font-[700] font-mono text-[#101c33]"
              style={{ background: tint.chip }}
            >
              {card.unitNo}
            </span>
          ) : (
            <span
              className="shrink-0 rounded-[4px] px-1.5 py-[2px] text-[10px] font-[700] font-mono text-muted-foreground"
              style={{ background: tint.chip }}
            >
              PROP
            </span>
          )}
          <span className="truncate text-[11px] font-[500] text-[#6E6C63] whitespace-nowrap">
            {card.subtitle || spec.categoryLabel}
          </span>
        </div>

        {/* 5. Metric triad - 70px */}
        {cardModule ? (
          <ModuleMetrics module={cardModule} tint={tint} />
        ) : (
          <div
            className="grid grid-cols-3 gap-[1px] rounded-[9px] mt-[6px] h-[70px] overflow-hidden"
            style={{ background: tint.bd }}
          >
            {metrics.map((m, i) => (
              <div key={i} className="flex flex-col bg-white pt-[9px] px-[9px] pb-0">
                <span className="text-[8px] font-[800] tracking-[0.08em] text-[#96948B] uppercase whitespace-nowrap overflow-hidden text-ellipsis">{m.label}</span>
                <span className="text-[17px] font-[700] tracking-[-0.035em] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]" style={{ color: TONES[m.tone] }}>
                  {m.value}
                </span>
                <span className="text-[8.5px] font-[650] text-[#96948B] whitespace-nowrap overflow-hidden text-ellipsis mt-[2px]">
                  {m.tone === 'good' ? 'on track' : m.tone === 'warn' ? 'attention' : m.tone === 'bad' ? 'critical' : 'active'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 6. Evidence - 130px */}
        {cardModule ? (
          <ModuleEvidence module={cardModule} tint={tint} />
        ) : (
          <div className="bg-white rounded-[9px] mt-[8px] h-[130px] overflow-hidden flex flex-col" style={{ border: `1px solid ${tint.bd}` }}>
            <div className="h-[22px] flex items-center justify-between px-[10px] border-b border-black/5">
              <span className="text-[8px] font-[800] text-[#96948B] uppercase tracking-wider">EVIDENCE / LOG</span>
              <span className="font-mono text-[8.5px] font-[700] text-[#96948B]">{rows.filter(r => r.text !== '—').length}</span>
            </div>
            <div className="flex flex-col flex-1">
              {rows.map((row, i) => (
                <div key={i} className="h-[36px] flex items-center px-[10px] gap-2 border-b border-black/5 last:border-0">
                  <div className="w-[3px] h-[20px] rounded-[2px]" style={{ background: row.bar }} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className="text-[10.5px] font-[600] text-[#2E2C27] truncate leading-tight">{row.text}</span>
                    {row.meta && <span className="text-[8.5px] text-[#96948B] truncate leading-tight">{row.meta}</span>}
                  </div>
                  {row.chip && (
                    <span
                      className="shrink-0 rounded-[4px] px-1.5 py-[2px] text-[8.5px] font-[800] tracking-wider"
                      style={{ background: row.chip.bg, color: row.chip.fg }}
                    >
                      {row.chip.label}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 7. Labels - 26px */}
        <div className="flex items-center h-[26px] gap-1.5 mt-[6px] overflow-hidden">
          <span
            className="rounded-[20px] px-[8px] py-[3px] text-[8.5px] font-[700] uppercase tracking-wider whitespace-nowrap border"
            style={{
              background: `color-mix(in oklab, ${spec.accent} 12%, #fff)`,
              color: `color-mix(in oklab, ${spec.accent} 80%, #101C33)`,
              borderColor: `color-mix(in oklab, ${spec.accent} 28%, #fff)`
            }}
          >
            {spec.name}
          </span>
          {labels.map((l) => (
            <span
              key={l.name}
              className="rounded-[20px] px-[8px] py-[3px] text-[8.5px] font-[700] uppercase tracking-wider whitespace-nowrap border"
              style={{
                background: `color-mix(in oklab, ${l.color} 12%, #fff)`,
                color: `color-mix(in oklab, ${l.color} 80%, #101C33)`,
                borderColor: `color-mix(in oklab, ${l.color} 28%, #fff)`
              }}
            >
              {l.name}
            </span>
          ))}
        </div>

        {/* 8. Decision - 36px */}
        {cardModule ? (
          <ModuleDecision module={cardModule} tint={tint} cardKey={card.cardKey} token={token} readOnly={readOnly} />
        ) : (
          <div className="flex items-center h-[36px] gap-2 mt-[4px] shrink-0">
            {primaryBtn ? (
              primaryBtn.href ? (
                <a href={primaryBtn.href} target="_blank" rel="noreferrer" className="flex-1 h-full rounded-[8px] bg-[#D8F84E] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#C8EC33] transition-colors">
                  {primaryBtn.label}
                </a>
              ) : (
                <button disabled={isDispatching || readOnly} onClick={(e) => handleAction(e, primaryBtn.key)} className="flex-1 h-full rounded-[8px] bg-[#D8F84E] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center hover:bg-[#C8EC33] disabled:opacity-50 transition-colors">
                  {primaryBtn.label}
                </button>
              )
            ) : (
              <div className="flex-1 h-full rounded-[8px] bg-[#D8F84E] text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center opacity-30 pointer-events-none">
                —
              </div>
            )}

            {secondaryBtn && (
              <button disabled={isDispatching || readOnly} onClick={(e) => handleAction(e, secondaryBtn.key)} className="px-[12px] h-full rounded-[8px] bg-white text-[#101C33] text-[11px] font-[800] uppercase tracking-wider flex items-center justify-center border border-black/10 hover:bg-black/5 disabled:opacity-50 transition-colors" style={{ borderColor: tint.bd }}>
                {secondaryBtn.label}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 9. Footer - 38px */}
      <div
        className="h-[38px] mt-auto flex items-center px-4 gap-2 border-t"
        style={{ background: tint.foot, borderColor: tint.hair }}
      >
        {card.crew?.selfieUrl ? (
          <img src={card.crew.selfieUrl} alt={card.crew.name} className="h-[19px] w-[19px] rounded-full object-cover" />
        ) : (
          <div className="flex h-[19px] w-[19px] items-center justify-center rounded-full text-white text-[8px] font-[800]" style={{ background: spec.accent }}>
            {card.crew?.name ? card.crew.name.split(' ').map((n) => n[0]).join('').slice(0,2) : '—'}
          </div>
        )}
        <span className="text-[10px] font-[650] text-[#101C33] truncate">
          {card.crew?.name ?? (card.template === 'custom' ? 'Your card' : 'Unassigned')}
        </span>
        <div className="flex-1" />
        <span className="text-[9.5px] font-[700] font-mono whitespace-nowrap" style={{ color: rail }}>
          {heat >= 100 ? 'BREACH' : heat >= 85 ? '<1h LEFT' : 'OK'}
        </span>
      </div>
    </div>
  );
}
