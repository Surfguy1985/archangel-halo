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
