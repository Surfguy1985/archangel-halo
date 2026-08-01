import { logger } from "./logger";

export interface SendSmsResult {
  ok: boolean;
  error?: string;
}

type TwilioSettings = {
  accountSid: string;
  authToken?: string;
  apiKey?: string;
  apiKeySecret?: string;
  phoneNumber?: string;
};

// Twilio credentials come from the Replit Twilio connector — never from
// hand-managed secrets. Cached briefly; tokens can rotate.
let cached: { settings: TwilioSettings | null; at: number } | null = null;

async function getTwilioSettings(): Promise<TwilioSettings | null> {
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.settings;
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;
  if (!hostname || !xReplitToken) {
    cached = { settings: null, at: Date.now() };
    return null;
  }
  try {
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
    if (!s?.account_sid) {
      cached = { settings: null, at: Date.now() };
      return null;
    }
    const settings: TwilioSettings = {
      accountSid: s.account_sid,
      authToken: s.auth_token,
      apiKey: s.api_key,
      apiKeySecret: s.api_key_secret,
      phoneNumber: s.phone_number,
    };
    cached = { settings, at: Date.now() };
    return settings;
  } catch (err) {
    logger.warn({ err }, "twilio connector settings unavailable");
    cached = { settings: null, at: Date.now() };
    return null;
  }
}

/** Whether SMS sending is possible (Twilio connector present with a number). */
export async function smsEnabled(): Promise<boolean> {
  const s = await getTwilioSettings();
  return !!(s && s.phoneNumber && (s.authToken || (s.apiKey && s.apiKeySecret)));
}

/**
 * Best-effort SMS via the Twilio connector. Never throws — callers treat SMS
 * as an optional side channel and must not fail the primary action on error.
 */
export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  const s = await getTwilioSettings();
  if (!s || !s.phoneNumber) return { ok: false, error: "SMS not configured" };
  const digits = to.replace(/[^\d+]/g, "");
  if (digits.replace(/\D/g, "").length < 10) {
    return { ok: false, error: "Invalid phone number" };
  }
  const toE164 = digits.startsWith("+")
    ? digits
    : `+1${digits.replace(/\D/g, "").slice(-10)}`;
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
          To: toE164,
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
