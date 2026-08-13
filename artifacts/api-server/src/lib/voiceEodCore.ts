/**
 * field.voice_eod — outbound Vapi policy. Fail closed. No auto-dial batches.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const MAX_VOICE_EOD_BATCH = 10;

export function vapiOutboundConfig(env: {
  VAPI_API_KEY?: string;
  VAPI_ASSISTANT_ID?: string;
  VAPI_PHONE_NUMBER_ID?: string;
}): { ok: true; apiKey: string; assistantId: string; phoneNumberId: string } | { ok: false; error: string } {
  const apiKey = env.VAPI_API_KEY?.trim() ?? "";
  const assistantId = env.VAPI_ASSISTANT_ID?.trim() ?? "";
  const phoneNumberId = env.VAPI_PHONE_NUMBER_ID?.trim() ?? "";
  if (!apiKey || !assistantId || !phoneNumberId) {
    return { ok: false, error: "Vapi outbound is not configured (VAPI_API_KEY, VAPI_ASSISTANT_ID, VAPI_PHONE_NUMBER_ID)." };
  }
  if (!UUID_RE.test(assistantId)) {
    return { ok: false, error: "VAPI_ASSISTANT_ID must be a UUID from the Vapi dashboard." };
  }
  if (!UUID_RE.test(phoneNumberId)) {
    return { ok: false, error: "VAPI_PHONE_NUMBER_ID must be a UUID from the Vapi dashboard." };
  }
  return { ok: true, apiKey, assistantId, phoneNumberId };
}

export function voiceEodBatchAllowed(count: number): boolean {
  return count > 0 && count <= MAX_VOICE_EOD_BATCH;
}

export function voiceEodFirstMessage(crewFirstName: string): string {
  const name = crewFirstName.trim() || "there";
  return `Hi ${name}, this is HALO with a quick end-of-day check-in. What got finished today, and anything blocked for tomorrow?`;
}

export function voiceEodSystemPrompt(crewName: string): string {
  return [
    "You are HALO collecting a short end-of-day field report.",
    `You are speaking with ${crewName || "a crew member"}.`,
    "Ask: what work finished, what is still open, any safety or material blockers, and who is on site tomorrow.",
    "Keep turns short. Do not discuss invoices, pay, or schedule changes. Do not claim you can move jobs.",
    "When they are done, thank them and end the call.",
  ].join(" ");
}
