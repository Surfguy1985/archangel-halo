import React from 'react';
import { Loader2, Map as MapIcon } from 'lucide-react';
import { RailTile } from './RailTile';
import { RAIL_DENSITY, type BoardDensity } from './railTokens';
import { mapCardsToRails, RAIL_ORDER, type RailTileModel } from './railMapping';

/**
 * Five fixed rails, Halo master spec:
 * - Desktop (primary): five columns side by side, tiles stacked vertically.
 * - Phone: the same components as horizontal rails, stacked vertically —
 *   a flex-direction swap, not a second product.
 * Cards move themselves; there is no drag between rails.
 */

function Rail({
  railKey,
  label,
  empty,
  tiles,
  density,
  onOpenCard,
  onClearCard,
}: {
  railKey: string;
  label: string;
  empty: string;
  tiles: RailTileModel[];
  density: BoardDensity;
  onOpenCard: (card: any) => void;
  onClearCard?: (card: any) => void;
}) {
  const d = RAIL_DENSITY[density];
  if (!tiles.length) {
    // Empty rails collapse to one line — position teaches the pipeline.
    return (
      <section className="min-w-0 px-4 py-3 lg:px-0" data-testid={`rail-${railKey}`} data-rail-empty>
        <h2 className={`${d.railLabel} text-stone-900 dark:text-stone-50`}>{label}</h2>
        <p className="mt-1 text-[13px] text-stone-500 dark:text-stone-400">{empty}</p>
      </section>
    );
  }

  return (
    /* CONTAIN — min-w-0 on the section, or an overflow-x child inside a
       flex/grid parent scrolls the whole page instead of the rail. */
    <section className="min-w-0 py-3 lg:py-0" data-testid={`rail-${railKey}`}>
      <div className="flex items-baseline justify-between px-4 lg:px-0">
        <h2 className={`${d.railLabel} text-stone-900 dark:text-stone-50`}>{label}</h2>
        <span className="text-[13px] tabular-nums text-stone-400">{tiles.length}</span>
      </div>

      <div
        className={[
          'mt-2 flex gap-2.5',
          // CONTAIN — px-4 + -mx-4 full-bleed scroll with surviving edge
          // padding; scroll-px matches so snap doesn't clip the first card.
          'overflow-x-auto px-4 -mx-4 scroll-px-4',
          'snap-x snap-mandatory',
          // CONTAIN — stops rail-end swipes triggering iOS back-navigation.
          'overscroll-x-contain',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
          'pr-[max(1rem,env(safe-area-inset-right))]',
          // Desktop: same components as a vertical column.
          'lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:mx-0 lg:px-0 lg:pr-1 lg:max-h-[calc(100vh-260px)]',
        ].join(' ')}
      >
        {tiles.map((tile) => (
          <RailTile
            key={tile.cardKey}
            tile={tile}
            density={density}
            onOpen={() => onOpenCard(tile.card)}
            onClear={onClearCard ? () => onClearCard(tile.card) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

export interface RailsBoardProps {
  cards: any[] | undefined;
  isLoading?: boolean;
  density?: BoardDensity;
  onOpenCard: (card: any) => void;
  onClearCard?: (card: any) => void;
  onRequestWork?: () => void;
  onOpenMap?: () => void;
}

export function RailsBoard({
  cards,
  isLoading,
  density = 'comfortable',
  onOpenCard,
  onClearCard,
  onRequestWork,
  onOpenMap,
}: RailsBoardProps) {
  if (isLoading && !cards) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
      </div>
    );
  }
  const rails = mapCardsToRails(cards ?? []);

  return (
    /* CONTAIN — overflow-x-clip backstop: if one card ever escapes, the page
       still won't scroll sideways. */
    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-clip">
      <div className="mx-auto w-full max-w-[1400px] lg:px-6">
        {(onOpenMap || onRequestWork) && (
          <div className="hidden lg:flex items-center justify-end gap-2 pt-4">
            {onOpenMap && (
              <button
                type="button"
                data-testid="button-rails-map"
                onClick={onOpenMap}
                className="flex items-center gap-1.5 rounded-full border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-3.5 py-1.5 text-[12px] font-semibold text-stone-700 dark:text-stone-200 hover:bg-stone-50"
              >
                <MapIcon className="h-3.5 w-3.5" /> Live map
              </button>
            )}
            {onRequestWork && (
              <button
                type="button"
                data-testid="button-rails-request"
                onClick={onRequestWork}
                className="rounded-full bg-stone-900 dark:bg-stone-50 px-4 py-1.5 text-[12px] font-semibold text-white dark:text-stone-900 hover:opacity-90"
              >
                + Request work
              </button>
            )}
          </div>
        )}

        {/* Desktop: five columns. Phone: rails stack vertically. */}
        <div className="lg:mt-4 lg:grid lg:grid-cols-5 lg:gap-5">
          {RAIL_ORDER.map((r) => (
            <Rail
              key={r.key}
              railKey={r.key}
              label={r.label}
              empty={r.empty}
              tiles={rails[r.key]}
              density={density}
              onOpenCard={onOpenCard}
              onClearCard={onClearCard}
            />
          ))}
        </div>

        {/* Phone: primary action pinned within thumb reach. */}
        {onRequestWork && (
          <div className="sticky bottom-0 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-white via-white/95 to-transparent dark:from-stone-950 dark:via-stone-950/95 lg:hidden">
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="button-rails-request-mobile"
                onClick={onRequestWork}
                className="min-w-0 flex-1 rounded-xl bg-stone-900 dark:bg-stone-50 py-3.5 text-[15px] font-medium text-white dark:text-stone-900 transition-transform active:scale-[0.99]"
              >
                Request work
              </button>
              {onOpenMap && (
                <button
                  type="button"
                  aria-label="Live map"
                  data-testid="button-rails-map-mobile"
                  onClick={onOpenMap}
                  className="shrink-0 rounded-xl border border-stone-200 dark:border-stone-700 bg-white dark:bg-stone-900 px-4 text-stone-700 dark:text-stone-200"
                >
                  <MapIcon className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
