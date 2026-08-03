/**
 * Shared board tokens — one file drives both the client tiles and the
 * (future) office rows via the density switch. Structure follows the Halo
 * master spec (Apple restraint, tabular numerals, one accent); colors map
 * onto the HALO/Falkon palette instead of the spec's stock sky/stone.
 */

export type BoardDensity = 'comfortable' | 'compact';

export type RailTone = 'action' | 'active' | 'done' | 'warning';

/** Status-only color: panels tint by state, chips echo it, nothing else. */
export const RAIL_TONES: Record<RailTone, { panel: string; chip: string }> = {
  // Brand lime — the one accent, reserved for cards waiting on the viewer.
  action: {
    panel: 'bg-[#F5F9E0] dark:bg-[#2a3312]',
    chip: 'text-[#55660a] dark:text-[#D8F84E]',
  },
  active: {
    panel: 'bg-stone-100 dark:bg-stone-800',
    chip: 'text-stone-700 dark:text-stone-300',
  },
  done: {
    panel: 'bg-emerald-50 dark:bg-emerald-950/50',
    chip: 'text-emerald-800 dark:text-emerald-200',
  },
  warning: {
    panel: 'bg-amber-50 dark:bg-amber-950/50',
    chip: 'text-amber-900 dark:text-amber-200',
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

/** One motion curve everywhere. */
export const RAIL_MOTION =
  'transition-transform duration-150 ease-out active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100';
