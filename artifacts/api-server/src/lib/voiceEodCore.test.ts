import { describe, expect, it } from "vitest";
import {
  MAX_VOICE_EOD_BATCH,
  acceptVoiceEodStructured,
  heuristicVoiceEodReport,
  vapiOutboundConfig,
  voiceEodBatchAllowed,
  voiceEodFirstMessage,
} from "./voiceEodCore";

describe("field.voice_eod policy", () => {
  it("fails closed when Vapi ids are missing or not UUIDs", () => {
    expect(vapiOutboundConfig({}).ok).toBe(false);
    expect(
      vapiOutboundConfig({
        VAPI_API_KEY: "k",
        VAPI_ASSISTANT_ID: "not-a-uuid",
        VAPI_PHONE_NUMBER_ID: "11111111-1111-1111-1111-111111111111",
      }).ok,
    ).toBe(false);
    expect(
      vapiOutboundConfig({
        VAPI_API_KEY: "k",
        VAPI_ASSISTANT_ID: "11111111-1111-1111-1111-111111111111",
        VAPI_PHONE_NUMBER_ID: "22222222-2222-2222-2222-222222222222",
      }).ok,
    ).toBe(true);
  });

  it("caps auto-dial batches", () => {
    expect(voiceEodBatchAllowed(MAX_VOICE_EOD_BATCH)).toBe(true);
    expect(voiceEodBatchAllowed(MAX_VOICE_EOD_BATCH + 1)).toBe(false);
    expect(voiceEodFirstMessage("Marcus")).toContain("Marcus");
  });

  it("extracts a structured report from a transcript without a model", () => {
    const report = heuristicVoiceEodReport(
      "We finished unit 12 paint. Waiting on parts for the dishwasher. Tomorrow two of us are on site.",
    );
    expect(report.fallbackUsed).toBe(true);
    expect(report.done.join(" ")).toMatch(/finished/i);
    expect(report.blockers.join(" ")).toMatch(/Waiting/i);
    expect(report.tomorrow.join(" ")).toMatch(/Tomorrow/i);
  });

  it("keeps the heuristic when model JSON is empty", () => {
    const fallback = heuristicVoiceEodReport("Wrapped the turn today.");
    expect(acceptVoiceEodStructured({}, fallback)).toEqual(fallback);
    expect(
      acceptVoiceEodStructured({ done: ["Paint"], blockers: [], tomorrow: ["Back at 7"] }, fallback).fallbackUsed,
    ).toBe(false);
  });
});
