import React, { memo } from 'react';
import { Trash2 } from 'lucide-react';
import {
  RAIL_ACCENT_BORDER,
  RAIL_DENSITY,
  RAIL_MOTION,
  RAIL_TONES,
  type BoardDensity,
} from './railTokens';
import { RAIL_STAGE_STYLE, type RailKey, type RailTileModel } from './railMapping';

/** Looping stage-icon animations — injected once, shared by every tile. */
const STAGE_ART_KEYFRAMES = `
@keyframes rail-icon-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.12); } }
@keyframes rail-icon-sway { 0%,100% { transform: rotate(-9deg); } 50% { transform: rotate(9deg); } }
@keyframes rail-icon-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes rail-icon-blink { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes rail-check-draw {
  0% { stroke-dashoffset: 48; opacity: 1; }
  38% { stroke-dashoffset: 0; opacity: 1; }
  78% { stroke-dashoffset: 0; opacity: 1; }
  92% { stroke-dashoffset: 0; opacity: 0; }
  100% { stroke-dashoffset: 48; opacity: 0; }
}
.rail-icon-pulse { animation: rail-icon-pulse 2.6s ease-in-out infinite; }
.rail-icon-sway { animation: rail-icon-sway 2.8s ease-in-out infinite; transform-origin: 50% 50%; }
.rail-icon-float { animation: rail-icon-float 3s ease-in-out infinite; }
.rail-icon-blink { animation: rail-icon-blink 1.6s ease-in-out infinite; }
.rail-check-path { stroke-dasharray: 48; stroke-dashoffset: 48; animation: rail-check-draw 2.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .rail-icon-pulse, .rail-icon-sway, .rail-icon-float, .rail-icon-blink { animation: none; }
  .rail-check-path { animation: none; stroke-dashoffset: 0; }
}
`;

let stageArtStylesInjected = false;
function ensureStageArtStyles() {
  if (stageArtStylesInjected || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.setAttribute('data-rail-stage-art', '');
  el.textContent = STAGE_ART_KEYFRAMES;
  document.head.appendChild(el);
  stageArtStylesInjected = true;
}

/** One simple line icon per rail, drawn inline so the check can animate. */
function StageIcon({ rail, color }: { rail: RailKey; color: string }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (rail) {
    case 'requested':
      return (
        <svg {...common}>
          <rect x="5" y="4" width="14" height="17" rx="2" />
          <path d="M9 4.5V3h6v1.5" />
          <path d="M9 10h6M9 14h6M9 18h4" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...common}>
          <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z" />
        </svg>
      );
    case 'done':
      return (
        <svg {...common} strokeWidth={2.6}>
          <path className="rail-check-path" pathLength={48} d="M4.5 12.5l5 5L19.5 6.5" />
        </svg>
      );
    case 'paid':
      return (
        <svg {...common}>
          <path d="M12 2.5v19" />
          <path d="M16.5 5.5H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7" />
        </svg>
      );
    case 'needs_you':
      return (
        <svg {...common}>
          <path d="M12 3.5 2.8 19.5h18.4L12 3.5z" />
          <path d="M12 9.5v4.5" />
          <path d="M12 17.2h.01" />
        </svg>
      );
  }
}

/** Watch-icon plate — saturated field, one centered glyph. */
export function StageArtPanel({ rail, testId, bg }: { rail: RailKey; testId?: string; bg?: string }) {
  const s = RAIL_STAGE_STYLE[rail];
  ensureStageArtStyles();
  return (
    <div className="cb-watch-icon" style={{ background: bg ?? s.bg }} data-testid={testId}>
      <span className="cb-watch-icon-glyph" style={{ background: s.badgeBg }}>
        <span className={s.motion ? `inline-flex ${s.motion}` : 'inline-flex'}>
          <StageIcon rail={rail} color={s.icon} />
        </span>
      </span>
    </div>
  );
}

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
  ensureStageArtStyles();

  // Invoice ready for payment: flash a green border until the client picks
  // how they'll pay (check in the mail / their payment platform).
  const m: any = tile.card?.module ?? null;
  const invoiceReady =
    !!m &&
    m.type === 'invoice' &&
    String(m.status ?? '').toLowerCase() !== 'paid' &&
    !m.paymentChoice &&
    !m.clientPaidAt;

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
          'cb-rail-tile block w-full min-w-0 text-left',
          t.body,
          tile.accent ? RAIL_ACCENT_BORDER : '',
          RAIL_MOTION,
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B4FF44]',
          invoiceReady ? 'animate-pulse ring-2 ring-[#B4FF44]' : '',
        ].join(' ')}
        data-invoice-ready={invoiceReady ? 'true' : undefined}
      >
        <div className={`relative ${d.artwork} ${t.panel}`}>
          {tile.artworkUrl ? (
            <img
              src={tile.artworkUrl}
              alt=""
              loading="lazy"
              decoding="async"
              /* CONTAIN — object-cover + absolute inset holds any aspect ratio. */
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <StageArtPanel rail={tile.rail} />
          )}
          {/* Walk badge takes precedence over change-order banner — only one
              can show at a time; walk cards never have a change order. */}
          {tile.walkBadge && (
            <span
              className="absolute top-0 left-0 right-0 flex items-center justify-center gap-1 bg-[#B4FF44] px-2 py-[3px] text-[9px] font-extrabold uppercase tracking-[0.12em] text-black"
              data-testid={`rail-tile-walk-badge-${tile.cardKey}`}
            >
              {/* Footprints icon inline */}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M7.5 6.5C7.5 8.43 6.5 10 5 10s-2.5-1.57-2.5-3.5S3.5 3 5 3s2.5 1.57 2.5 3.5zm9 0C16.5 8.43 15.5 10 14 10s-2.5-1.57-2.5-3.5S12.5 3 14 3s2.5 1.57 2.5 3.5zM5 11c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4zm9 0c-.29 0-.62.02-.97.05C14.19 11.89 15 13.1 15 14.5V17h6v-2c0-2.66-5.33-4-8-4z"/>
              </svg>
              Walk
            </span>
          )}
          {!tile.walkBadge && tile.card?.changeOrder && (
            <span
              className="absolute top-0 left-0 right-0 bg-amber-400 px-2.5 py-0.5 text-center text-[10px] font-bold uppercase tracking-widest text-black"
              data-testid={`rail-tile-change-order-${tile.cardKey}`}
            >
              Change order
            </span>
          )}
          {tile.chip && (
            <span
              className={[
                'absolute bottom-2.5 left-2.5 max-w-[calc(100%-20px)] truncate',
                'rounded-full bg-black/28 px-2.5 py-1 backdrop-blur-md',
                'text-[11px] font-semibold text-white',
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
          <p className={`truncate ${d.title} ${t.title}`}>{tile.title}</p>
          <p className={`mt-0.5 truncate ${d.subtitle} ${t.subtitle}`}>
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
          className="absolute right-2 top-2 rounded-full bg-black/35 p-1.5 text-white/70 backdrop-blur-md transition-opacity opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100 hover:text-white"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
});
