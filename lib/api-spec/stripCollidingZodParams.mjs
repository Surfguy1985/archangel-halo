/**
 * Orval emits Get*Params twice when an operation has a path id AND query
 * params: a Zod object in generated/api.ts (the path) and a TypeScript
 * interface in generated/types (the query). Star-exporting both folders
 * then fails TS2308. Drop the type-folder copies; routes use
 * Get*QueryParams from generated/api.ts.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const typesIndex = path.resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "api-zod",
  "src",
  "generated",
  "types",
  "index.ts",
);

const drop = new Set([
  "./getPortfolioPulseParams",
  "./getClientPortfolioPulseParams",
  "./getPropertyTurnBoardParams",
  "./getClientPropertyTurnBoardParams",
]);

const src = fs.readFileSync(typesIndex, "utf8");
const next = src
  .split("\n")
  .filter((line) => {
    const m = line.match(/^export \* from '(\.\/[^']+)';$/);
    return !(m && drop.has(m[1]));
  })
  .join("\n");

if (next === src) {
  console.warn("stripCollidingZodParams: no matching exports (orval naming changed?)");
} else {
  fs.writeFileSync(typesIndex, next);
  console.log("stripCollidingZodParams: dropped colliding Get*Params type re-exports");
}
