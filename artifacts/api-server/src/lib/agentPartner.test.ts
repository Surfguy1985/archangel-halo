import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holt, seriesForHolt, slipDays } from "./agentForecast";
import { cosine, embedSync } from "./agentEmbed";
import { daysHistoryForUnit, recallSimilar, rememberEpisode } from "./agentMemory";
import { consultPartner } from "./agentPartner";
import { queueAct } from "./agentActs";
import { noteIntent, loadPrefs } from "./agentPrefs";
import { buildOpsCortex, type OpsFacts } from "./opsCortex";
import { propertyIdsForClock } from "./agentIds";

describe("holt forecast", () => {
  it("projects a rising vacant-day series without inventing dollars", () => {
    const f = holt([4, 5, 6, 7], 1);
    expect(f).not.toBeNull();
    expect(f!.next).toBeGreaterThanOrEqual(7);
    expect(f!.method).toBe("holt");
  });

  it("falls back to plus-one with a single observation", () => {
    expect(slipDays([], 11)).toEqual({ extraDays: 1, method: "plus-one" });
  });
});

describe("hashed MiniLM-shaped retrieval", () => {
  it("ranks a similar morning above a random one", () => {
    const q = embedSync("what do you need from me at paloma 214");
    const a = embedSync("what do you need me to sign at paloma unit 214");
    const b = embedSync("who is on the baseball team");
    expect(cosine(q, a)).toBeGreaterThan(cosine(q, b));
  });
});

describe("partner memory", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "halo-agent-"));
    process.env.CLIENT_BOARD_AGENT_DIR = dir;
    process.env.AGENT_HF = "0";
  });
  afterEach(async () => {
    delete process.env.CLIENT_BOARD_AGENT_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("remembers a morning and retrieves it", async () => {
    await rememberEpisode({
      question: "what do you need from me",
      answer: "Paloma · 214 waiting on you, 4 days.",
      unit: "214",
      days: 4,
    });
    const { memories, embedder } = await recallSimilar("what do you need me to sign");
    expect(embedder).toBe("hash");
    expect(memories[0]?.unit).toBe("214");
    expect(await daysHistoryForUnit("214")).toEqual([4]);
  });

  it("proposes a HITL sign nudge from cortex", async () => {
    const facts: OpsFacts = {
      date: "2026-08-15",
      voice: "client",
      vacancyCostCents: "1245000",
      unitsInTurn: 1,
      needs: [{ kind: "awaiting_approval", propertyName: "Paloma Creek", unitNumber: "214", days: 4 }],
      crewToday: [],
      turns: [{ propertyName: "Paloma Creek", unitNumber: "214", days: 11 }],
    };
    const out = await consultPartner({
      question: "what's on fire",
      facts,
      cortex: buildOpsCortex(facts),
      focusUnit: "214",
    });
    expect(out.acts[0]?.hitl).toBe(true);
    expect(out.acts[0]?.label).toMatch(/214/);
    expect(out.forecast?.headline).toMatch(/214/);
  });

  it("runs Holt from the turn clock on the first morning", async () => {
    const facts: OpsFacts = {
      date: "2026-08-15",
      voice: "client",
      vacancyCostCents: "1245000",
      unitsInTurn: 1,
      needs: [{ kind: "awaiting_approval", propertyName: "Paloma Creek", unitNumber: "214", days: 4 }],
      crewToday: [],
      turns: [{ propertyName: "Paloma Creek", unitNumber: "214", days: 11 }],
    };
    const out = await consultPartner({
      question: "will 214 slip",
      facts,
      cortex: buildOpsCortex(facts),
      focusUnit: "214",
      clockDays: [8, 9, 10],
      clockSource: "unit",
    });
    expect(out.forecast?.method).toBe("holt");
    expect(out.forecast?.extraDays).toBeGreaterThanOrEqual(1);
    expect(out.fork?.unit).toBe("214");
    expect(out.fork?.daysNow).toBe(11);
    expect(out.fork?.daysIfWait).toBeGreaterThan(11);
    expect(out.fork?.series?.at(-1)).toBe(11);
    expect(out.fork?.ifYouAct).toMatch(/leaves the ranking/);
    expect(out.fork?.ifYouWait).toMatch(/Holt/);
  });

  it("keeps a queued nudge until the wait is gone", async () => {
    queueAct({ id: "nudge-sign-214", label: "sign Paloma · 214", unit: "214", open: "attention" });
    const facts: OpsFacts = {
      date: "2026-08-15",
      voice: "client",
      vacancyCostCents: "1245000",
      unitsInTurn: 1,
      needs: [{ kind: "awaiting_approval", propertyName: "Paloma Creek", unitNumber: "214", days: 4 }],
      crewToday: [],
      turns: [{ propertyName: "Paloma Creek", unitNumber: "214", days: 11 }],
    };
    const out = await consultPartner({
      question: "what's on fire",
      facts,
      cortex: buildOpsCortex(facts),
      focusUnit: "214",
    });
    expect(out.acts[0]?.status).toBe("queued");
    expect(out.acts[0]?.label).toMatch(/Still queued/);
  });

  it("learns a photos preference after two mornings", () => {
    noteIntent("photos");
    expect(noteIntent("photos").preferPhotos).toBe(true);
    expect(loadPrefs().preferPhotos).toBe(true);
  });
});

describe("clock series", () => {
  it("merges clock + current without duplicating the last day", () => {
    expect(seriesForHolt([8, 9, 11], [], 11)).toEqual([8, 9, 11]);
  });

  it("keeps only UUID property ids for the metrics join", () => {
    expect(
      propertyIdsForClock(["not-a-uuid", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]),
    ).toEqual(["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]);
  });
});
