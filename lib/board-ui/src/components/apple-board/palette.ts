// Watch-icon palette. Dark board chrome; each card face is one saturated
// Apple color. Lime (money / billing) takes black ink; system blue takes white.
// Guard: `pnpm --filter @workspace/scripts run check:card-contrast`
export const TILE_BLUE = '#0A84FF'; // Apple system blue — white ink
export const TILE_LIME = '#B4FF44'; // HALO lime — black ink

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

/** Header / glyph ink: black on lime, white on blue. */
export const APPLE_CATEGORY_TEXT: Record<string, '#000000' | '#FFFFFF'> =
  Object.fromEntries(
    Object.entries(APPLE_CATEGORY_COLORS).map(([k, v]) => [
      k,
      v === TILE_LIME ? '#000000' : '#FFFFFF',
    ]),
  ) as Record<string, '#000000' | '#FFFFFF'>;
