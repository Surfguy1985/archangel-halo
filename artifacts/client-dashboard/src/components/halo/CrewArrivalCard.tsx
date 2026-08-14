/**
 * CrewArrivalCard — inline crew check-in status lens.
 * Derives from board card projection. Shows per-job crew first name + check-in status.
 * Client-safe: NO rates, NO pay info, NO crew contact details.
 */
import React from 'react';
import { type ClientBoardCardView } from '@workspace/api-client-react';
import { Users, CheckCircle2, Clock } from 'lucide-react';

type Props = {
  cards: ClientBoardCardView[];
};

function formatTime(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function CrewArrivalCard({ cards }: Props) {
  // Only cards that have a crew assigned and are active (not done)
  const activeCards = cards.filter(c => c.crew && c.lane !== 'done' && !c.snoozedUntil);

  return (
    <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
      <div className="px-4 pt-3.5 pb-2.5 border-b border-white/5 flex items-center gap-2">
        <Users className="w-3 h-3 text-[#22C55E]/60 shrink-0" />
        <span className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/30">Crew Status</span>
        <span className="ml-auto text-[10px] text-white/20">{activeCards.length} active job{activeCards.length !== 1 ? 's' : ''}</span>
      </div>

      {activeCards.length === 0 ? (
        <div className="px-4 py-4 flex items-center gap-2.5">
          <Clock className="w-4 h-4 text-white/25 shrink-0" />
          <span className="text-[12.5px] text-white/40">No active crew assignments right now.</span>
        </div>
      ) : (
        <div className="divide-y divide-white/[0.04]">
          {activeCards.map(card => {
            const crew = card.crew!;
            const firstName = crew.name.split(' ')[0];
            const onSite = crew.onSite ?? false;
            const lastSeenAt = crew.lastSeenAt;
            const arrivalTime = lastSeenAt ? formatTime(lastSeenAt) : null;
            const unitLabel = card.unitNo ? `Unit ${card.unitNo}` : (card.subtitle ?? card.title);

            return (
              <div key={card.cardKey} className="px-4 py-3.5 flex items-center gap-3">
                {/* Avatar / initial */}
                <div className="w-8 h-8 rounded-full shrink-0 overflow-hidden border border-white/10 bg-[#0A1628] grid place-items-center">
                  {crew.selfieUrl ? (
                    <img src={crew.selfieUrl} alt={firstName} className="w-full h-full object-cover"
                      onError={e => { e.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <span className="text-[12px] font-bold text-white/50">{firstName[0]}</span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-white/85 leading-snug">{firstName}</div>
                  <div className="text-[11px] text-white/38 truncate">{unitLabel}</div>
                </div>

                <div className="shrink-0 text-right">
                  {onSite ? (
                    <div className="flex items-center gap-1.5 justify-end">
                      <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
                      <span className="text-[11.5px] font-semibold text-[#22C55E]/80">
                        {arrivalTime ? `Arrived ${arrivalTime}` : 'On site'}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 justify-end">
                      <Clock className="w-3 h-3 text-white/30" />
                      <span className="text-[11.5px] text-white/38">Not yet checked in</span>
                    </div>
                  )}
                  {crew.trade && (
                    <div className="text-[10px] text-white/22 mt-0.5 capitalize">{crew.trade}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
