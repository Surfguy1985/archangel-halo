import { logger } from "./logger";
import {
  isAccountSid,
  isApiKeySid,
  isDialableE164,
  pickTwilioIdentity,
  sanitizeSenderNumber,
  toE164,
} from "./smsCore";

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

const SETTINGS_TTL_MS = 5 * 60 * 1000;
/** Failures expire quickly so a transient outage — or a just-repaired
 *  connector — does not lock SMS off for the full success TTL. */
const SETTINGS_FAIL_TTL_MS = 30 * 1000;

/**
 * The configured sending number, or null when it is unusable. A malformed
 * TWILIO_FROM_NUMBER must never shadow a working connector number — that turns
 * a fixable config typo into an opaque Twilio rejection at send time.
 */
function envFromNumber(): string | null {
  const raw = process.env.TWILIO_FROM_NUMBER?.trim() || process.env.TWILIO_PHONE_NUMBER?.trim();
  if (!raw) return null;
  const sanitized = sanitizeSenderNumber(raw);
  if (!sanitized) {
    logger.warn(
      { digitCount: raw.replace(/\D/g, "").length },
      "ignoring malformed TWILIO_FROM_NUMBER — falling back to the connector number",
    );
  }
  return sanitized;
}

function envTwilioSettings(): TwilioSettings | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const phoneNumber = envFromNumber();
  if (!accountSid || !phoneNumber) return null;
  // Only an SK-shaped value counts as an API key. Junk here must not displace a
  // working auth token — selecting it as the Basic-auth username is precisely
  // how Twilio 20003 "invalid username" arises.
  const rawKey = process.env.TWILIO_API_KEY?.trim();
  const rawSecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const useKey = isApiKeySid(rawKey) && !!rawSecret;
  if (rawKey && !useKey) {
    logger.warn("ignoring TWILIO_API_KEY — not a valid SK SID paired with a secret");
  }
  if (!authToken && !useKey) return null;
  return {
    accountSid,
    authToken,
    apiKey: useKey ? rawKey : undefined,
    apiKeySecret: useKey ? rawSecret : undefined,
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
  if (!s) return null;

  // Field names in the connector bag are not trustworthy — resolve by shape.
  const { accountSid, apiKeySid } = pickTwilioIdentity(s);
  const apiKeySecret = s.api_key_secret?.trim() || undefined;
  const authToken = s.auth_token?.trim() || undefined;

  // Every REST path needs the Account SID; a key-only bag can still recover it.
  let resolvedAccount = accountSid;
  if (!resolvedAccount && apiKeySid && apiKeySecret) {
    resolvedAccount = await discoverAccountSid(apiKeySid, apiKeySecret);
  }
  if (!resolvedAccount) {
    logger.warn(
      { hasApiKeySid: !!apiKeySid, hasSecret: !!apiKeySecret, hasAuthToken: !!authToken },
      "twilio connector has no usable Account SID",
    );
    return null;
  }

  // Prefer a valid TWILIO_FROM_NUMBER secret, else the connector's own number.
  // Both go through the same sender validation — connector values are operator
  // -entered too and can be just as malformed.
  const phoneNumber = envFromNumber() ?? sanitizeSenderNumber(s.phone_number) ?? undefined;
  return {
    accountSid: resolvedAccount,
    authToken,
    apiKey: apiKeySid ?? undefined,
    apiKeySecret,
    phoneNumber,
  };
}

/**
 * Twilio's messaging/verify APIs are scoped by the credential itself rather than
 * by an Account SID in the path, so a single authenticated read reveals the
 * owning account when the connector never stored it.
 */
async function discoverAccountSid(apiKeySid: string, apiKeySecret: string): Promise<string | null> {
  const auth = "Basic " + Buffer.from(`${apiKeySid}:${apiKeySecret}`).toString("base64");
  for (const url of [
    "https://messaging.twilio.com/v1/Services?PageSize=1",
    "https://verify.twilio.com/v2/Services?PageSize=1",
  ]) {
    try {
      const res = await fetch(url, { headers: { Authorization: auth } });
      if (!res.ok) continue;
      // Read the structured owning-account field rather than scraping the body,
      // which could match an unrelated AC-shaped string.
      const body = (await res.json()) as { services?: Array<{ account_sid?: string }> };
      const owner = body.services?.map((svc) => svc.account_sid).find(isAccountSid);
      if (owner) {
        logger.info("recovered twilio account sid from the api key");
        return owner;
      }
    } catch (err) {
      logger.warn({ err }, "twilio account sid discovery failed");
    }
  }
  return null;
}

export async function getTwilioSettings(): Promise<TwilioSettings | null> {
  if (cached) {
    const ttl = cached.settings ? SETTINGS_TTL_MS : SETTINGS_FAIL_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached.settings;
  }
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
  return !!(s && s.phoneNumber && isAccountSid(s.accountSid) && (s.authToken || (s.apiKey && s.apiKeySecret)));
}

/**
 * Best-effort SMS via Twilio. Never throws — callers treat SMS
 * as an optional side channel and must not fail the primary action on error.
 */
export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  const s = await getTwilioSettings();
  if (!s || !s.phoneNumber) return { ok: false, error: "SMS not configured" };
  const dest = toE164(to);
  if (!dest || !isDialableE164(dest)) return { ok: false, error: "Invalid phone number" };
  // Basic-auth username is the API Key SID when key auth is in play, else the
  // Account SID. Sending the wrong one yields Twilio 20003 "invalid username".
  const useKey = !!(s.apiKey && s.apiKeySecret);
  const user = useKey ? s.apiKey : s.accountSid;
  const pass = useKey ? s.apiKeySecret : s.authToken;
  if (!pass) return { ok: false, error: "SMS not configured" };
  if (!isAccountSid(s.accountSid)) {
    logger.warn("twilio account sid is missing or malformed — refusing to send");
    return { ok: false, error: "Twilio account is misconfigured" };
  }
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
  const configured = !!(
    s &&
    s.phoneNumber &&
    isAccountSid(s.accountSid) &&
    (s.authToken || (s.apiKey && s.apiKeySecret))
  );
  const digits = (s?.phoneNumber ?? "").replace(/\D/g, "");
  return {
    configured,
    fromLast4: configured && digits.length >= 4 ? digits.slice(-4) : null,
  };
}
