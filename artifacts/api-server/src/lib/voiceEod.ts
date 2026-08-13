/**
 * Place a single outbound Vapi EOD call. Fail closed. Caller must already
 * have a Falkon ALLOW for field.voice_eod.
 */

import { eq } from "drizzle-orm";
import { db, haloVoiceEodCallsTable } from "@workspace/db";
import { logger } from "./logger";
import { toE164 } from "./smsCore";
import {
  vapiOutboundConfig,
  voiceEodFirstMessage,
  voiceEodSystemPrompt,
} from "./voiceEodCore";

export async function placeVoiceEodCall(opts: {
  crewId: string;
  crewName: string;
  phone: string;
}): Promise<{ ok: true; callId: string; vapiCallId?: string } | { ok: false; error: string; status: number }> {
  const cfg = vapiOutboundConfig(process.env);
  if (!cfg.ok) return { ok: false, error: cfg.error, status: 503 };
  const e164 = toE164(opts.phone);
  if (!e164) return { ok: false, error: "Crew has no valid phone number", status: 400 };

  const firstName = opts.crewName.trim().split(/\s+/)[0] ?? opts.crewName;
  const [row] = await db
    .insert(haloVoiceEodCallsTable)
    .values({
      crewId: opts.crewId,
      phone: e164,
      status: "dialing",
    })
    .returning({ id: haloVoiceEodCallsTable.id });

  try {
    const upstream = await fetch("https://api.vapi.ai/call", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        assistantId: cfg.assistantId,
        phoneNumberId: cfg.phoneNumberId,
        customer: { number: e164, name: opts.crewName },
        assistantOverrides: {
          firstMessage: voiceEodFirstMessage(firstName),
          firstMessageMode: "assistant-speaks-first",
          systemPrompt: voiceEodSystemPrompt(opts.crewName),
          variableValues: {
            crewName: opts.crewName,
            haloCapability: "field.voice_eod",
          },
        },
        metadata: {
          haloCapability: "field.voice_eod",
          haloCallId: row!.id,
          crewId: opts.crewId,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await upstream.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
    };
    if (!upstream.ok) {
      await db
        .update(haloVoiceEodCallsTable)
        .set({ status: "failed", error: json.message ?? `Vapi ${upstream.status}` })
        .where(eq(haloVoiceEodCallsTable.id, row!.id));
      return { ok: false, error: json.message ?? "Vapi call failed", status: 502 };
    }
    await db
      .update(haloVoiceEodCallsTable)
      .set({ vapiCallId: json.id ?? null, status: "dialing" })
      .where(eq(haloVoiceEodCallsTable.id, row!.id));
    return { ok: true, callId: row!.id, vapiCallId: json.id };
  } catch (err) {
    logger.warn({ err, crewId: opts.crewId }, "field.voice_eod place failed");
    await db
      .update(haloVoiceEodCallsTable)
      .set({ status: "failed", error: "Vapi unreachable" })
      .where(eq(haloVoiceEodCallsTable.id, row!.id));
    return { ok: false, error: "Vapi unreachable", status: 502 };
  }
}

export { voiceEodSystemPrompt };
