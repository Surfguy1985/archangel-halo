/**
 * Card header contrast guard.
 *
 * Every board card renders the Falkon face colored by service category
 * (APPLE_CATEGORY_COLORS in lib/board-ui/.../templates.ts) with WHITE header
 * text. Readability relies on headerBase() (lib/board-ui/.../contrast.ts)
 * darkening light palette entries until white text reaches ~4.5:1 (WCAG AA).
 *
 * headerBase() darkens in at most 6 steps of -14%, so an extremely light
 * palette entry could exhaust the loop and still ship an unreadable header.
 * This guard iterates the real palette through the real headerBase() and
 * fails loudly — naming the offending category and color — if any header
 * would fall below the 4.5:1 threshold.
 *
 * It runs as part of `pnpm run typecheck` (see scripts/package.json), so CI
 * and the root build catch palette regressions automatically.
 */
import { APPLE_CATEGORY_COLORS } from '@workspace/board-ui/palette';
import {
  headerBase,
  luminance,
  contrastVsWhite,
  HEADER_MAX_LUMINANCE,
} from '@workspace/board-ui/contrast';

const entries = Object.entries(APPLE_CATEGORY_COLORS);
if (entries.length === 0) {
  console.error('check-card-contrast: APPLE_CATEGORY_COLORS is empty — palette not found?');
  process.exit(1);
}

const failures: string[] = [];

for (const [category, color] of entries) {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    failures.push(`category "${category}": color "${color}" is not a #RRGGBB hex value`);
    continue;
  }
  const header = headerBase(color);
  const ratio = contrastVsWhite(header);
  if (luminance(header) > HEADER_MAX_LUMINANCE) {
    failures.push(
      `category "${category}": palette color ${color} → headerBase ${header} gives only ` +
        `${ratio.toFixed(2)}:1 contrast for white header text (needs ≥ 4.5:1). ` +
        `Pick a darker palette color or one headerBase() can darken within its 6 steps.`,
    );
  }
}

if (failures.length > 0) {
  console.error('check-card-contrast: unreadable card headers detected:\n');
  for (const f of failures) console.error(`  ✗ ${f}`);
  console.error('');
  process.exit(1);
}

console.log(`check-card-contrast: OK — ${entries.length} category colors all yield ≥4.5:1 white header contrast.`);
