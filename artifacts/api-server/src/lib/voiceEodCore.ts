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

export interface VoiceEodStructured {
  done: string[];
  blockers: string[];
  tomorrow: string[];
  fallbackUsed: boolean;
}

function clipList(items: unknown, max = 8): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim().slice(0, 240))
    .slice(0, max);
}

function sentencesOf(text: string): string[] {
  return text
    .split(/[\n.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/** Deterministic extract so a missing model still yields a structured EOD. */
export function heuristicVoiceEodReport(
  transcript: string,
  summary?: string | null,
): VoiceEodStructured {
  const blob = [summary, transcript].filter(Boolean).join("\n");
  const sentences = sentencesOf(blob);
  const done: string[] = [];
  const blockers: string[] = [];
  const tomorrow: string[] = [];
  for (const s of sentences) {
    if (/\b(block|stuck|wait(?:ing)?|need(?:s|ed)?|short|missing|safety)\b/i.test(s)) {
      blockers.push(s);
    } else if (/\b(tomorrow|next\s+day|in the morning|on site tomorrow)\b/i.test(s)) {
      tomorrow.push(s);
    } else if (/\b(finish(?:ed)?|done|complete(?:d)?|wrapped|closed)\b/i.test(s)) {
      done.push(s);
    }
  }
  if (done.length === 0 && summary?.trim()) done.push(summary.trim().slice(0, 240));
  if (done.length === 0 && transcript.trim()) {
    done.push(transcript.trim().slice(0, 240));
  }
  return {
    done: done.slice(0, 8),
    blockers: blockers.slice(0, 8),
    tomorrow: tomorrow.slice(0, 8),
    fallbackUsed: true,
  };
}

export function acceptVoiceEodStructured(
  raw: unknown,
  fallback: VoiceEodStructured,
): VoiceEodStructured {
  if (!raw || typeof raw !== "object") return fallback;
  const o = raw as Record<string, unknown>;
  const done = clipList(o.done);
  const blockers = clipList(o.blockers);
  const tomorrow = clipList(o.tomorrow);
  if (done.length === 0 && blockers.length === 0 && tomorrow.length === 0) return fallback;
  return { done, blockers, tomorrow, fallbackUsed: false };
}
