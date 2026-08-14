/**
 * ClientEvidenceCard — before/after photo evidence lens (read-only).
 * Derives photos from board card projection. Full-screen overlay on tap.
 * Client-safe: no approve/reject actions, GPS/checklist badge only.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { type ClientBoardCardView, type ClientBoardPhoto } from '@workspace/api-client-react';
import { Camera, X, ChevronLeft, ChevronRight, ImageOff } from 'lucide-react';

type Props = {
  unitLabel?: string;
  cards: ClientBoardCardView[];
};

type PhotoPair = {
  cardTitle: string;
  unitNo?: string;
  before: ClientBoardPhoto[];
  after: ClientBoardPhoto[];
};

function splitPhases(photos: ClientBoardPhoto[]): { before: ClientBoardPhoto[]; after: ClientBoardPhoto[] } {
  const before: ClientBoardPhoto[] = [];
  const after: ClientBoardPhoto[] = [];
  for (const p of photos) {
    const phase = (p.phase ?? '').toLowerCase();
    if (phase.includes('after') || phase.includes('complete')) after.push(p);
    else before.push(p);
  }
  return { before, after };
}

export function ClientEvidenceCard({ unitLabel, cards }: Props) {
  const [lightbox, setLightbox] = useState<{ photos: ClientBoardPhoto[]; idx: number } | null>(null);

  const closeLightbox = useCallback(() => setLightbox(null), []);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { closeLightbox(); return; }
      if (e.key === 'ArrowLeft') setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l);
      if (e.key === 'ArrowRight') setLightbox(l => l && l.idx < l.photos.length - 1 ? { ...l, idx: l.idx + 1 } : l);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, closeLightbox]);

  // Filter cards to those with photos and matching unit if specified
  const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  const relevant = cards.filter(c => {
    if (!c.photos?.length) return false;
    if (!unitLabel) return true;
    if (c.unitNo && norm(c.unitNo) === norm(unitLabel)) return true;
    if (c.title.toLowerCase().includes(norm(unitLabel))) return true;
    return false;
  });

  const pairs: PhotoPair[] = relevant.map(c => ({
    cardTitle: c.title,
    unitNo: c.unitNo ?? undefined,
    ...splitPhases(c.photos),
  }));

  if (pairs.length === 0) {
    return (
      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl px-4 py-5 flex items-center gap-3 mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <ImageOff className="w-4 h-4 text-white/25 shrink-0" />
        <span className="text-[12.5px] text-white/40">
          {unitLabel ? `No photos found for Unit ${unitLabel}.` : 'No job photos found.'}
        </span>
      </div>
    );
  }

  const allPhotos = pairs.flatMap(p => [...p.before, ...p.after]);

  return (
    <>
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo evidence viewer"
          className="fixed inset-0 z-[200] bg-black/92 flex items-center justify-center"
          style={{ animation: 'h1MsgIn 0.15s ease-out both' }}
        >
          <button
            type="button"
            onClick={closeLightbox}
            aria-label="Close photo viewer"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 grid place-items-center text-white hover:bg-white/20 transition-colors z-10 focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setLightbox(l => l && l.idx > 0 ? { ...l, idx: l.idx - 1 } : l)}
            disabled={lightbox.idx === 0}
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 grid place-items-center text-white hover:bg-white/20 transition-colors disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <img src={lightbox.photos[lightbox.idx]?.url} alt={`Job evidence photo ${lightbox.idx + 1} of ${lightbox.photos.length}`}
            className="max-w-full max-h-[85dvh] rounded-xl object-contain" />
          <button
            type="button"
            onClick={() => setLightbox(l => l && l.idx < l.photos.length - 1 ? { ...l, idx: l.idx + 1 } : l)}
            disabled={lightbox.idx === lightbox.photos.length - 1}
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 grid place-items-center text-white hover:bg-white/20 transition-colors disabled:opacity-20 focus-visible:ring-2 focus-visible:ring-white/60 outline-none"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
            {lightbox.photos.map((_, i) => (
              <button key={i} onClick={() => setLightbox(l => l ? { ...l, idx: i } : l)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === lightbox.idx ? 'bg-white' : 'bg-white/30'}`} />
            ))}
          </div>
          {lightbox.photos[lightbox.idx]?.phase && (
            <div className="absolute top-4 left-4 px-2 py-1 rounded bg-black/60 text-[10px] font-bold uppercase text-white/70">
              {lightbox.photos[lightbox.idx].phase}
            </div>
          )}
        </div>
      )}

      <div className="bg-[#0C1B30] border border-white/7 rounded-2xl overflow-hidden mb-3" style={{ animation: 'h1MsgIn 0.22s ease-out both' }}>
        <div className="px-4 pt-3.5 pb-2.5 border-b border-white/5 flex items-center gap-2">
          <Camera className="w-3 h-3 text-white/40 shrink-0" />
          <span className="text-[9.5px] font-bold tracking-[0.2em] uppercase text-white/30">
            Evidence Photos
          </span>
          <span className="ml-auto text-[10px] text-white/20">{allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}</span>
        </div>

        {pairs.map((pair, pi) => (
          <div key={pi} className={pi > 0 ? 'border-t border-white/[0.04]' : ''}>
            <div className="px-4 pt-3 pb-1">
              <span className="text-[11.5px] font-semibold text-white/55">{pair.cardTitle}</span>
              {pair.unitNo && <span className="text-[10.5px] text-white/30 ml-1.5">· Unit {pair.unitNo}</span>}
            </div>
            {(pair.before.length > 0 || pair.after.length > 0) && (
              <div className="px-4 pb-3 grid grid-cols-2 gap-2">
                {/* Before column */}
                <div>
                  {pair.before.length > 0 ? (
                    <>
                      <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-white/25 mb-1.5">Before</div>
                      <div className="grid gap-1.5">
                        {pair.before.slice(0, 2).map((photo, i) => {
                          const globalIdx = allPhotos.indexOf(photo);
                          return (
                            <button key={i} onClick={() => setLightbox({ photos: allPhotos, idx: globalIdx })}
                              className="relative rounded-xl overflow-hidden aspect-square bg-white/5 hover:opacity-85 transition-opacity active:scale-[0.97]">
                              <img src={photo.url} alt="Before" className="w-full h-full object-cover" />
                            </button>
                          );
                        })}
                        {pair.before.length > 2 && (
                          <button onClick={() => setLightbox({ photos: allPhotos, idx: allPhotos.indexOf(pair.before[2]) })}
                            className="relative rounded-xl overflow-hidden aspect-square bg-white/5 hover:opacity-85 transition-opacity text-white/40 text-[12px] font-bold">
                            +{pair.before.length - 2}
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="aspect-square rounded-xl bg-white/[0.03] border border-white/5 grid place-items-center">
                      <span className="text-[9px] text-white/20">No before</span>
                    </div>
                  )}
                </div>
                {/* After column */}
                <div>
                  {pair.after.length > 0 ? (
                    <>
                      <div className="text-[9px] font-bold tracking-[0.14em] uppercase text-[#22C55E]/40 mb-1.5">After</div>
                      <div className="grid gap-1.5">
                        {pair.after.slice(0, 2).map((photo, i) => {
                          const globalIdx = allPhotos.indexOf(photo);
                          return (
                            <button key={i} onClick={() => setLightbox({ photos: allPhotos, idx: globalIdx })}
                              className="relative rounded-xl overflow-hidden aspect-square bg-white/5 hover:opacity-85 transition-opacity active:scale-[0.97]">
                              <img src={photo.url} alt="After" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 border-2 border-[#22C55E]/25 rounded-xl pointer-events-none" />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <div className="aspect-square rounded-xl bg-white/[0.03] border border-white/5 grid place-items-center">
                      <span className="text-[9px] text-white/20">No after yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
