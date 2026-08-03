import React, { memo } from 'react';
import { Trash2 } from 'lucide-react';
import {
  RAIL_ACCENT_BORDER,
  RAIL_DENSITY,
  RAIL_HAIRLINE_BORDER,
  RAIL_MOTION,
  RAIL_TONES,
  type BoardDensity,
} from './railTokens';
import type { RailTileModel } from './railMapping';

/**
 * Image-first tile per the Halo master spec's reference component.
 * Every class marked CONTAIN stops horizontal bleed — load-bearing,
 * do not remove during styling passes.
 */
export const RailTile = memo(function RailTile({
  tile,
  density = 'comfortable',
  onOpen,
  onClear,
}: {
  tile: RailTileModel;
  density?: BoardDensity;
  onOpen: () => void;
  onClear?: () => void;
}) {
  const t = RAIL_TONES[tile.tone];
  const d = RAIL_DENSITY[density];

  return (
    <div
      className={[
        // CONTAIN — shrink-0 stops flex squeeze; clamp survives 320px.
        'group relative shrink-0 w-[clamp(150px,44vw,190px)] snap-start lg:w-full',
        'min-w-0',
      ].join(' ')}
    >
      <button
        type="button"
        data-testid={`rail-tile-${tile.cardKey}`}
        onClick={onOpen}
        className={[
          'block w-full min-w-0 text-left rounded-2xl overflow-hidden bg-white dark:bg-stone-900',
          tile.accent ? RAIL_ACCENT_BORDER : RAIL_HAIRLINE_BORDER,
          RAIL_MOTION,
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#9DB40F]',
        ].join(' ')}
      >
        <div className={`relative ${d.artwork} ${t.panel}`}>
          {tile.artworkUrl && (
            <img
              src={tile.artworkUrl}
              alt=""
              loading="lazy"
              decoding="async"
              /* CONTAIN — object-cover + absolute inset holds any aspect ratio. */
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {tile.chip && (
            <span
              className={[
                'absolute bottom-2.5 left-2.5 max-w-[calc(100%-20px)] truncate',
                'rounded-full bg-white/95 dark:bg-stone-900/95 px-2.5 py-1',
                'text-[11px] font-medium',
                t.chip,
              ].join(' ')}
            >
              {tile.chip}
            </span>
          )}
          {tile.unread > 0 && (
            <span
              className="absolute top-2 left-2 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#FF3B30] px-1 text-[10px] font-bold text-white"
              data-testid={`rail-tile-unread-${tile.cardKey}`}
            >
              {tile.unread}
            </span>
          )}
        </div>

        {/* CONTAIN — min-w-0 again; flex/grid children default min-width:auto. */}
        <div className={`min-w-0 ${d.body}`}>
          <p className={`truncate ${d.title} text-stone-900 dark:text-stone-50`}>{tile.title}</p>
          <p className={`mt-0.5 truncate ${d.subtitle} text-stone-500 dark:text-stone-400`}>
            {tile.subtitle ?? '\u00A0'}
          </p>
        </div>
      </button>

      {onClear && (
        <button
          type="button"
          aria-label="Clear card to history"
          data-testid={`rail-tile-clear-${tile.cardKey}`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          /* Touch has no hover: keep the button visible on phones, reveal on
             hover/focus only where a pointer exists. Never an invisible hotspot. */
          className="absolute right-2 top-2 rounded-full bg-white/90 dark:bg-stone-900/90 p-1.5 text-stone-400 transition-opacity opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 hover:text-stone-700 dark:hover:text-stone-200"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
