import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  phonesMatch,
  smsBlastAllowed,
  toE164,
  twilioSignaturePayload,
  verifyTwilioSignature,
} from "./smsCore";

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
});
