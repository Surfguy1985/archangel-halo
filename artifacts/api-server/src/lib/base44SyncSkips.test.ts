/**
 * Locks in the skip accounting for the Base44 → HALO sync.
 *
 * Guard clauses in the sync functions previously dropped upstream rows with a
 * bare `continue` — no error, no log, no count — undetected across 881 runs.
 * These tests fail if that behaviour ever regresses.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  MAX_SKIP_DETAIL,
  foldSkipsIntoResources,
  getLastSyncSkips,
  getSkipSummary,
  noteSkip,
  resetSkips,
} from "./base44SyncSkips";

beforeEach(() => {
  resetSkips();
});

describe("Base44 sync skip accounting", () => {
  it("counts an unplaceable row instead of letting it vanish", () => {
    // A crew job whose unit and property are both unresolvable — the exact
    // shape that used to disappear silently.
    noteSkip("crew_jobs", "cj-881", "unresolved_property");

    const summary = getSkipSummary();
    expect(summary.total).toBe(1);
    expect(summary.byResource.crew_jobs).toBe(1);
    expect(summary.byReason["crew_jobs:unresolved_property"]).toBe(1);
    expect(summary.detailTruncated).toBe(false);

    const detail = getLastSyncSkips();
    expect(detail).toEqual([
      { resource: "crew_jobs", base44Id: "cj-881", reason: "unresolved_property" },
    ]);

    // The roll-up must surface the skip in resources[x].skipped + totalSkipped,
    // even when the syncer never touched that resource bucket.
    const resources: Record<string, { created: number; updated: number; errors: number; skipped?: number }> = {
      properties: { created: 2, updated: 1, errors: 0 },
    };
    const totalSkipped = foldSkipsIntoResources(resources);
    expect(totalSkipped).toBe(1);
    expect(resources.crew_jobs.skipped).toBe(1);
    expect(resources.properties.skipped).toBeUndefined();
  });

  it("keeps counts exact past MAX_SKIP_DETAIL while capping detail", () => {
    const overshoot = MAX_SKIP_DETAIL + 25;
    for (let i = 0; i < overshoot; i++) {
      noteSkip("units", `u-${i}`, "unresolved_property");
    }
    noteSkip("crew_jobs", null, "missing_id");

    const summary = getSkipSummary();
    expect(summary.total).toBe(overshoot + 1); // exact, never capped
    expect(summary.byResource.units).toBe(overshoot);
    expect(summary.byResource.crew_jobs).toBe(1);
    expect(summary.detailTruncated).toBe(true);
    expect(getLastSyncSkips()).toHaveLength(MAX_SKIP_DETAIL);

    // Per-resource fold is also exact.
    const resources: Record<string, { created: number; updated: number; errors: number; skipped?: number }> = {};
    expect(foldSkipsIntoResources(resources)).toBe(overshoot + 1);
    expect(resources.units.skipped).toBe(overshoot);
  });

  it("skip accessors return copies so callers cannot mutate operational state", () => {
    noteSkip("invoices", "inv-1", "unresolved_property");

    const detail = getLastSyncSkips();
    detail.pop();
    detail.push({ resource: "hacked", base44Id: null, reason: "hacked" });
    if (getLastSyncSkips()[0]) getLastSyncSkips()[0].reason = "mutated";
    expect(getLastSyncSkips()).toEqual([
      { resource: "invoices", base44Id: "inv-1", reason: "unresolved_property" },
    ]);

    const summary = getSkipSummary();
    summary.total = 999;
    summary.byResource.invoices = 999;
    summary.byReason["invoices:unresolved_property"] = 999;
    const fresh = getSkipSummary();
    expect(fresh.total).toBe(1);
    expect(fresh.byResource.invoices).toBe(1);
    expect(fresh.byReason["invoices:unresolved_property"]).toBe(1);
  });

  it("no sync function reintroduces a bare `continue` guard", () => {
    // Static guard: inside the per-entity sync functions of base44Sync.ts,
    // every `continue` must either call noteSkip (a counted skip) or sit on a
    // success/handled path (a counted create/update/error just above it).
    const source = readFileSync(join(__dirname, "base44Sync.ts"), "utf8");
    const lines = source.split("\n");

    let inSyncFn = false;
    let depth = 0;
    const violations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inSyncFn && /^async function sync\w+\(/.test(line)) {
        inSyncFn = true;
        depth = 0;
      }
      if (!inSyncFn) continue;
      depth += (line.match(/{/g) ?? []).length - (line.match(/}/g) ?? []).length;
      if (/\bcontinue\b/.test(line) && !/^\s*(\/\/|\*)/.test(line)) {
        const counted = /noteSkip\(/.test(line);
        const context = lines.slice(Math.max(0, i - 3), i).join("\n");
        const handledPath = /(created|updated|errors|stale)\+\+|noteSkip\(/.test(context);
        if (!counted && !handledPath) {
          violations.push(`line ${i + 1}: ${line.trim()}`);
        }
      }
      if (depth <= 0 && /^}/.test(line)) inSyncFn = false;
    }

    expect(
      violations,
      `bare \`continue\` in a sync function silently drops upstream rows — call noteSkip() first:\n${violations.join("\n")}`,
    ).toEqual([]);
  });

  it("guard scanner actually detects a bare continue (self-test)", () => {
    // Prove the guard isn't vacuous: a synthetic sync function with a bare
    // guard continue must be flagged by the same rule.
    const synthetic = [
      "async function syncThings(records: any[]) {",
      "  for (const rec of records) {",
      "    if (!rec.id) continue;",
      "  }",
      "}",
    ];
    const flagged = synthetic.some(
      (line, i) =>
        /\bcontinue\b/.test(line) &&
        !/noteSkip\(/.test(line) &&
        !/(created|updated|errors|stale)\+\+|noteSkip\(/.test(
          synthetic.slice(Math.max(0, i - 3), i).join("\n"),
        ),
    );
    expect(flagged).toBe(true);
  });
});
