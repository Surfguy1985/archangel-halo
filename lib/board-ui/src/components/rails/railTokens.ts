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
  // Brand lime — the one accent, reserved for cards waiting on the viewer.
  // `chip` renders on an always-white pill (dark text, no dark variant);
  // `rowStatus` renders directly on office rows (needs dark-mode variants).
  action: {
    panel: 'bg-[#B4FF44]',
    body: 'bg-[#B4FF44]',
    title: 'text-black',
    subtitle: 'text-black/65',
    chip: 'text-[#55660a]',
    rowStatus: 'text-[#55660a] dark:text-[#D8F84E]',
  },
  active: {
    panel: 'bg-[#79B8F3]',
    body: 'bg-[#466B8D]',
    title: 'text-white',
    subtitle: 'text-white/75',
    chip: 'text-stone-700',
    rowStatus: 'text-stone-700 dark:text-stone-300',
  },
  done: {
    panel: 'bg-[#79B8F3]',
    body: 'bg-[#466B8D]',
    title: 'text-white',
    subtitle: 'text-white/75',
    chip: 'text-emerald-800',
    rowStatus: 'text-emerald-800 dark:text-emerald-200',
  },
  warning: {
    panel: 'bg-[#79B8F3]',
    body: 'bg-[#466B8D]',
    title: 'text-white',
    subtitle: 'text-white/75',
    chip: 'text-amber-900',
    rowStatus: 'text-amber-900 dark:text-amber-200',
  },
};

/** Accent border — ONLY for tiles in the Needs you rail. */
export const RAIL_ACCENT_BORDER = 'border-2 border-[#9DB40F] dark:border-[#D8F84E]';
export const RAIL_HAIRLINE_BORDER = 'border-[0.5px] border-stone-200 dark:border-stone-700';

/** Type scale + spacing per density. Compact feeds the office rows task. */
export const RAIL_DENSITY: Record<
  BoardDensity,
  { title: string; subtitle: string; railLabel: string; artwork: string; body: string }
> = {
  comfortable: {
    title: 'text-[20px] font-medium leading-tight tabular-nums',
    subtitle: 'text-[13px]',
    railLabel: 'text-[13px] font-semibold',
    artwork: 'h-[92px] lg:h-[110px]',
    body: 'px-3.5 pb-3.5 pt-2.5',
  },
  compact: {
    title: 'text-[14px] font-medium leading-tight tabular-nums',
    subtitle: 'text-[12px]',
    railLabel: 'text-[12px] font-semibold',
    artwork: 'h-[52px]',
    body: 'px-2.5 pb-2 pt-1.5',
  },
};

/** 3px status spine on compact office rows — solid echo of the tone. */
export const ROW_SPINE: Record<RailTone, string> = {
  action: 'bg-[#9DB40F] dark:bg-[#D8F84E]',
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
