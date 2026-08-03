// Service-category palette for the Falkon card face. Kept dependency-free
// (no lucide/react imports) so the palette guard
// (scripts/src/check-card-contrast.ts) can import it directly at runtime.
//
// Two-tone scheme (client directive): billing/money tiles are LIME GREEN with
// BLACK text; every other tile is BABY BLUE with WHITE text. Header text
// readability per tile is enforced by the guard — run
// `pnpm --filter @workspace/scripts run check:card-contrast` after editing.
export const TILE_BLUE = '#79B8F3'; // baby blue — white header text
export const TILE_LIME = '#B4FF44'; // lime green — black header text

export const APPLE_CATEGORY_COLORS: Record<string, string> = {
  maintenance: TILE_BLUE,
  lease: TILE_BLUE,
  rent: TILE_LIME,
  move: TILE_BLUE,
  coordination: TILE_BLUE,
  blank: TILE_BLUE,
  vendor: TILE_BLUE,
  billing: TILE_LIME,
  access: TILE_BLUE,
};

/** Header text color per tile: black on lime, white on blue. */
export const APPLE_CATEGORY_TEXT: Record<string, '#000000' | '#FFFFFF'> =
  Object.fromEntries(
    Object.entries(APPLE_CATEGORY_COLORS).map(([k, v]) => [
      k,
      v === TILE_LIME ? '#000000' : '#FFFFFF',
    ]),
  ) as Record<string, '#000000' | '#FFFFFF'>;
