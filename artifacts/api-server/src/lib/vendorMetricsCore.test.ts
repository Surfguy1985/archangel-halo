/**
 * Unit tests for the vendor metrics computation engine.
 *
 * All tests run against `computeVendorMetricsFromData` — the pure function
 * that takes already-fetched rows. No database or network involved.
 *
 * Coverage targets from the task spec:
 *   1. Two POs against the same job → one turn sample, two PO-cycle samples.
 *   2. No received POs / no completed jobs → null (never 0); UI "No data yet".
 *   3. Cancelled jobs and negative/half-filled spans are excluded.
 *   4. In-house vendor falls back to client turns only when no staffed
 *      completed jobs exist.
 */
import { describe, expect, it } from "vitest";
import { computeVendorMetricsFromData, spanDays, jobTurnDays, mean } from "./vendorMetricsCore";
import type { PoRow, JobRow, ClientTurnRow } from "./vendorMetricsCore";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

function job(
  id: string,
  opts: Partial<JobRow> = {},
): JobRow {
  return {
    id,
    status: "completed",
    crewLeaderId: "crew-1",
    createdAt: daysAgo(10),
    completedAt: daysAgo(4),
    ...opts,
  };
}

function po(
  vendorId: string,
  jobId: string | null,
  opts: Partial<PoRow> = {},
): PoRow {
  return {
    vendorId,
    jobId,
    createdAt: daysAgo(8),
    receivedAt: daysAgo(5),
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

describe("spanDays", () => {
  it("returns elapsed days for a valid pair", () => {
    const from = new Date("2026-07-01T00:00:00Z");
    const to = new Date("2026-07-04T00:00:00Z");
    expect(spanDays(from, to)).toBe(3);
  });

  it("returns null when either date is null", () => {
    expect(spanDays(null, new Date())).toBeNull();
    expect(spanDays(new Date(), null)).toBeNull();
  });

  it("returns null for a negative span (to before from)", () => {
    const from = new Date("2026-07-05T00:00:00Z");
    const to = new Date("2026-07-01T00:00:00Z");
    expect(spanDays(from, to)).toBeNull();
  });

  it("returns 0 when from and to are the same instant", () => {
    const d = new Date("2026-07-01T12:00:00Z");
    expect(spanDays(d, d)).toBe(0);
  });
});

describe("jobTurnDays", () => {
  it("returns null for a cancelled job regardless of timestamps", () => {
    expect(
      jobTurnDays({
        status: "cancelled",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        completedAt: new Date("2026-07-08T00:00:00Z"),
      }),
    ).toBeNull();
  });

  it("returns null when completedAt is null (half-filled span)", () => {
    expect(
      jobTurnDays({
        status: "in_progress",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        completedAt: null,
      }),
    ).toBeNull();
  });

  it("returns null when createdAt is null", () => {
    expect(
      jobTurnDays({
        status: "completed",
        createdAt: null,
        completedAt: new Date("2026-07-08T00:00:00Z"),
      }),
    ).toBeNull();
  });

  it("returns positive days for a completed non-cancelled job", () => {
    const created = new Date("2026-07-01T00:00:00Z");
    const completed = new Date("2026-07-06T00:00:00Z");
    expect(jobTurnDays({ status: "completed", createdAt: created, completedAt: completed })).toBe(5);
  });
});

describe("mean", () => {
  it("returns null for an empty array", () => {
    expect(mean([])).toBeNull();
  });

  it("rounds to one decimal place", () => {
    expect(mean([1, 2])).toBe(1.5);
    expect(mean([1, 1, 2])).toBe(1.3); // 4/3 = 1.333… → 1.3
  });

  it("returns the single value for a one-element array", () => {
    expect(mean([7])).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Core spec: two POs against the same job
// ---------------------------------------------------------------------------

describe("two POs against the same job", () => {
  it("counts the job's turn once but records two PO-cycle samples", () => {
    const j = job("job-1", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-11T00:00:00Z"), // 10 days
    });

    const po1: PoRow = {
      vendorId: "v1",
      jobId: "job-1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: new Date("2026-07-04T00:00:00Z"), // 3 days
    };
    const po2: PoRow = {
      vendorId: "v1",
      jobId: "job-1",
      createdAt: new Date("2026-07-05T00:00:00Z"),
      receivedAt: new Date("2026-07-09T00:00:00Z"), // 4 days
    };

    const result = computeVendorMetricsFromData([po1, po2], [j], [], []);
    const m = result.get("v1")!;

    // One turn sample (the job counted once), turn = 10 days.
    expect(m.avgTurnSamples).toBe(1);
    expect(m.avgTurnDays).toBe(10);

    // Two PO-cycle samples: 3 days + 4 days, mean = 3.5
    expect(m.avgPoSamples).toBe(2);
    expect(m.avgPoDays).toBe(3.5);
  });

  it("counts the same job once per vendor, not once globally across vendors", () => {
    const j = job("job-shared", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-06T00:00:00Z"), // 5 days
    });
    // Two different vendors, each with one PO against the same job.
    const poV1: PoRow = {
      vendorId: "v1",
      jobId: "job-shared",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: new Date("2026-07-03T00:00:00Z"),
    };
    const poV2: PoRow = {
      vendorId: "v2",
      jobId: "job-shared",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: new Date("2026-07-05T00:00:00Z"),
    };

    const result = computeVendorMetricsFromData([poV1, poV2], [j], [], []);

    // Each vendor gets one turn sample for that one job.
    expect(result.get("v1")!.avgTurnSamples).toBe(1);
    expect(result.get("v2")!.avgTurnSamples).toBe(1);
    expect(result.get("v1")!.avgTurnDays).toBe(5);
    expect(result.get("v2")!.avgTurnDays).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Core spec: null (never 0) when there is no data
// ---------------------------------------------------------------------------

describe("no data → null, never 0", () => {
  it("returns an empty map when pos and jobs are empty", () => {
    const result = computeVendorMetricsFromData([], [], [], []);
    expect(result.size).toBe(0);
  });

  it("avgPoDays is null when no PO has been received", () => {
    const j = job("job-1");
    const unreceived: PoRow = {
      vendorId: "v1",
      jobId: "job-1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: null, // not yet received
    };

    const result = computeVendorMetricsFromData([unreceived], [j], [], []);
    const m = result.get("v1")!;
    expect(m.avgPoDays).toBeNull();
    expect(m.avgPoSamples).toBe(0);
  });

  it("avgTurnDays is null when no completed job is linked", () => {
    // PO exists but points at no job.
    const poNoJob: PoRow = {
      vendorId: "v1",
      jobId: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: new Date("2026-07-04T00:00:00Z"),
    };

    const result = computeVendorMetricsFromData([poNoJob], [], [], []);
    const m = result.get("v1")!;
    expect(m.avgTurnDays).toBeNull();
    expect(m.avgTurnSamples).toBe(0);
  });

  it("a sub-vendor with no POs does not appear in the map", () => {
    // A completed job exists, but this sub-vendor has no POs against it.
    const j = job("job-1");
    // Pass empty inHouseVendorIds — v-no-po is a sub, not in-house.
    const result = computeVendorMetricsFromData([], [j], [], []);
    expect(result.has("v-no-po")).toBe(false);
  });

  it("an in-house vendor with no staffed jobs and no client turns does not appear in the map", () => {
    // A completed but unstaffed job exists — crewLeaderId is null, so it
    // carries no information about how fast our organization turns units.
    const j = job("job-1", { crewLeaderId: null });
    const result = computeVendorMetricsFromData([], [j], [], ["ih-1"]);
    expect(result.has("ih-1")).toBe(false);
  });

  it("avgPoDays and avgTurnDays are null, not 0, for a vendor with unreceived PO and cancelled job", () => {
    const cancelledJob = job("job-c", { status: "cancelled" });
    const p: PoRow = {
      vendorId: "v1",
      jobId: "job-c",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: null,
    };

    const result = computeVendorMetricsFromData([p], [cancelledJob], [], []);
    // The cancelled job + unreceived PO produce no valid sample.
    // Since no valid samples exist the vendor shouldn't appear in the map
    // at all, so "No data yet" is what the UI would show.
    expect(result.has("v1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Core spec: cancelled jobs and bad spans are excluded
// ---------------------------------------------------------------------------

describe("exclusions", () => {
  it("cancelled jobs do not contribute a turn sample", () => {
    const goodJob = job("job-good", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-08T00:00:00Z"), // 7 days
    });
    const cancelledJob = job("job-bad", {
      status: "cancelled",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-03T00:00:00Z"),
    });

    const pos: PoRow[] = [
      {
        vendorId: "v1",
        jobId: "job-good",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        receivedAt: new Date("2026-07-03T00:00:00Z"),
      },
      {
        vendorId: "v1",
        jobId: "job-bad",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        receivedAt: new Date("2026-07-02T00:00:00Z"),
      },
    ];

    const result = computeVendorMetricsFromData(pos, [goodJob, cancelledJob], [], []);
    const m = result.get("v1")!;
    expect(m.avgTurnSamples).toBe(1);
    expect(m.avgTurnDays).toBe(7);
  });

  it("a job with no completedAt (half-filled) is excluded from turn averages", () => {
    const incompleteJob: JobRow = {
      id: "job-inc",
      status: "in_progress",
      crewLeaderId: "crew-1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: null,
    };

    const p: PoRow = {
      vendorId: "v1",
      jobId: "job-inc",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: new Date("2026-07-03T00:00:00Z"),
    };

    const result = computeVendorMetricsFromData([p], [incompleteJob], [], []);
    // The job has no completedAt so it won't appear in the completed set.
    // The PO was received so avgPoDays has a sample, but avgTurnDays is null.
    const m = result.get("v1")!;
    expect(m.avgPoSamples).toBe(1);
    expect(m.avgTurnDays).toBeNull();
    expect(m.avgTurnSamples).toBe(0);
  });

  it("a PO with createdAt after receivedAt (negative span) is excluded from PO averages", () => {
    const j = job("job-1", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-08T00:00:00Z"),
    });

    const badPo: PoRow = {
      vendorId: "v1",
      jobId: "job-1",
      createdAt: new Date("2026-07-10T00:00:00Z"), // after receivedAt
      receivedAt: new Date("2026-07-05T00:00:00Z"),
    };

    const result = computeVendorMetricsFromData([badPo], [j], [], []);
    const m = result.get("v1")!;
    expect(m.avgPoDays).toBeNull();
    expect(m.avgPoSamples).toBe(0);
    // The turn sample still counts: the job is valid even if the PO span is bad.
    expect(m.avgTurnSamples).toBe(1);
    expect(m.avgTurnDays).toBe(7);
  });

  it("POs with null vendorId are ignored entirely", () => {
    const j = job("job-1");
    const p: PoRow = {
      vendorId: null,
      jobId: "job-1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      receivedAt: new Date("2026-07-04T00:00:00Z"),
    };

    const result = computeVendorMetricsFromData([p], [j], [], []);
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Core spec: in-house vendor fallback logic
// ---------------------------------------------------------------------------

describe("in-house vendor fallback", () => {
  it("uses staffed completed jobs when they exist, ignores client turns", () => {
    const staffedJob = job("job-staffed", {
      crewLeaderId: "crew-1",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-06T00:00:00Z"), // 5 days
    });

    // Client turns report a different number — should be ignored.
    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-20T00:00:00Z"), // 19 days
    };

    const result = computeVendorMetricsFromData([], [staffedJob], [clientTurn], ["in-house-1"]);
    const m = result.get("in-house-1")!;
    expect(m.avgTurnDays).toBe(5);
    expect(m.avgTurnSamples).toBe(1);
  });

  it("falls back to client turns when there are no staffed completed jobs", () => {
    // A completed job but with no crewLeaderId — not staffed.
    const unstaffedJob = job("job-unstaffed", { crewLeaderId: null });

    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-09T00:00:00Z"), // 8 days
    };

    const result = computeVendorMetricsFromData([], [unstaffedJob], [clientTurn], ["in-house-1"]);
    const m = result.get("in-house-1")!;
    expect(m.avgTurnDays).toBe(8);
    expect(m.avgTurnSamples).toBe(1);
  });

  it("falls back to client turns when there are no completed jobs at all", () => {
    const clientTurns: ClientTurnRow[] = [
      {
        actualVacateAt: new Date("2026-07-01T00:00:00Z"),
        readyAt: new Date("2026-07-11T00:00:00Z"), // 10 days
      },
      {
        actualVacateAt: new Date("2026-07-05T00:00:00Z"),
        readyAt: new Date("2026-07-15T00:00:00Z"), // 10 days
      },
    ];

    const result = computeVendorMetricsFromData([], [], clientTurns, ["in-house-1"]);
    const m = result.get("in-house-1")!;
    expect(m.avgTurnDays).toBe(10);
    expect(m.avgTurnSamples).toBe(2);
  });

  it("does not appear in the map when no staffed jobs and no client turns", () => {
    const result = computeVendorMetricsFromData([], [], [], ["in-house-1"]);
    expect(result.has("in-house-1")).toBe(false);
  });

  it("client turn with null actualVacateAt is excluded from the fallback", () => {
    const badTurn: ClientTurnRow = {
      actualVacateAt: null,
      readyAt: new Date("2026-07-10T00:00:00Z"),
    };
    const goodTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-07T00:00:00Z"), // 6 days
    };

    const result = computeVendorMetricsFromData([], [], [badTurn, goodTurn], ["in-house-1"]);
    const m = result.get("in-house-1")!;
    expect(m.avgTurnSamples).toBe(1);
    expect(m.avgTurnDays).toBe(6);
  });

  it("falls back to client turns when all staffed jobs are cancelled", () => {
    // The job has a crewLeaderId (staffed) but is cancelled, so jobTurnDays
    // returns null. The core must still fall back to client turns.
    const cancelledStaffed = job("job-c", {
      crewLeaderId: "crew-1",
      status: "cancelled",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-08T00:00:00Z"),
    });
    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-07T00:00:00Z"), // 6 days
    };

    const result = computeVendorMetricsFromData([], [cancelledStaffed], [clientTurn], ["ih-1"]);
    const m = result.get("ih-1")!;
    expect(m.avgTurnDays).toBe(6);
    expect(m.avgTurnSamples).toBe(1);
  });

  it("falls back to client turns when all staffed jobs have a null createdAt (half-filled)", () => {
    const halfFilled = job("job-hf", {
      crewLeaderId: "crew-1",
      status: "completed",
      createdAt: null, // no start date recorded
      completedAt: new Date("2026-07-08T00:00:00Z"),
    });
    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-09T00:00:00Z"), // 8 days
    };

    const result = computeVendorMetricsFromData([], [halfFilled], [clientTurn], ["ih-1"]);
    const m = result.get("ih-1")!;
    expect(m.avgTurnDays).toBe(8);
    expect(m.avgTurnSamples).toBe(1);
  });

  it("falls back to client turns when all staffed jobs have a negative span", () => {
    // completedAt before createdAt — data error, spanDays returns null.
    const negativeSpan = job("job-neg", {
      crewLeaderId: "crew-1",
      status: "completed",
      createdAt: new Date("2026-07-10T00:00:00Z"),
      completedAt: new Date("2026-07-01T00:00:00Z"), // before createdAt
    });
    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-05T00:00:00Z"), // 4 days
    };

    const result = computeVendorMetricsFromData([], [negativeSpan], [clientTurn], ["ih-1"]);
    const m = result.get("ih-1")!;
    expect(m.avgTurnDays).toBe(4);
    expect(m.avgTurnSamples).toBe(1);
  });

  it("does NOT fall back when at least one staffed job has a valid span, even if others are invalid", () => {
    const validJob = job("job-v", {
      crewLeaderId: "crew-1",
      status: "completed",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-06T00:00:00Z"), // 5 days
    });
    const cancelledJob = job("job-c", {
      crewLeaderId: "crew-2",
      status: "cancelled",
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-10T00:00:00Z"),
    });
    // Client turns report a very different number — should be ignored.
    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-30T00:00:00Z"), // 29 days
    };

    const result = computeVendorMetricsFromData(
      [],
      [validJob, cancelledJob],
      [clientTurn],
      ["ih-1"],
    );
    const m = result.get("ih-1")!;
    // Only the valid job's 5-day span should be used.
    expect(m.avgTurnDays).toBe(5);
    expect(m.avgTurnSamples).toBe(1);
  });

  it("all in-house vendor ids share the same turn pool", () => {
    const clientTurn: ClientTurnRow = {
      actualVacateAt: new Date("2026-07-01T00:00:00Z"),
      readyAt: new Date("2026-07-05T00:00:00Z"), // 4 days
    };

    const result = computeVendorMetricsFromData([], [], [clientTurn], ["ih-a", "ih-b"]);
    expect(result.get("ih-a")!.avgTurnDays).toBe(4);
    expect(result.get("ih-b")!.avgTurnDays).toBe(4);
  });

  it("in-house vendor PO avgPoDays is always null (no POs)", () => {
    const staffedJob = job("job-1", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-08T00:00:00Z"),
    });

    const result = computeVendorMetricsFromData([], [staffedJob], [], ["ih-1"]);
    const m = result.get("ih-1")!;
    expect(m.avgPoDays).toBeNull();
    expect(m.avgPoSamples).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Edge: multiple jobs, multiple vendors — end-to-end correctness
// ---------------------------------------------------------------------------

describe("multi-vendor multi-job correctness", () => {
  it("independent vendors do not bleed into each other's averages", () => {
    const jobA = job("job-a", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-03T00:00:00Z"), // 2 days
    });
    const jobB = job("job-b", {
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-11T00:00:00Z"), // 10 days
    });

    const pos: PoRow[] = [
      {
        vendorId: "v-alpha",
        jobId: "job-a",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        receivedAt: new Date("2026-07-02T00:00:00Z"), // 1 day
      },
      {
        vendorId: "v-beta",
        jobId: "job-b",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        receivedAt: new Date("2026-07-06T00:00:00Z"), // 5 days
      },
    ];

    const result = computeVendorMetricsFromData(pos, [jobA, jobB], [], []);

    const alpha = result.get("v-alpha")!;
    expect(alpha.avgTurnDays).toBe(2);
    expect(alpha.avgPoDays).toBe(1);

    const beta = result.get("v-beta")!;
    expect(beta.avgTurnDays).toBe(10);
    expect(beta.avgPoDays).toBe(5);
  });

  it("a vendor with three jobs and two POs averages turns over only the PO-linked jobs", () => {
    // Three completed jobs; vendor has POs only for two of them.
    const jobA = job("job-a", {
      crewLeaderId: null, // not in-house
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-05T00:00:00Z"), // 4 days
    });
    const jobB = job("job-b", {
      crewLeaderId: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-09T00:00:00Z"), // 8 days
    });
    // jobC is not linked via PO — should not be counted.
    const jobC = job("job-c", {
      crewLeaderId: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      completedAt: new Date("2026-07-21T00:00:00Z"), // 20 days — would drag mean up
    });

    const pos: PoRow[] = [
      {
        vendorId: "v1",
        jobId: "job-a",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        receivedAt: new Date("2026-07-03T00:00:00Z"), // 2 days
      },
      {
        vendorId: "v1",
        jobId: "job-b",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        receivedAt: new Date("2026-07-05T00:00:00Z"), // 4 days
      },
    ];

    const result = computeVendorMetricsFromData(pos, [jobA, jobB, jobC], [], []);
    const m = result.get("v1")!;

    expect(m.avgTurnSamples).toBe(2);
    expect(m.avgTurnDays).toBe(6); // (4 + 8) / 2
    expect(m.avgPoSamples).toBe(2);
    expect(m.avgPoDays).toBe(3); // (2 + 4) / 2
  });
});
