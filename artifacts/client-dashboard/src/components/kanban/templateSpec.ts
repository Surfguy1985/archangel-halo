// Distilled from attached_assets/halo-board-templates_*.json — the shared
// card anatomy and palette every board card must follow. Accent comes from
// the template; every card surface is derived from it.

export const TONES = {
  good: '#1f7a52',
  warn: '#a86c14',
  bad: '#a5311f',
  ink: '#101c33',
  mute: '#6e6c63',
} as const;

// SLA heat ramp: green under 62%, amber to 85%, orange to 100%, red past it.
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
  categoryLabel: string;
  accent: string; // category color from the template palette
  codePrefix: string;
  slaTargetDays: number; // drives the heat rail against dueOn/scheduledOn
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
}

// Template mapping: job→work_order, makeready→make_ready, invoice→invoice,
// crew→vendor_crew_live, request→work_order intake, custom→daily_operations.
export const TEMPLATE_SPECS: Record<string, TemplateSpec> = {
  job: {
    key: 'work_order',
    categoryLabel: 'Maintenance',
    accent: '#33639f',
    codePrefix: 'WO',
    slaTargetDays: 3,
  },
  makeready: {
    key: 'make_ready',
    categoryLabel: 'Maintenance',
    accent: '#33639f',
    codePrefix: 'TURN',
    slaTargetDays: 7,
  },
  invoice: {
    key: 'invoice',
    categoryLabel: 'Money',
    accent: '#1f7a52',
    codePrefix: 'INV',
    slaTargetDays: 30,
  },
  crew: {
    key: 'vendor_crew_live',
    categoryLabel: 'Vendor',
    accent: '#7a4a9e',
    codePrefix: 'CREW',
    slaTargetDays: 1,
  },
  request: {
    key: 'work_order',
    categoryLabel: 'Maintenance',
    accent: '#33639f',
    codePrefix: 'REQ',
    slaTargetDays: 2,
  },
  custom: {
    key: 'daily_operations',
    categoryLabel: 'Ops',
    accent: '#101c33',
    codePrefix: 'CARD',
    slaTargetDays: 7,
  },
};

export function specFor(template: string | null | undefined): TemplateSpec {
  return TEMPLATE_SPECS[template ?? 'custom'] ?? TEMPLATE_SPECS.custom;
}

/** "accent 7% on white" style derivations from the anatomy colour rules. */
export function derived(accent: string) {
  const mix = (pct: number) =>
    `color-mix(in srgb, ${accent} ${pct}%, #ffffff)`;
  return {
    cardBg: mix(7),
    border: mix(20),
    railTrack: mix(22),
    unitChip: mix(16),
    footer: mix(11),
    hairline: mix(12),
  };
}
