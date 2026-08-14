import { logger } from "./logger";
import { toE164 } from "./smsCore";

export interface SendSmsResult {
  ok: boolean;
  error?: string;
}

export type TwilioSettings = {
  accountSid: string;
  authToken?: string;
  apiKey?: string;
  apiKeySecret?: string;
  phoneNumber?: string;
};

let cached: { settings: TwilioSettings | null; at: number } | null = null;

function envTwilioSettings(): TwilioSettings | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const phoneNumber = process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!accountSid || !phoneNumber) return null;
  if (!authToken && !(process.env.TWILIO_API_KEY?.trim() && process.env.TWILIO_API_KEY_SECRET?.trim())) {
    return null;
  }
  return {
    accountSid,
    authToken,
    apiKey: process.env.TWILIO_API_KEY?.trim(),
    apiKeySecret: process.env.TWILIO_API_KEY_SECRET?.trim(),
    phoneNumber,
  };
}

async function connectorTwilioSettings(): Promise<TwilioSettings | null> {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) return null;
  const res = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=twilio`,
    {
      headers: {
        Accept: "application/json",
        X_REPLIT_TOKEN: xReplitToken,
      },
    },
  );
  if (!res.ok) throw new Error(`connector lookup ${res.status}`);
  const data = (await res.json()) as {
    items?: Array<{ settings?: Record<string, string> }>;
  };
  const s = data.items?.[0]?.settings;
  if (!s?.account_sid) return null;
  // Prefer TWILIO_FROM_NUMBER secret if set, fall back to connector's stored number
  const phoneNumber =
    process.env.TWILIO_FROM_NUMBER?.trim() || s.phone_number;
  return {
    accountSid: s.account_sid,
    authToken: s.auth_token,
    apiKey: s.api_key,
    apiKeySecret: s.api_key_secret,
    phoneNumber,
  };
}

export async function getTwilioSettings(): Promise<TwilioSettings | null> {
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.settings;
  const fromEnv = envTwilioSettings();
  if (fromEnv) {
    cached = { settings: fromEnv, at: Date.now() };
    return fromEnv;
  }
  try {
    const settings = await connectorTwilioSettings();
    cached = { settings, at: Date.now() };
    return settings;
  } catch (err) {
    logger.warn({ err }, "twilio connector settings unavailable");
    cached = { settings: null, at: Date.now() };
    return null;
  }
}

/** Whether SMS sending is possible (Twilio connector or env present with a number). */
export async function smsEnabled(): Promise<boolean> {
  const s = await getTwilioSettings();
  return !!(s && s.phoneNumber && (s.authToken || (s.apiKey && s.apiKeySecret)));
}

/**
 * Best-effort SMS via Twilio. Never throws — callers treat SMS
 * as an optional side channel and must not fail the primary action on error.
 */
export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  const s = await getTwilioSettings();
  if (!s || !s.phoneNumber) return { ok: false, error: "SMS not configured" };
  const dest = toE164(to);
  if (!dest) return { ok: false, error: "Invalid phone number" };
  const user = s.apiKey && s.apiKeySecret ? s.apiKey : s.accountSid;
  const pass = s.apiKey && s.apiKeySecret ? s.apiKeySecret : s.authToken;
  if (!pass) return { ok: false, error: "SMS not configured" };
  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${s.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Basic " + Buffer.from(`${user}:${pass}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: dest,
          From: s.phoneNumber,
          Body: body,
        }).toString(),
      },
    );
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { message?: string };
        detail = j?.message ?? "";
      } catch {
        /* ignore */
      }
      logger.warn({ status: res.status, detail }, "twilio sms failed");
      return { ok: false, error: detail || `Twilio error ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    logger.warn({ err }, "twilio sms failed");
    return { ok: false, error: "SMS send failed" };
  }
}

/** Safe status for the Pulse HUD — never returns tokens or full numbers. */
export async function smsPublicStatus(): Promise<{ configured: boolean; fromLast4: string | null }> {
  const s = await getTwilioSettings();
  const configured = !!(s && s.phoneNumber && (s.authToken || (s.apiKey && s.apiKeySecret)));
  const digits = (s?.phoneNumber ?? "").replace(/\D/g, "");
  return {
    configured,
    fromLast4: configured && digits.length >= 4 ? digits.slice(-4) : null,
  };
}
