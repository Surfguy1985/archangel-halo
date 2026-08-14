/**
 * comms.sms helpers — E.164 normalize + Twilio request signature (HMAC-SHA1).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = phoneDigits(trimmed);
  if (digits.length < 10) return null;
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+1${digits.slice(-10)}`;
}

/**
 * E.164 allows at most 15 digits. `toE164` is deliberately forgiving so operators
 * can type numbers loosely, but a *sending* number has to be genuinely dialable —
 * otherwise a malformed config value reaches Twilio and fails opaquely.
 */
export function isDialableE164(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return /^\+[1-9]\d{9,14}$/.test(raw.trim());
}

/**
 * Normalize a value intended as an SMS *sending* number, or null when it cannot
 * be trusted. `toE164` falls back to the last 10 digits of an over-long string,
 * which would silently reshape a corrupt setting into a real-looking number the
 * account may not own — so the raw digit count is checked first.
 */
export function sanitizeSenderNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const digits = phoneDigits(trimmed);
  if (digits.length < 10 || digits.length > 15) return null;
  const e164 = toE164(trimmed);
  return e164 && isDialableE164(e164) ? e164 : null;
}

/**
 * Twilio Account SIDs (AC…) and API Key SIDs (SK…) are both 34 characters, so
 * they are trivially easy to paste into each other's field. Match on shape and
 * treat the field name as nothing more than a hint.
 */
export function isAccountSid(v: unknown): v is string {
  return typeof v === "string" && /^AC[0-9a-f]{32}$/i.test(v.trim());
}

export function isApiKeySid(v: unknown): v is string {
  return typeof v === "string" && /^SK[0-9a-f]{32}$/i.test(v.trim());
}

/**
 * Recover Twilio identifiers from a settings bag whose fields may be crossed
 * (an API Key SID stored under `account_sid`, a nickname under `api_key`, …).
 * Prefers a correctly-named field, then falls back to any value of the right shape.
 */
export function pickTwilioIdentity(bag: Record<string, unknown>): {
  accountSid: string | null;
  apiKeySid: string | null;
} {
  const values = Object.values(bag)
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .map((v) => v.trim());
  const named = (key: string, pred: (v: unknown) => boolean): string | null => {
    const v = bag[key];
    return typeof v === "string" && pred(v.trim()) ? v.trim() : null;
  };
  return {
    accountSid: named("account_sid", isAccountSid) ?? values.find(isAccountSid) ?? null,
    apiKeySid: named("api_key", isApiKeySid) ?? values.find(isApiKeySid) ?? null,
  };
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = a ? phoneDigits(a) : "";
  const db = b ? phoneDigits(b) : "";
  if (da.length < 10 || db.length < 10) return false;
  return da.slice(-10) === db.slice(-10);
}

export function twilioSignaturePayload(url: string, params: Record<string, string>): string {
  const keys = Object.keys(params).sort();
  let data = url;
  for (const k of keys) data += k + (params[k] ?? "");
  return data;
}

export function verifyTwilioSignature(opts: {
  authToken: string;
  signature: string;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!opts.authToken || !opts.signature) return false;
  const expected = createHmac("sha1", opts.authToken)
    .update(twilioSignaturePayload(opts.url, opts.params), "utf8")
    .digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(opts.signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const MAX_SMS_BLAST = 25;
export const MAX_SMS_BODY = 1600;

export function smsBlastAllowed(count: number): boolean {
  return count > 0 && count <= MAX_SMS_BLAST;
}
