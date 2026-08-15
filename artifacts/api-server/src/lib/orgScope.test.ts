import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ClientBoardRepo, MissingOrgScopeError, stripResidentPii, applyDemoSafe, RESIDENT_PII_KEYS } from "@workspace/db";

describe("ClientBoardRepo org scope", () => {
  it("throws MissingOrgScopeError when orgId is missing", () => {
    expect(() => new ClientBoardRepo(null)).toThrow(MissingOrgScopeError);
    expect(() => new ClientBoardRepo("")).toThrow(MissingOrgScopeError);
    expect(() => new ClientBoardRepo("  ")).toThrow(MissingOrgScopeError);
  });

  it("accepts a session org id", () => {
    expect(new ClientBoardRepo("org-1").orgId).toBe("org-1");
  });
});

describe("stripResidentPii", () => {
  it("drops resident and tenant contact keys, keeps unit number", () => {
    expect(
      stripResidentPii({
        unitNumber: "140",
        residentName: "Ada",
        resident_email: "ada@example.com",
        tenantPhone: "555",
        nested: { tenantEmail: "hidden", rooms: 2 },
      }),
    ).toEqual({
      unitNumber: "140",
      nested: { rooms: 2 },
    });
    expect(RESIDENT_PII_KEYS).toContain("residentName");
  });
});

describe("applyDemoSafe", () => {
  it("redacts capturer names, emails, and phones for screen-sharing", () => {
    expect(
      applyDemoSafe({
        unitNumber: "140",
        capturedByName: "Maya Chen",
        capturedByUserId: "maya@caf.test",
        actorId: "office@caf.test",
        phone: "555-0100",
        vacancyCostCents: "1245000",
      }),
    ).toEqual({
      unitNumber: "140",
      capturedByName: "Crew",
      capturedByUserId: "••••",
      actorId: "••••",
      phone: "••••",
      vacancyCostCents: "1245000",
    });
  });
});

describe("client-board route layer", () => {
  const routesDir = path.resolve(process.cwd(), "src/routes");
  const forbidden =
    /from\(\s*(clientTurnsTable|clientEvidenceItemsTable|clientAuditLogTable|clientUnitsTable)\s*\)/;
  const pii = /\b(residentName|tenantEmail)\b/;

  it("does not select client-board tables outside the repository", () => {
    const hits: string[] = [];
    for (const name of readdirSync(routesDir)) {
      if (!name.endsWith(".ts") || name.includes(".test.")) continue;
      const src = readFileSync(path.join(routesDir, name), "utf8");
      if (forbidden.test(src)) hits.push(name);
    }
    expect(hits).toEqual([]);
  });

  it("does not serialize resident PII on client-board routes", () => {
    const hits: string[] = [];
    for (const name of readdirSync(routesDir)) {
      if (!name.endsWith(".ts") || name.includes(".test.")) continue;
      const src = readFileSync(path.join(routesDir, name), "utf8");
      if (pii.test(src)) hits.push(name);
    }
    expect(hits).toEqual([]);
  });
});
