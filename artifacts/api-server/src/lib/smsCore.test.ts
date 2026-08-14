import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  describeSmsError,
  isAccountSid,
  isApiKeySid,
  isDialableE164,
  phonesMatch,
  pickTwilioIdentity,
  sanitizeSenderNumber,
  smsBlastAllowed,
  toE164,
  twilioSignaturePayload,
  verifyTwilioSignature,
} from "./smsCore";

const AC = "AC" + "0".repeat(32);
const SK = "SK" + "1".repeat(32);

describe("comms.sms helpers", () => {
  it("normalizes US numbers to E.164", () => {
    expect(toE164("(214) 555-0100")).toBe("+12145550100");
    expect(toE164("+1 214 555 0100")).toBe("+12145550100");
    expect(toE164("12")).toBeNull();
  });

  it("matches phones on the last 10 digits", () => {
    expect(phonesMatch("2145550100", "+1 (214) 555-0100")).toBe(true);
    expect(phonesMatch("2145550100", "2145550199")).toBe(false);
  });

  it("rejects sending numbers that are not dialable E.164", () => {
    expect(isDialableE164("+12145550100")).toBe(true);
    // 19 digits — longer than E.164 allows, so it must not be used as a From.
    expect(isDialableE164("+1234567890123456789")).toBe(false);
    expect(isDialableE164("2145550100")).toBe(false);
    expect(isDialableE164(null)).toBe(false);
  });

  it("refuses to normalize an untrustworthy sending number", () => {
    expect(sanitizeSenderNumber("(844) 321-0763")).toBe("+18443210763");
    expect(sanitizeSenderNumber("+18443210763")).toBe("+18443210763");
    // 19 digits: toE164 would salvage the last 10 and invent a number the
    // account does not own, so this must be rejected outright.
    expect(sanitizeSenderNumber("1844321076312345678")).toBeNull();
    expect(sanitizeSenderNumber("555-0100")).toBeNull();
    expect(sanitizeSenderNumber("   ")).toBeNull();
    expect(sanitizeSenderNumber(undefined)).toBeNull();
  });

  it("distinguishes Account SIDs from API Key SIDs", () => {
    expect(isAccountSid(AC)).toBe(true);
    expect(isAccountSid(SK)).toBe(false);
    expect(isApiKeySid(SK)).toBe(true);
    expect(isApiKeySid("MP123456")).toBe(false);
  });

  it("recovers Twilio identifiers from crossed connector fields", () => {
    // Well-formed bag.
    expect(pickTwilioIdentity({ account_sid: AC, api_key: SK })).toEqual({
      accountSid: AC,
      apiKeySid: SK,
    });
    // An API Key SID filed under account_sid, with junk under api_key.
    expect(pickTwilioIdentity({ account_sid: SK, api_key: "MP123456" })).toEqual({
      accountSid: null,
      apiKeySid: SK,
    });
    expect(pickTwilioIdentity({})).toEqual({ accountSid: null, apiKeySid: null });
  });

  it("caps blast size", () => {
    expect(smsBlastAllowed(1)).toBe(true);
    expect(smsBlastAllowed(25)).toBe(true);
    expect(smsBlastAllowed(26)).toBe(false);
  });

  it("verifies Twilio HMAC-SHA1 signatures fail-closed", () => {
    const token = "test-auth-token";
    const url = "https://halo.example/api/twilio/webhook";
    const params = { AccountSid: "ACxxx", Body: "done", From: "+12145550100", To: "+15551212" };
    const payload = twilioSignaturePayload(url, params);
    const signature = createHmac("sha1", token).update(payload, "utf8").digest("base64");
    expect(verifyTwilioSignature({ authToken: token, signature, url, params })).toBe(true);
    expect(verifyTwilioSignature({ authToken: token, signature: "nope", url, params })).toBe(false);
    expect(verifyTwilioSignature({ authToken: "", signature, url, params })).toBe(false);
  });

  it("explains the carrier-registration failures that silently drop texts", () => {
    // The two codes that mean "Twilio accepted it, the carrier binned it".
    expect(describeSmsError(30032)).toMatch(/toll-free verification/i);
    expect(describeSmsError(30034)).toMatch(/A2P 10DLC/i);
    // Recipient-side causes stay distinguishable from account-side ones.
    expect(describeSmsError(21610)).toMatch(/STOP/);
    expect(describeSmsError(30007)).toMatch(/spam/i);
    // Unknown codes still surface the number rather than reading as success.
    expect(describeSmsError(31234)).toMatch(/31234/);
    // No error means no message — a delivered text must not render a reason.
    expect(describeSmsError(null)).toBeNull();
    expect(describeSmsError(undefined)).toBeNull();
    expect(describeSmsError(Number.NaN)).toBeNull();
  });
});
