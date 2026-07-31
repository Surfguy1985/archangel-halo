import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * WaybillStrip — the six volt-green network dots (Falkon card pack).
 *
 * The dots are ALWAYS volt (#B4FF44), never a brand accent: progress must
 * read identically on every card in the network. Brand owns the header;
 * the network owns status.
 *
 * Live sync: stages arrive through the board's existing SSE→refetch
 * pipeline (useBoardEvents → query refetch → new `stages` prop). The strip
 * derives the ping animation from the DIFF — any stage it hasn't seen
 * before fires the one-shot ping, so a card moved on the other board lights
 * its dot with the animation, while a fresh mount renders already-lit dots
 * quietly. No extra EventSource per card.
 */

export const WAYBILL_STAGE_ORDER = ['sealed', 'routed', 'delivered', 'opened', 'in_review', 'settled'] as const;
export type WaybillStage = (typeof WAYBILL_STAGE_ORDER)[number];

const STAGE_LABEL: Record<WaybillStage, string> = {
  sealed: 'Sealed', routed: 'Routed', delivered: 'Delivered',
  opened: 'Opened', in_review: 'In review', settled: 'Settled',
};

export interface WaybillStageEntryView { stage: string; at: string; byLabel?: string | null }

const VOLT = '#B4FF44';

/** Ping tracking: remembers which stages this card instance has shown, and
 *  reports the newest arrival so the strip can animate exactly once. */
function useStagePings(stages: WaybillStageEntryView[]) {
  const seenRef = useRef<Set<string> | null>(null);
  const [pinged, setPinged] = useState<string | null>(null);
  useEffect(() => {
    const names = stages.map((s) => s.stage);
    if (seenRef.current === null) {
      // First render — light quietly, no ping storm.
      seenRef.current = new Set(names);
      return;
    }
    const fresh = names.filter((n) => !seenRef.current!.has(n));
    if (fresh.length === 0) return;
    for (const n of fresh) seenRef.current.add(n);
    const latest = fresh[fresh.length - 1]!;
    setPinged(latest);
    const t = setTimeout(() => setPinged((p) => (p === latest ? null : p)), 1400);
    return () => clearTimeout(t);
  }, [stages]);
  return pinged;
}

export function WaybillStrip({
  code, stages, holder, live = true, compact = false, className,
}: {
  code?: string | null;
  stages: WaybillStageEntryView[];
  holder?: string | null;
  live?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const pinged = useStagePings(stages);
  const byStage = useMemo(() => {
    const m = new Map<string, WaybillStageEntryView>();
    for (const s of stages) m.set(s.stage, s);
    return m;
  }, [stages]);
  const currentIdx = WAYBILL_STAGE_ORDER.reduce((acc, s, i) => (byStage.has(s) ? i : acc), -1);

  return (
    <div
      className={'fkw' + (compact ? ' fkw-compact' : '') + (className ? ' ' + className : '')}
      role="group"
      aria-label={`Progress: ${STAGE_LABEL[WAYBILL_STAGE_ORDER[Math.max(0, currentIdx)]]}`}
      onClick={(e) => e.stopPropagation()}
    >
      <style>{STRIP_CSS}</style>
      {code && <span className="fkw-code">{code}</span>}
      <div className="fkw-track">
        {WAYBILL_STAGE_ORDER.map((s, i) => {
          const done = byStage.has(s);
          const e = byStage.get(s);
          const tip = [
            STAGE_LABEL[s],
            e ? new Date(e.at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'pending',
            e?.byLabel || '',
          ].filter(Boolean).join(' · ');
          return (
            <React.Fragment key={s}>
              <span
                className={'fkw-dot' + (done ? ' on' : '') + (pinged === s ? ' ping' : '')}
                title={tip}
                aria-label={tip}
              />
              {i < WAYBILL_STAGE_ORDER.length - 1 && (
                <span className={'fkw-line' + (i < currentIdx ? ' on' : '')} />
              )}
            </React.Fragment>
          );
        })}
      </div>
      {!compact && (
        <span className="fkw-stage">
          {STAGE_LABEL[WAYBILL_STAGE_ORDER[Math.max(0, currentIdx)]]}
        </span>
      )}
      {holder === 'done'
        ? <span className="fkw-chip done">Complete</span>
        : live && <span className="fkw-livedot" title="Live — updates as the other board moves" />}
    </div>
  );
}

const STRIP_CSS = `
.fkw{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:10px;
  background:#0B1428;min-width:0}
.fkw-compact{padding:5px 9px;gap:7px}
.fkw-code{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:9px;font-weight:700;
  letter-spacing:.08em;color:${VOLT};flex-shrink:0}
.fkw-track{display:flex;align-items:center;flex:1;min-width:80px}
.fkw-dot{width:7px;height:7px;border-radius:50%;background:#26344F;flex-shrink:0;cursor:help;
  transition:background .45s ease,box-shadow .45s ease}
.fkw-dot.on{background:${VOLT};box-shadow:0 0 8px rgba(180,255,68,.55)}
.fkw-dot.ping{animation:fkwping 1.3s ease-out 1}
.fkw-line{flex:1;height:1.5px;min-width:5px;background:#26344F;margin:0 2px;transition:background .45s ease}
.fkw-line.on{background:${VOLT}}
@keyframes fkwping{0%{transform:scale(1);box-shadow:0 0 0 0 rgba(180,255,68,.85)}
  70%{transform:scale(1.7);box-shadow:0 0 0 9px rgba(180,255,68,0)}
  100%{transform:scale(1);box-shadow:0 0 8px rgba(180,255,68,.55)}}
.fkw-stage{font-size:8.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:#93A5CB;
  white-space:nowrap}
.fkw-chip{font-size:8px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;
  padding:2px 6px;border-radius:8px;white-space:nowrap}
.fkw-chip.done{color:#0B1428;background:${VOLT}}
.fkw-livedot{width:6px;height:6px;border-radius:50%;background:${VOLT};flex-shrink:0;
  animation:fkwblink 2s infinite}
@keyframes fkwblink{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion: reduce){.fkw *{animation:none !important;transition:none !important}}
`;
