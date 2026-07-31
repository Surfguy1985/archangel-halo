/**
 * Board contract guard.
 *
 * The client-board module contract is defined in THREE layers that must stay
 * in lockstep, plus a renderer copy:
 *
 *   1. lib/api-spec/openapi.yaml            — ClientCardModule oneOf + discriminator mapping
 *   2. lib/board-ui/.../moduleSchemas.ts    — runtime Zod discriminated union (MODULE_TYPES)
 *   3. lib/board-ui/.../BoardCardModules.tsx — renderer switch (module.type === '...')
 *   4. artifacts/client-dashboard/.../BoardCardModules.tsx — local renderer copy
 *
 * A module type present in one layer but not the others is either rejected by
 * server Zod parsing (404/500) or silently renders the "update available"
 * fallback face. This script fails loudly when the sets diverge.
 *
 * It runs as part of `pnpm run typecheck` (see scripts/package.json), so CI
 * and the root build catch drift automatically.
 *
 * To add a new module type end-to-end:
 *   1. openapi.yaml: add <X>Module schema + entry in ClientCardModule oneOf AND discriminator.mapping
 *   2. regenerate the api client (orval)
 *   3. moduleSchemas.ts: add <x>ModuleSchema + register it in clientCardModuleSchema
 *   4. BoardCardModules.tsx (BOTH copies): render the new `module.type === '<x>'` branch
 *   5. server: emit the new module payload
 * Then `pnpm run typecheck` (which runs this guard) must pass.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

// --- 1. openapi.yaml: discriminator mapping keys + oneOf refs ---------------
function specTypes(): { mapping: Set<string>; oneOfCount: number } {
  const yaml = read('lib/api-spec/openapi.yaml');
  const start = yaml.indexOf('\n    ClientCardModule:');
  if (start === -1) throw new Error('ClientCardModule schema not found in openapi.yaml');
  // Block ends at the next top-level schema (4-space indented key).
  const rest = yaml.slice(start + 1);
  const endMatch = rest.slice(1).search(/\n    [A-Za-z]/);
  const block = endMatch === -1 ? rest : rest.slice(0, endMatch + 1);

  const oneOfRefs = (block.match(/-\s+\$ref: "#\/components\/schemas\/(\w+)"/g) ?? []).length;

  const mappingSection = block.split('mapping:')[1];
  if (!mappingSection) throw new Error('ClientCardModule discriminator mapping not found');
  const mapping = new Set<string>();
  for (const m of mappingSection.matchAll(/^\s{10}([a-z_]+): "#\/components\/schemas\/(\w+)"/gm)) {
    mapping.add(m[1]);
  }
  if (mapping.size === 0) throw new Error('Parsed zero mapping keys from openapi.yaml — parser broken?');
  if (oneOfRefs !== mapping.size) {
    throw new Error(
      `openapi.yaml ClientCardModule: oneOf has ${oneOfRefs} variants but discriminator.mapping has ${mapping.size} keys — they must match`,
    );
  }
  return { mapping, oneOfCount: oneOfRefs };
}

// --- 2. moduleSchemas.ts: the Zod registry ---------------------------------
async function zodTypes(): Promise<Set<string>> {
  const mod = await import(
    resolve(root, 'lib/board-ui/src/components/kanban/moduleSchemas.ts')
  );
  const types: string[] = mod.MODULE_TYPES;
  if (!Array.isArray(types) || types.length === 0) {
    throw new Error('MODULE_TYPES missing or empty in moduleSchemas.ts');
  }
  return new Set(types);
}

// --- 3/4. renderer switches -------------------------------------------------
function rendererTypes(rel: string): Set<string> {
  const src = read(rel);
  const set = new Set<string>();
  for (const m of src.matchAll(/module\.type === '([a-z_]+)'/g)) set.add(m[1]);
  if (set.size === 0) throw new Error(`Parsed zero module.type branches from ${rel} — parser broken?`);
  return set;
}

function diff(a: Set<string>, b: Set<string>): string[] {
  return [...a].filter((x) => !b.has(x)).sort();
}

const layers: Array<[string, Set<string>]> = [
  ['openapi.yaml ClientCardModule mapping', specTypes().mapping],
  ['board-ui moduleSchemas.ts (MODULE_TYPES)', await zodTypes()],
  ['board-ui BoardCardModules.tsx renderer', rendererTypes('lib/board-ui/src/components/kanban/BoardCardModules.tsx')],
  [
    'client-dashboard BoardCardModules.tsx renderer',
    rendererTypes('artifacts/client-dashboard/src/components/kanban/BoardCardModules.tsx'),
  ],
];

const union = new Set<string>(layers.flatMap(([, s]) => [...s]));
const problems: string[] = [];
for (const [name, set] of layers) {
  const missing = diff(union, set);
  if (missing.length) problems.push(`  ${name} is MISSING: ${missing.join(', ')}`);
}

if (problems.length) {
  console.error('❌ Board contract drift — module types are not consistent across layers:\n');
  console.error(problems.join('\n'));
  console.error(
    '\nAll layers must cover the same set of module types. See scripts/src/check-board-contract.ts header for the end-to-end checklist.',
  );
  process.exit(1);
}

console.log(
  `✓ Board contract OK — ${union.size} module types consistent across spec, Zod registry, and both renderers: ${[...union].sort().join(', ')}`,
);
