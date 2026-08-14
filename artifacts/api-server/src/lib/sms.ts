import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, haloSmsMessagesTable } from "@workspace/db";
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
  /** Twilio message SID, present once Twilio accepted the message. */
  sid?: string;
  /**
   * Twilio's *accept* status ("queued"/"accepted"). This is not proof of
   * delivery — the carrier verdict only arrives on the status webhook.
   */
  status?: string;
}

export interface SendSmsOptions {
  /** Crew this message concerns, recorded on the delivery log row. */
  crewId?: string | null;
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
  // HALO_SMS_FROM_NUMBER wins: an account can own several numbers and only some
  // of them clear US carrier registration (A2P 10DLC / toll-free verification).
  // The connector's own number is not necessarily the sendable one, so the
  // operator needs an explicit override that outranks it.
  //
  // Each candidate is tried in turn: a malformed high-precedence value must not
  // strand the send. (This project already carries one malformed
  // TWILIO_FROM_NUMBER secret that cannot be deleted by tooling.)
  const candidates: Array<[string, string | undefined]> = [
    ["HALO_SMS_FROM_NUMBER", process.env.HALO_SMS_FROM_NUMBER?.trim()],
    ["TWILIO_FROM_NUMBER", process.env.TWILIO_FROM_NUMBER?.trim()],
    ["TWILIO_PHONE_NUMBER", process.env.TWILIO_PHONE_NUMBER?.trim()],
  ];
  for (const [name, raw] of candidates) {
    if (!raw) continue;
    const sanitized = sanitizeSenderNumber(raw);
    if (sanitized) return sanitized;
    logger.warn(
      { name, digitCount: raw.replace(/\D/g, "").length },
      "ignoring malformed SMS from-number env value — trying the next source",
    );
  }
  return null;
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

/** Path Twilio calls back with the carrier verdict; nonce is appended. */
const OUTBOUND_STATUS_PATH = "/api/twilio/status/";

/** Public origin for Twilio callbacks, or null when there is no public host. */
function publicBaseUrl(): string | null {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0] ?? process.env.REPLIT_DEV_DOMAIN;
  return domain ? `https://${domain}` : null;
}

/**
 * Record an outbound attempt centrally, so every sender is visible in one log
 * rather than only the three routes that remembered to write a row.
 *
 * Best-effort in both directions: a logging failure must never fail a send,
 * and a send must never be reported as failed because logging failed.
 */
async function recordOutbound(row: {
  crewId?: string | null;
  from: string;
  to: string;
  body: string;
  status: string;
  sid?: string | null;
  nonce?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    await db.insert(haloSmsMessagesTable).values({
      direction: "outbound",
      crewId: row.crewId ?? null,
      fromE164: row.from,
      toE164: row.to,
      body: row.body,
      twilioSid: row.sid ?? null,
      callbackNonce: row.nonce ?? null,
      status: row.status,
      errorMessage: row.errorMessage ?? null,
    });
  } catch (err) {
    logger.warn({ err }, "failed to record outbound sms");
  }
}

/** Status a reserved row carries until Twilio's response or callback lands. */
const PENDING_STATUS = "pending";

/**
 * Reserve the log row *before* the message is handed to Twilio.
 *
 * Twilio can deliver the status callback before its own HTTP response gets
 * back to us. If the row did not exist yet, that callback would match nothing,
 * be acknowledged with 200, and the delivery verdict would be lost for good.
 *
 * Returns the row id, or null when the row could not be written — in which
 * case the caller must not request a callback it cannot correlate.
 */
async function createPendingOutbound(row: {
  crewId?: string | null;
  from: string;
  to: string;
  body: string;
  nonce: string | null;
}): Promise<string | null> {
  try {
    const [inserted] = await db
      .insert(haloSmsMessagesTable)
      .values({
        direction: "outbound",
        crewId: row.crewId ?? null,
        fromE164: row.from,
        toE164: row.to,
        body: row.body,
        callbackNonce: row.nonce,
        status: PENDING_STATUS,
      })
      .returning({ id: haloSmsMessagesTable.id });
    return inserted?.id ?? null;
  } catch (err) {
    logger.warn({ err }, "failed to reserve outbound sms row");
    return null;
  }
}

/**
 * Attach Twilio's accepted SID and status. The CASE guard matters: a delivery
 * callback may already have settled this row, and "queued" must never
 * overwrite a verdict that has already arrived.
 */
async function settleAccepted(id: string, sid: string | null, status: string): Promise<void> {
  try {
    await db
      .update(haloSmsMessagesTable)
      .set({
        ...(sid ? { twilioSid: sid } : {}),
        status: sql`CASE WHEN ${haloSmsMessagesTable.status} = ${PENDING_STATUS} THEN ${status} ELSE ${haloSmsMessagesTable.status} END`,
        updatedAt: new Date(),
      })
      .where(eq(haloSmsMessagesTable.id, id));
  } catch (err) {
    logger.warn({ err }, "failed to settle accepted sms row");
  }
}

/**
 * Mark a reserved row failed — Twilio rejected the send or the call threw.
 *
 * Guarded like the accepted path: if we lost Twilio's HTTP response but the
 * message actually went out, its callback may already have written the real
 * verdict, and a local timeout must not overwrite it with "failed".
 */
async function settleFailed(id: string, message: string): Promise<void> {
  try {
    await db
      .update(haloSmsMessagesTable)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(
        and(
          eq(haloSmsMessagesTable.id, id),
          eq(haloSmsMessagesTable.status, PENDING_STATUS),
        ),
      );
  } catch (err) {
    logger.warn({ err }, "failed to settle failed sms row");
  }
}

/**
 * Best-effort SMS via Twilio. Never throws — callers treat SMS
 * as an optional side channel and must not fail the primary action on error.
 *
 * A resolved `ok` means Twilio *accepted* the message, not that a phone
 * received it. Carriers reject unregistered A2P traffic after acceptance, so
 * the real verdict lands later on the status webhook and is written to the
 * message's log row.
 */
export async function sendSms(
  to: string,
  body: string,
  opts: SendSmsOptions = {},
): Promise<SendSmsResult> {
  const s = await getTwilioSettings();
  if (!s || !s.phoneNumber) {
    await recordOutbound({
      crewId: opts.crewId,
      from: s?.phoneNumber ?? "unconfigured",
      to: toE164(to) ?? to,
      body,
      status: "failed",
      errorMessage: "SMS not configured",
    });
    return { ok: false, error: "SMS not configured" };
  }
  const dest = toE164(to);
  if (!dest || !isDialableE164(dest)) {
    // A crew row with a junk phone number is a real cause of "they never got
    // the text" — log it rather than dropping it on the floor.
    await recordOutbound({
      crewId: opts.crewId,
      from: s.phoneNumber,
      to: dest ?? to,
      body,
      status: "failed",
      errorMessage: "Invalid phone number",
    });
    return { ok: false, error: "Invalid phone number" };
  }
  // Basic-auth username is the API Key SID when key auth is in play, else the
  // Account SID. Sending the wrong one yields Twilio 20003 "invalid username".
  const useKey = !!(s.apiKey && s.apiKeySecret);
  const user = useKey ? s.apiKey : s.accountSid;
  const pass = useKey ? s.apiKeySecret : s.authToken;
  if (!pass) {
    await recordOutbound({
      crewId: opts.crewId,
      from: s.phoneNumber,
      to: dest,
      body,
      status: "failed",
      errorMessage: "SMS not configured",
    });
    return { ok: false, error: "SMS not configured" };
  }
  if (!isAccountSid(s.accountSid)) {
    logger.warn("twilio account sid is missing or malformed — refusing to send");
    await recordOutbound({
      crewId: opts.crewId,
      from: s.phoneNumber,
      to: dest,
      body,
      status: "failed",
      errorMessage: "Twilio account is misconfigured",
    });
    return { ok: false, error: "Twilio account is misconfigured" };
  }

  // Unguessable per-message token; the delivery webhook uses it to prove the
  // callback belongs to this message (API-key auth leaves no signing token).
  const nonce = randomBytes(16).toString("hex");
  const base = publicBaseUrl();
  // Reserve the row first — Twilio's callback can beat its own HTTP response.
  const rowId = await createPendingOutbound({
    crewId: opts.crewId,
    from: s.phoneNumber,
    to: dest,
    body,
    nonce: base ? nonce : null,
  });
  const params: Record<string, string> = { To: dest, From: s.phoneNumber, Body: body };
  // Only ask for a callback that can actually be correlated to a stored row.
  if (base && rowId) params.StatusCallback = `${base}${OUTBOUND_STATUS_PATH}${nonce}`;

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
        body: new URLSearchParams(params).toString(),
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
      const message = detail || `Twilio error ${res.status}`;
      if (rowId) await settleFailed(rowId, message);
      return { ok: false, error: message };
    }
    const accepted = (await res.json().catch(() => ({}))) as {
      sid?: string;
      status?: string;
    };
    // Twilio's own accept status ("queued"/"accepted"); the webhook settles it.
    if (rowId) await settleAccepted(rowId, accepted.sid ?? null, accepted.status || "queued");
    return { ok: true, sid: accepted.sid, status: accepted.status };
  } catch (err) {
    logger.warn({ err }, "twilio sms failed");
    if (rowId) await settleFailed(rowId, "SMS send failed");
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
