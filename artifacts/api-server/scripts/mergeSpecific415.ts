/**
 * Task 415 — merge confirmed look-alike crew pairs:
 *   Pro Service  → Proserve
 *   Fran         → Francisco Javier Herrera
 */
import { mergeCrews } from "../src/lib/crewMerge";
import { pool } from "@workspace/db";

const merges: Array<{ keepId: string; mergeId: string; label: string }> = [
  {
    // keep Proserve, absorb Pro Service
    keepId: "871c2184-8d64-4edc-983d-caf65313c87d",
    mergeId: "be29cb0a-8631-4978-ad41-2ae45f6ceec1",
    label: "Pro Service → Proserve",
  },
  {
    // keep Francisco Javier Herrera (has phone + jobs), absorb Fran
    keepId: "ed8a9497-49b8-42fc-a248-5c18adcffb2c",
    mergeId: "2798e033-2506-48f8-85bb-c625e012c8e4",
    label: "Fran → Francisco Javier Herrera",
  },
];

for (const { keepId, mergeId, label } of merges) {
  try {
    const result = await mergeCrews(keepId, mergeId);
    console.log(
      `✓ ${label}  |  kept="${result.keptName}"  merged="${result.mergedName}"  ` +
        `phone=${result.phone ?? "—"}  repointed=${JSON.stringify(result.repointed)}`,
    );
  } catch (err) {
    console.error(`✗ FAILED ${label}:`, err);
    process.exitCode = 1;
  }
}

await pool.end();
