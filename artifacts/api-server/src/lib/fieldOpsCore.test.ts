import { describe, expect, it } from "vitest";
import {
  ackForIntent,
  buildMorningWatch,
  buildPresenceBrief,
  detectEarpieceIntent,
  stripWake,
} from "./fieldOpsCore";

describe("detectEarpieceIntent", () => {
  it("strips Hey HALO and maps three-word field talk", () => {
    expect(stripWake("Hey HALO, go")).toBe("go");
    expect(detectEarpieceIntent("hey halo next").kind).toBe("next");
    expect(detectEarpieceIntent("GO").kind).toBe("go");
    expect(detectEarpieceIntent("skip").kind).toBe("skip");
    expect(detectEarpieceIntent("stop").kind).toBe("stop");
    expect(detectEarpieceIntent("fix this").kind).toBe("fix");
    expect(detectEarpieceIntent("tell the PM we finished 204").kind).toBe("tell");
  });

  it("ignores silence and keeps real sentences as commands", () => {
    expect(detectEarpieceIntent(" ").kind).toBe("noise");
    expect(detectEarpieceIntent("a").kind).toBe("noise");
    const cmd = detectEarpieceIntent("Text Kyann I'm on site at unit 204");
    expect(cmd.kind).toBe("command");
    expect(cmd.command).toMatch(/Kyann/);
  });
});

describe("buildPresenceBrief", () => {
  it("speaks the site, open turns, and uncrewed unit", () => {
    const brief = buildPresenceBrief({
      propertyName: "Thornbury",
      jobs: [
        { jobNo: "J-1042", unitNo: "204", category: "Paint", crewLeaderName: null, status: "open" },
        { jobNo: "J-1043", unitNo: "118", category: "Punch", crewLeaderName: "Kyann Brooks", status: "open" },
      ],
      crewsOnSite: [{ name: "Kyann Brooks", todayStatus: "site" }],
      overdueInvoices: 1,
    });
    expect(brief.spoken).toContain("Thornbury");
    expect(brief.spoken).toContain("2 open turns");
    expect(brief.spoken).toContain("Unit 204 is uncrewed");
    expect(brief.spoken).toContain("Kyann is on site");
    expect(brief.prompt).toContain("I'm on site at Thornbury");
    expect(brief.nextLine).toContain("J-1042");
  });
});

describe("buildMorningWatch", () => {
  it("stays quiet outside morning hours and when the board is empty", () => {
    expect(buildMorningWatch({ hour: 14, pendingTitles: ["x"], doneTitles: [] })).toBeNull();
    expect(buildMorningWatch({ hour: 8, pendingTitles: [], doneTitles: [] })).toBeNull();
  });

  it("reads overnight work in AirPod length", () => {
    const w = buildMorningWatch({
      hour: 7,
      pendingTitles: ["Invoice reminder Oakridge"],
      doneTitles: ["Rebroadcast 118"],
    });
    expect(w?.spoken).toContain("Morning Watch");
    expect(w?.spoken).toContain("Invoice reminder Oakridge");
    expect(w?.prompt).toContain("Waiting:");
  });
});

describe("ackForIntent", () => {
  it("never acks noise", () => {
    expect(ackForIntent("noise")).toBeNull();
    expect(ackForIntent("go")).toBe("Running it.");
  });
});
