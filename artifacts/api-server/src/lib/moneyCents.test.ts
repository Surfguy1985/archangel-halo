import { describe, expect, it } from "vitest";
import {
  addCents,
  formatUsd,
  mulCents,
  subCents,
  toCents,
  vacancyCostCents,
} from "@workspace/db";
import {
  STAGE_OWNERSHIP_SEED,
  TURN_STAGES,
  CLIENT_BOARD_FLAG_DEFAULTS,
  CLIENT_STAGE_OWNERSHIP_SEED_SQL,
  CLIENT_BOARD_FLAGS_SEED_SQL,
} from "@workspace/db";

describe("Money helper — integer cents only", () => {
  it("rejects floats", () => {
    expect(() => toCents(1.5)).toThrow(/integer/);
    expect(() => toCents(Number.NaN)).toThrow();
  });

  it("adds and subtracts without precision loss", () => {
    expect(addCents(199n, 1n, 100n)).toBe(300n);
    expect(subCents(1000n, 1n)).toBe(999n);
  });

  it("multiplies by integer qty", () => {
    expect(mulCents(18500n, 3)).toBe(55500n);
  });

  it("formats with tabular-friendly two decimals", () => {
    expect(formatUsd(0n)).toBe("$0.00");
    expect(formatUsd(1134000n)).toBe("$11,340.00");
    expect(formatUsd(-250n)).toBe("-$2.50");
  });

  it("computes vacancy cost as over-target days × monthly rent / days-in-month", () => {
    // 4.2 days is not allowed — calendar days are integers. 4 days over,
    // $1,450/mo, 31-day month → 4 * 145000 / 31 = 18709 cents truncated.
    const cost = vacancyCostCents({
      overTargetDays: 4,
      marketRentCents: 145000n,
      daysInMonth: 31,
    });
    expect(cost).toBe((4n * 145000n) / 31n);
    expect(vacancyCostCents({ overTargetDays: 0, marketRentCents: 145000n, daysInMonth: 30 })).toBe(0n);
  });
});

describe("Stage ownership seed", () => {
  it("covers every stage exactly once", () => {
    expect(Object.keys(STAGE_OWNERSHIP_SEED).sort()).toEqual([...TURN_STAGES].sort());
  });

  it("attributes approval delay to the client, crew work to the vendor", () => {
    expect(STAGE_OWNERSHIP_SEED.pending_approval).toBe("client");
    expect(STAGE_OWNERSHIP_SEED.approved).toBe("client");
    expect(STAGE_OWNERSHIP_SEED.in_progress).toBe("vendor");
    expect(STAGE_OWNERSHIP_SEED.qc).toBe("vendor");
    expect(STAGE_OWNERSHIP_SEED.rework).toBe("vendor");
    expect(STAGE_OWNERSHIP_SEED.notice).toBe("shared");
    expect(STAGE_OWNERSHIP_SEED.ready).toBe("shared");
  });

  it("SQL seed matches the TypeScript map", () => {
    for (const [stage, owner] of Object.entries(STAGE_OWNERSHIP_SEED)) {
      expect(CLIENT_STAGE_OWNERSHIP_SEED_SQL).toContain(`('${stage}', '${owner}')`);
    }
  });

  it("ships dataModel, turnEngine, pulse, propertyBoard, and evidence on; later UI segments stay dark", () => {
    expect(CLIENT_BOARD_FLAG_DEFAULTS.dataModel).toBe(true);
    expect(CLIENT_BOARD_FLAG_DEFAULTS.turnEngine).toBe(true);
    expect(CLIENT_BOARD_FLAG_DEFAULTS.pulse).toBe(true);
    expect(CLIENT_BOARD_FLAG_DEFAULTS.propertyBoard).toBe(true);
    expect(CLIENT_BOARD_FLAG_DEFAULTS.evidence).toBe(true);
    expect(CLIENT_BOARD_FLAG_DEFAULTS.invoiceCompliance).toBe(false);
    expect(CLIENT_BOARD_FLAGS_SEED_SQL).toContain("('dataModel', true)");
    expect(CLIENT_BOARD_FLAGS_SEED_SQL).toContain("('turnEngine', true)");
    expect(CLIENT_BOARD_FLAGS_SEED_SQL).toContain("('pulse', true)");
    expect(CLIENT_BOARD_FLAGS_SEED_SQL).toContain("('propertyBoard', true)");
    expect(CLIENT_BOARD_FLAGS_SEED_SQL).toContain("('evidence', true)");
  });
});
