import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type BusinessSnapshot } from "./commandBrain";

const snap: BusinessSnapshot = {
  date: "2026-08-14",
  hour: 10,
  todayItems: [],
  properties: [{ id: "p1", name: "Cedar Point", city: "Austin", address: "1 Main", units: 48, status: "active" }],
  roster: {
    crews: [{ id: "c1", name: "Kyann Brooks", trade: "drywall", phone: true }],
    contacts: [{ name: "Alex PM", role: "manager", phone: true, propertyId: "p1" }],
    vendors: [{ id: "v1", name: "ABC Building Supply", trade: "drywall" }],
    inventory: [{ name: "Drywall sheet", qty: 40, vendor: "ABC" }],
    catalog: ["Drywall patch"],
  },
  calendar: [],
  pendingRequests: 0,
  jobs: {
    total: 1,
    open: 1,
    overdue: 0,
    uncrewed: 1,
    overBudget: 0,
    recentOpen: [{
      id: "j1", jobNo: "J-2001", unitNo: "624", propertyId: "p1", propertyName: "Cedar Point",
      status: "open", boardStatus: "active", scheduledOn: null,
    }],
  },
  invoices: { totalReceivables: 0, overdueCount: 0, sentCount: 0, pendingCrewPay: 0 },
  crews: { total: 1, checkedInToday: 0 },
  margin: { avgMarginPct: 0.3, flaggedCount: 0 },
  falkonMode: "ASSISTED",
  snapshotScope: { mode: "tenant" },
};

describe("HALO Jarvis prompt", () => {
  it("grounds Claude on roster, units, and compound missions", () => {
    const prompt = buildSystemPrompt("executive", snap);
    expect(prompt).toContain("Kyann Brooks");
    expect(prompt).toContain("Unit 624");
    expect(prompt).toContain("COMPOUND COMMANDS");
    expect(prompt).toContain("supply.order");
    expect(prompt).toContain("Jarvis");
  });
});
