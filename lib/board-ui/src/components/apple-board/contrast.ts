// Contrast helpers for the Falkon card face. Kept dependency-free so the
// palette guard (scripts/src/check-card-contrast.ts) can import them directly.

/** Darken/lighten a #RRGGBB color by amt (-1..1). */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return hex;
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(f) as [number, number, number];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Relative luminance (0..1) of a #RRGGBB color. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return 0;
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** White text passes 4.5:1 when the background luminance is at or below this. */
export const HEADER_MAX_LUMINANCE = 0.183;

/** Darken a service color until white header text passes ~4.5:1 contrast. */
export function headerBase(hex: string): string {
  let c = hex;
  // 4.5:1 vs white ⇒ luminance ≤ ~0.183
  for (let i = 0; i < 6 && luminance(c) > HEADER_MAX_LUMINANCE; i++) c = shade(c, -0.14);
  return c;
}

/** WCAG contrast ratio of white text over a #RRGGBB background. */
export function contrastVsWhite(hex: string): number {
  return (1.0 + 0.05) / (luminance(hex) + 0.05);
}
