/**
 * Fail the build when committed files look like live secrets.
 * Wired into `pnpm --filter @workspace/scripts typecheck` and `.githooks/pre-commit`.
 *
 * Enable the hook locally with:
 *   git config core.hooksPath .githooks
 * Do not run that from agent sessions — operators opt in on their machine.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SKIP = /(^|\/)(node_modules|dist|coverage|\.git)\//;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf|mp4|lock)$/i;
const SKIP_NAME = /(^|\/)(\.env\.example|\.env\.[^/]*\.example)$/;

const PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws-access-key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "private-key", re: /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/ },
  { name: "postgres-url", re: /postgres(?:ql)?:\/\/[^/\s:]+:[^/\s@]+@/ },
];

function trackedFiles(): string[] {
  const out = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((rel) => !SKIP.test(rel) && !SKIP_EXT.test(rel) && !SKIP_NAME.test(rel) && rel !== "scripts/src/check-secrets.ts");
}

function scan(): string[] {
  const hits: string[] = [];
  for (const rel of trackedFiles()) {
    let src = "";
    try {
      src = readFileSync(resolve(root, rel), "utf8");
    } catch {
      continue;
    }
    for (const { name, re } of PATTERNS) {
      re.lastIndex = 0;
      if (re.test(src)) hits.push(`${rel}: ${name}`);
    }
  }
  return hits;
}

const hits = scan();
if (hits.length > 0) {
  console.error("Secret scan failed:\n" + hits.map((h) => `  ${h}`).join("\n"));
  process.exit(1);
}

console.log("Secret scan: clean");
