import { describe, expect, it } from "vitest";
import {
  PULSE_PROPERTY_NAME,
  configuredPulseAllowlist,
  isPulsePropertyAllowed,
  namesMatchPulse,
  pulseSeatDenial,
} from "./pulseSeat";

describe("pulseSeat allowlist", () => {
  it("defaults to Thornbury at Chase Oaks outside of tests", () => {
    expect(configuredPulseAllowlist({ NODE_ENV: "production" })).toEqual([
      PULSE_PROPERTY_NAME,
    ]);
  });

  it("disables the lock in tests when env is unset", () => {
    expect(configuredPulseAllowlist({ NODE_ENV: "test" })).toBeNull();
  });

  it("honors * as every property", () => {
    expect(configuredPulseAllowlist({ HALO_PULSE_ALLOWLIST: "*", NODE_ENV: "production" })).toBeNull();
  });

  it("matches Thornbury short and full names", () => {
    expect(namesMatchPulse("Thornbury", PULSE_PROPERTY_NAME)).toBe(true);
    expect(namesMatchPulse(PULSE_PROPERTY_NAME, "Thornbury")).toBe(true);
    expect(namesMatchPulse("Oakridge", PULSE_PROPERTY_NAME)).toBe(false);
  });

  it("rejects other properties when allowlist is Thornbury", () => {
    const list = [PULSE_PROPERTY_NAME];
    expect(isPulsePropertyAllowed("Thornbury at Chase Oaks", list)).toBe(true);
    expect(isPulsePropertyAllowed("Waybill Contract Test Property", list)).toBe(false);
  });
});

describe("pulseSeatDenial", () => {
  const list = [PULSE_PROPERTY_NAME];

  it("404s a non-Thornbury property without leaking its name", () => {
    const d = pulseSeatDenial("Oakridge", true, list);
    expect(d?.status).toBe(404);
    expect(JSON.stringify(d?.body)).not.toMatch(/Oakridge/i);
  });

  it("401s an allowed property when the viewer is a guest", () => {
    const d = pulseSeatDenial(PULSE_PROPERTY_NAME, false, list);
    expect(d?.status).toBe(401);
    expect(d?.body.needsLogin).toBe(true);
    expect(d?.body.propertyName).toBe(PULSE_PROPERTY_NAME);
    expect(d?.body.seat).toBe("pulse");
  });

  it("allows an authenticated Thornbury viewer", () => {
    expect(pulseSeatDenial(PULSE_PROPERTY_NAME, true, list)).toBeNull();
  });
});
