/**
 * Card header contrast guard.
 *
 * Every board card renders the Falkon face colored by service category
 * (APPLE_CATEGORY_COLORS in lib/board-ui/.../palette.ts) with per-category
 * header text declared in APPLE_CATEGORY_TEXT: black text on lime tiles,
 * white text on blue tiles.
 *
 * - Black-text tiles: black must reach ≥4.5:1 against the raw tile color
 *   (AppleCard renders black text directly on the tile gradient).
 * - White-text tiles: AppleCard's gradient runs dark→light — from
 *   shade(color, -0.42) at the top-left (where the header text sits) to the
 *   raw color; white text must reach ≥4.5:1 against that dark end.
 *
 * This guard iterates the real palette through the real shade()/luminance()
 * helpers and fails loudly — naming the offending category and color.
 * It runs as part of `pnpm run typecheck` (see scripts/package.json).
 */
import { APPLE_CATEGORY_COLORS, APPLE_CATEGORY_TEXT } from '@workspace/board-ui/palette';
import { shade, luminance } from '@workspace/board-ui/contrast';

const entries = Object.entries(APPLE_CATEGORY_COLORS);
if (entries.length === 0) {
  console.error('check-card-contrast: APPLE_CATEGORY_COLORS is empty — palette not found?');
  process.exit(1);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const WHITE = 1.0;
const BLACK = 0.0;

const failures: string[] = [];

for (const [category, color] of entries) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    failures.push(`category "${category}": color "${color}" is not a #RRGGBB hex value`);
    continue;
  }
  const text = APPLE_CATEGORY_TEXT[category];
  if (text !== '#000000' && text !== '#FFFFFF') {
    failures.push(`category "${category}": missing/invalid APPLE_CATEGORY_TEXT entry (${text})`);
    continue;
  }
  if (text === '#000000') {
    const ratio = contrast(BLACK, luminance(color));
    if (ratio < 4.5) {
      failures.push(
        `category "${category}": black text on ${color} gives only ${ratio.toFixed(2)}:1 (needs ≥ 4.5:1).`,
      );
    }
  } else {
    const darkEnd = shade(color, -0.42);
    const ratioDark = contrast(WHITE, luminance(darkEnd));
    if (ratioDark < 4.5) {
      failures.push(
        `category "${category}": white text on gradient start ${darkEnd} gives only ` +
          `${ratioDark.toFixed(2)}:1 (needs ≥ 4.5:1). Pick a deeper tile color.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error('check-card-contrast: unreadable card headers detected:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check-card-contrast: OK — ${entries.length} category colors all yield readable header text.`,
);
