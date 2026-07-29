import { TEMPLATES } from './ref-templates';

// Reference color system: each category has an oklch hue; the accent and every
// card surface tint are derived from it (matches the fixed-seed reference).
const CATEGORY_HUES: Record<string, number> = {
  maintenance: 250,
  money: 155,
  vendor: 300,
  compliance: 32,
  leasing: 212,
  access: 112,
  people: 335,
  intel: 277,
};

const accentFor = (h: number) => `oklch(0.54 0.14 ${h})`;

const CATEGORY_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_HUES).map(([k, h]) => [k, accentFor(h)]),
);

/** Mix the accent into white at pct% — the reference's card surface scale. */
export const mixp = (accent: string, pct: number) =>
  `color-mix(in oklab, ${accent} ${pct}%, #ffffff)`;

export interface CardTint {
  bg: string;
  bd: string;
  track: string;
  chip: string;
  foot: string;
  hair: string;
  stageBg: string;
  stageFg: string;
}

/** Full-card tint set per the reference: bg 7%, border 20%, track 22%, chip 16%, footer 11%, hairline 12%, stage 15%. */
export function cardTint(spec: TemplateSpec): CardTint {
  const a = spec.accent;
  const h = CATEGORY_HUES[spec.categoryLabel] ?? 277;
  return {
    bg: mixp(a, 7),
    bd: mixp(a, 20),
    track: mixp(a, 22),
    chip: mixp(a, 16),
    foot: mixp(a, 11),
    hair: mixp(a, 12),
    stageBg: mixp(a, 15),
    stageFg: `oklch(0.40 0.11 ${h})`,
  };
}

export const TONES = {
  good: '#1f7a52',
  warn: '#a86c14',
  bad: '#a5311f',
  ink: '#101c33',
  mute: '#6e6c63',
} as const;

export function heatColor(pct: number): string {
  if (pct < 62) return '#1f7a52';
  if (pct < 85) return '#b8891a';
  if (pct < 100) return '#c25a1e';
  return '#a5311f';
}

export const PRIORITY_CHIP: Record<string, { bg: string; fg: string }> = {
  urgent: { bg: '#f7e2de', fg: '#96281b' },
  high: { bg: '#faebdc', fg: '#8e4416' },
  medium: { bg: '#f5f0d9', fg: '#77610f' },
  normal: { bg: '#f5f0d9', fg: '#77610f' },
  low: { bg: '#edebe4', fg: '#6e6c63' },
  none: { bg: '#edebe4', fg: '#8c8a81' },
};

export type MetricTone = 'good' | 'warn' | 'bad' | 'ink' | 'mute';

export interface TemplateSpec {
  key: string;
  name: string;
  categoryLabel: string;
  accent: string;
  codePrefix: string;
  slaTargetDays: number;
  pipeline: string[];
}

export const TEMPLATE_SPECS: Record<string, TemplateSpec> = {};

for (const [k, v] of Object.entries(TEMPLATES)) {
  TEMPLATE_SPECS[k] = {
    key: k,
    name: v.name,
    categoryLabel: v.category,
    accent: CATEGORY_COLORS[v.category] ?? '#101c33',
    codePrefix: k.substring(0, 4).toUpperCase(),
    slaTargetDays: (v.sla || 1440) / 1440, // convert minutes to days roughly
    pipeline: v.pipeline,
  };
}

// The API emits its own template ids — map them onto the reference registry.
const API_TEMPLATE_ALIASES: Record<string, string> = {
  job: 'wo',
  request: 'wo',
  makeready: 'makeready',
  invoice: 'invoice',
  crew: 'crew',
};

// Client-created custom cards have a simple Open/Done pipeline.
TEMPLATE_SPECS['custom'] = {
  key: 'custom',
  name: 'Custom Card',
  categoryLabel: 'intel',
  accent: CATEGORY_COLORS['intel'],
  codePrefix: 'CARD',
  slaTargetDays: 3,
  pipeline: ['Open', 'Done'],
};

export function specFor(template: string | null | undefined): TemplateSpec {
  const key = template ?? 'wo';
  return (
    TEMPLATE_SPECS[key] ?? TEMPLATE_SPECS[API_TEMPLATE_ALIASES[key] ?? 'wo'] ?? TEMPLATE_SPECS['wo']
  );
}

export function derived(accent: string) {
  const mix = (pct: number) => `color-mix(in srgb, ${accent} ${pct}%, #ffffff)`;
  return {
    cardBg: mix(7),
    border: mix(20),
    railTrack: mix(22),
    unitChip: mix(16),
    footer: mix(11),
    hairline: mix(12),
  };
}
