import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverEntrataCsvs, parseSourceArg } from "./seedClientBoardLive";

describe("live Entrata ingest discovery", () => {
  it("parses --source= and --source <dir>", () => {
    expect(parseSourceArg(["--source=./caf-export/"])).toBe("./caf-export/");
    expect(parseSourceArg(["--source", "./caf-export/"])).toBe("./caf-export/");
  });

  it("walks kind directories and root-level CSVs in import order", () => {
    const dir = mkdtempSync(join(tmpdir(), "caf-live-"));
    mkdirSync(join(dir, "units"));
    writeFileSync(join(dir, "units", "a.csv"), "property_id,unit\n");
    writeFileSync(join(dir, "leases.csv"), "property_id,unit\n");
    mkdirSync(join(dir, "notices"));
    writeFileSync(join(dir, "notices", "n.csv"), "property_id,unit\n");
    writeFileSync(join(dir, "purchase_orders.csv"), "property_id,po\n");
    const found = discoverEntrataCsvs(dir);
    expect(found.map((f) => f.kind)).toEqual(["units", "leases", "notices", "purchase_orders"]);
  });
});
