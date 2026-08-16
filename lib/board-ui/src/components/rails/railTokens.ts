/**
 * Shared board tokens — one file drives both the client tiles and the
 * (future) office rows via the density switch. Structure follows the Halo
 * master spec (Apple restraint, tabular numerals, one accent); colors map
 * onto the HALO/Falkon palette instead of the spec's stock sky/stone.
 */

export type BoardDensity = 'comfortable' | 'compact';

export type RailTone = 'action' | 'active' | 'done' | 'warning';

/**
 * Two-tone client scheme: tiles waiting on the viewer are LIME with BLACK
 * text; every other tile is BABY BLUE with WHITE text. The chip pill stays
 * white so status text keeps its tone color for scanning.
 */
export const RAIL_TONES: Record<
  RailTone,
  { panel: string; body: string; title: string; subtitle: string; chip: string; rowStatus: string }
> = {
  // ALERTS red — cards waiting on the viewer (past-due invoices, approvals).
  // `chip` renders on an always-white pill (dark text, no dark variant);
  // `rowStatus` renders directly on office rows (needs dark-mode variants).
  action: {
    panel: '',
    body: '',
    title: 'text-white',
    subtitle: 'text-white/62',
    chip: 'text-[#B91C1C]',
    rowStatus: 'text-[#F87171]',
  },
  active: {
    panel: '',
    body: '',
    title: 'text-white',
    subtitle: 'text-white/62',
    chip: 'text-[#0A84FF]',
    rowStatus: 'text-white/70',
  },
  done: {
    panel: '',
    body: '',
    title: 'text-white',
    subtitle: 'text-white/62',
    chip: 'text-[#14532D]',
    rowStatus: 'text-[#B4FF44]',
  },
  warning: {
    panel: '',
    body: '',
    title: 'text-white',
    subtitle: 'text-white/62',
    chip: 'text-[#40361F]',
    rowStatus: 'text-[#C9A227]',
  },
};

/** Accent border — ONLY for tiles in the Alerts rail. */
export const RAIL_ACCENT_BORDER = 'border border-[#C23B22]/70';
export const RAIL_HAIRLINE_BORDER = 'border border-white/[0.09]';

/** Type scale + spacing per density. Compact feeds the office rows task. */
export const RAIL_DENSITY: Record<
  BoardDensity,
  { title: string; subtitle: string; railLabel: string; artwork: string; body: string }
> = {
  comfortable: {
    title: 'text-[15px] font-semibold leading-tight tracking-tight tabular-nums',
    subtitle: 'text-[12px]',
    railLabel: 'cb-rail-label',
    artwork: 'h-[108px] lg:h-[118px]',
    body: 'px-3.5 pb-3.5 pt-2.5',
  },
  compact: {
    title: 'text-[13px] font-semibold leading-tight tracking-tight tabular-nums',
    subtitle: 'text-[11px]',
    railLabel: 'cb-rail-label',
    artwork: 'h-[64px]',
    body: 'px-2.5 pb-2 pt-1.5',
  },
};

/** 3px status spine on compact office rows — solid echo of the tone. */
export const ROW_SPINE: Record<RailTone, string> = {
  action: 'bg-[#DC2626] dark:bg-[#F87171]',
  active: 'bg-stone-300 dark:bg-stone-600',
  done: 'bg-emerald-500',
  warning: 'bg-amber-500',
};

/** Compact office row: fixed height, square corners, hairline dividers,
 *  hover is a background tint only. */
export const ROW_TOKENS = {
  height: 'h-[52px]',
  hover: 'hover:bg-stone-50 dark:hover:bg-stone-800/60',
  selected: 'bg-[#F5F9E0] dark:bg-[#2a3312]',
  divider: 'divide-y divide-stone-200 dark:divide-stone-700',
  amount: 'text-[14px] font-medium tabular-nums text-right',
  owner: 'text-[12px] text-stone-500 dark:text-stone-400',
};

/** One motion curve everywhere. */
export const RAIL_MOTION =
  'transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100';
