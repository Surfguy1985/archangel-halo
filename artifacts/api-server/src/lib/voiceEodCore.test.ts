import { describe, expect, it } from "vitest";
import {
  MAX_VOICE_EOD_BATCH,
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
});
