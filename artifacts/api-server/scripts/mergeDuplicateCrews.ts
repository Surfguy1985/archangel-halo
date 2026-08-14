/**
 * One-shot report + merge of near-duplicate crew rows.
 * Usage:
 *   pnpm exec tsx scripts/mergeDuplicateCrews.ts            # report only
 *   pnpm exec tsx scripts/mergeDuplicateCrews.ts --apply    # merge suggested pairs
 */
import { findDuplicateCrews, mergeCrews } from "../src/lib/crewMerge";
import { pool } from "@workspace/db";

const apply = process.argv.includes("--apply");

const { pairs, missingPhone } = await findDuplicateCrews();
console.log("=== Near-duplicate crew pairs ===");
for (const p of pairs) {
  const fmt = (r: typeof p.a) =>
    `${r.name} [${r.id.slice(0, 8)}] phone=${r.phone ?? "—"} jobs=${r.jobCount} b44=${r.base44Id ? "yes" : "no"}`;
  console.log(`- ${p.reason}\n    A: ${fmt(p.a)}\n    B: ${fmt(p.b)}\n    keep → ${p.suggestedKeepId === p.a.id ? p.a.name : p.b.name}`);
}
console.log("\n=== Crews with jobs but no phone ===");
for (const c of missingPhone) console.log(`- ${c.name} (${c.jobCount} jobs)`);

if (apply) {
  console.log("\n=== Applying merges ===");
  for (const p of pairs) {
    const loseId = p.suggestedKeepId === p.a.id ? p.b.id : p.a.id;
    try {
      const res = await mergeCrews(p.suggestedKeepId, loseId);
      console.log(`merged "${res.mergedName}" → "${res.keptName}" phone=${res.phone ?? "—"} repointed=${JSON.stringify(res.repointed)}`);
    } catch (err) {
      console.error(`FAILED ${p.a.name}/${p.b.name}:`, err);
    }
  }
}
await pool.end();
