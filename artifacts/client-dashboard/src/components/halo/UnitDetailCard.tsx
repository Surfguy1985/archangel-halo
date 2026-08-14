/**
 * UnitDetailCard — inline unit status lens.
 * Derives data from the board card projection filtered by unit label.
 * Client-safe: shows crew first name only, no rates or economic data.
 */
import React, { useState } from 'react';
import { type ClientBoardCardView } from '@workspace/api-client-react';
import { Home, Camera, Wrench, CheckCircle2, Clock, Loader2, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { RequestWorkDialog } from '@/components/RequestWorkDialog';

const STATUS_COLOR: Record<string, string> = {
  in_progress: '#3B82F6',
  scheduled: '#22C55E',
  review: '#F59E0B',
  requested: '#6366F1',
  alerts: '#E11D48',
  done: '#22C55E',
};

type Props = {
  unitLabel: string;
  cards: ClientBoardCardView[];
  token: string;
  permissions: string[];
  onRequestWork?: (unitNo: string) => void;
};

export function UnitDetailCard({ unitLabel, cards, token, permissions }: Props) {
  const hasFinancialAccess = permissions.includes('invoices') || permissions.includes('financial');
  const [photoIdx, setPhotoIdx] = useState(0);
  const [workDialogOpen, setWorkDialogOpen] = useState(false);

  // Find the most relevant card for this unit
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const card = cards.find(c => {
    if (!c.unitNo) return false;
    return norm(c.unitNo) === norm(unitLabel);
  }) ?? cards.find(c => {
    if (!c.title) return false;
    return c.title.toLowerCase().includes(norm(unitLabel));
  });

  if (!card) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-5 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <div className="flex items-center gap-2 mb-1">
          <Home className="w-3.5 h-3.5 text-white/30" />
          <span className="text-[12px] font-bold text-white/50">Unit {unitLabel}</span>
        </div>
        <p className="text-[12.5px] text-white/35">No active work found for Unit {unitLabel}.</p>
        <button
          onClick={() => setWorkDialogOpen(true)}
          className="mt-3 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#0A0F1A] text-[11.5px] font-bold hover:bg-white/92 active:scale-[0.97] transition-all">
          <Wrench className="w-3 h-3" /> Request work
        </button>
        <RequestWorkDialog
          token={token}
          open={workDialogOpen}
          onOpenChange={setWorkDialogOpen}
          initialUnits={[unitLabel]}
        />
      </div>
    );
  }

  const laneColor = STATUS_COLOR[card.lane] ?? '#B4FF44';
  const statusLabel = card.status ?? card.lane?.replace(/_/g, ' ') ?? 'Active';
  const crewFirstName = card.crew?.name ? card.crew.name.split(' ')[0] : null;
  const photos = card.photos ?? [];
  const visiblePhoto = photos[photoIdx];

  // Checklist progress
  const checklist = card.checklist ?? [];
  const doneCount = checklist.filter(i => i.done).length;
  const checklistPct = checklist.length > 0 ? Math.round((doneCount / checklist.length) * 100) : null;

  return (
    <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-3 border-b border-white/5">
        <div className="flex items-start gap-3">
          <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: laneColor }} />
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-bold text-white/90 leading-snug">{card.title}</div>
            {card.unitNo && (
              <div className="text-[11px] text-white/35 mt-0.5">Unit {card.unitNo}</div>
            )}
          </div>
          <span className="px-2.5 py-1 rounded-full text-[10.5px] font-semibold capitalize border"
            style={{ background: `${laneColor}15`, color: laneColor, borderColor: `${laneColor}30` }}>
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Details grid */}
      <div className="px-4 py-3 grid grid-cols-2 gap-3">
        {crewFirstName && (
          <div>
            <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Crew</div>
            <div className="text-[12.5px] font-semibold text-white/75">
              {crewFirstName}
              {card.crew?.onSite && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[8.5px] font-bold bg-[#22C55E]/12 text-[#22C55E]/80 border border-[#22C55E]/20">On site</span>
              )}
            </div>
          </div>
        )}
        {card.scheduledOn && (
          <div>
            <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Scheduled</div>
            <div className="text-[12.5px] font-semibold text-white/75 flex items-center gap-1">
              <Clock className="w-3 h-3 text-white/30 shrink-0" />
              {card.scheduledOn}
            </div>
          </div>
        )}
        {checklistPct !== null && (
          <div>
            <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Progress</div>
            <div className="text-[12.5px] font-semibold text-white/75 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden">
                <div className="h-full rounded-full bg-[#B4FF44]" style={{ width: `${checklistPct}%` }} />
              </div>
              <span className="shrink-0">{checklistPct}%</span>
            </div>
          </div>
        )}
        {hasFinancialAccess && card.amount != null && card.amount > 0 && (
          <div>
            <div className="text-[9.5px] font-bold tracking-[0.16em] uppercase text-white/25 mb-0.5">Amount</div>
            <div className="text-[12.5px] font-semibold text-white/75 tabular-nums">${card.amount.toLocaleString()}</div>
          </div>
        )}
      </div>

      {/* Photo strip */}
      {photos.length > 0 && (
        <div className="px-4 pb-3">
          <div className="relative rounded-xl overflow-hidden bg-white/5 aspect-video">
            <img src={visiblePhoto.url} alt="Job photo"
              className="w-full h-full object-cover" onError={e => (e.currentTarget.style.display = 'none')} />
            {photos.length > 1 && (
              <>
                <button onClick={() => setPhotoIdx(p => Math.max(0, p - 1))} disabled={photoIdx === 0}
                  className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 grid place-items-center disabled:opacity-20 text-white">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setPhotoIdx(p => Math.min(photos.length - 1, p + 1))} disabled={photoIdx === photos.length - 1}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/50 grid place-items-center disabled:opacity-20 text-white">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex gap-1">
                  {photos.slice(0, 5).map((_, i) => (
                    <div key={i} className={`w-1 h-1 rounded-full transition-colors ${i === photoIdx ? 'bg-white' : 'bg-white/30'}`} />
                  ))}
                </div>
              </>
            )}
            {visiblePhoto.phase && (
              <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-black/60 text-white/75">{visiblePhoto.phase}</span>
            )}
          </div>
          <div className="text-[10px] text-white/25 mt-1 flex items-center gap-1">
            <Camera className="w-2.5 h-2.5" /> {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* CTA */}
      <div className="px-4 pb-4 flex gap-2">
        <button
          onClick={() => setWorkDialogOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#0A0F1A] text-[11.5px] font-bold hover:bg-white/92 active:scale-[0.97] transition-all">
          <Wrench className="w-3 h-3" /> Request work
        </button>
      </div>

      {/* Inline work-request wizard — opens as a dialog over the chat */}
      <RequestWorkDialog
        token={token}
        open={workDialogOpen}
        onOpenChange={setWorkDialogOpen}
        initialUnits={card.unitNo ? [card.unitNo] : [unitLabel]}
      />
    </div>
  );
}
