/**
 * Demo narration guard.
 *
 * Both guided Board Demo tours match pre-rendered voice clips to steps purely
 * by filename index (step-N.mp3):
 *
 *   1. artifacts/client-dashboard/src/components/PresentationMode.tsx
 *        ↔ artifacts/client-dashboard/src/assets/presentation/step-N.mp3
 *   2. lib/board-demo/src/office.ts (shared by halo + halo-desktop
 *      OfficeBoardDemo components) ↔ lib/board-demo/src/assets/office-demo/step-N.mp3
 *
 * If someone inserts or removes a step without regenerating/renaming clips,
 * the WRONG narration plays over each step with no error — an embarrassing
 * live-demo failure. This script fails loudly when step count != clip count,
 * or when clip indices are not exactly 0..N-1 (a gap silently falls back to
 * SpeechSynthesis for that one step, which is also drift).
 *
 * Runs as part of `pnpm run typecheck` (see scripts/package.json), same as
 * check-board-contract.ts, so CI and the root build catch drift automatically.
 *
 * To change a tour's steps: edit the steps array AND regenerate the full
 * step-0..N-1 clip set for that tour, then re-run this guard.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type Tour = {
  name: string;
  componentRel: string;
  /** Marker that opens the steps array literal in the component. */
  arrayOpen: RegExp;
  clipsDirRel: string;
};

const TOURS: Tour[] = [
  {
    name: 'client-dashboard PresentationMode',
    componentRel: 'artifacts/client-dashboard/src/components/PresentationMode.tsx',
    arrayOpen: /PRESENTATION_STEPS\s*:\s*PresentationStep\[\]\s*=\s*\[/,
    clipsDirRel: 'artifacts/client-dashboard/src/assets/presentation',
  },
  {
    name: 'shared OfficeBoardDemo script',
    componentRel: 'lib/board-demo/src/office.ts',
    arrayOpen: /OFFICE_DEMO_SCRIPT\s*:\s*OfficeDemoScriptStep\[\]\s*=\s*\[/,
    clipsDirRel: 'lib/board-demo/src/assets/office-demo',
  },
];

/** Count steps by counting `title:` keys inside the steps array literal. */
function countSteps(tour: Tour): number {
  const src = readFileSync(resolve(root, tour.componentRel), 'utf8');
  const open = src.search(tour.arrayOpen);
  if (open === -1) throw new Error(`${tour.name}: steps array not found in ${tour.componentRel}`);
  const afterOpen = src.slice(src.indexOf('[', open) + 1);
  const close = afterOpen.indexOf('\n];');
  if (close === -1) throw new Error(`${tour.name}: could not find end of steps array (\\n];)`);
  const block = afterOpen.slice(0, close);
  const count = (block.match(/^\s*title:/gm) ?? []).length;
  if (count === 0) throw new Error(`${tour.name}: parsed zero steps — parser broken?`);
  return count;
}

/** Read step-N.mp3 clips and assert indices are exactly 0..N-1. Returns N. */
function countClips(tour: Tour): number {
  const dir = resolve(root, tour.clipsDirRel);
  let files: string[];
  try {
    files = readdirSync(dir);
  } catch {
    throw new Error(`${tour.name}: clips directory missing: ${tour.clipsDirRel}`);
  }
  const indices = files
    .map((f) => /^step-(\d+)\.mp3$/.exec(f)?.[1])
    .filter((x): x is string => x !== undefined)
    .map(Number)
    .sort((a, b) => a - b);
  if (indices.length === 0) throw new Error(`${tour.name}: zero step-N.mp3 clips in ${tour.clipsDirRel}`);
  const expected = indices.map((_, i) => i);
  if (indices.join(',') !== expected.join(',')) {
    throw new Error(
      `${tour.name}: clip indices are not contiguous 0..N-1 in ${tour.clipsDirRel} — found: ${indices.join(', ')}`,
    );
  }
  return indices.length;
}

const problems: string[] = [];
const summaries: string[] = [];
for (const tour of TOURS) {
  const steps = countSteps(tour);
  const clips = countClips(tour);
  if (steps !== clips) {
    problems.push(
      `  ${tour.name}: ${steps} steps in ${tour.componentRel} but ${clips} clips in ${tour.clipsDirRel} — ` +
        `narration would play over the wrong step`,
    );
  } else {
    summaries.push(`${tour.name}: ${steps} steps ↔ ${clips} clips`);
  }
}

if (problems.length) {
  console.error('❌ Demo narration drift — voice clips no longer line up with tour steps:\n');
  console.error(problems.join('\n'));
  console.error(
    '\nEditing a tour\'s steps requires regenerating the full step-0..N-1 clip set for that tour. ' +
      'See scripts/src/check-demo-narration.ts header.',
  );
  process.exit(1);
}

console.log(`✓ Demo narration OK — ${summaries.join('; ')}`);
