/**
 * sendExpoPush delivery-contract tests.
 * Verifies the flag only returns true when Expo actually accepts the ticket.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { sendExpoPush } from "./pushNotification";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_TOKEN = "ExponentPushToken[xxxxxx]";
const NOTIF = { title: "Test", body: "Hello" };

function mockFetch(response: { ok: boolean; json: () => Promise<unknown> }) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(response as unknown as Response);
}

function mockFetchThrow(err: Error = new Error("Network error")) {
  return vi.spyOn(global, "fetch").mockRejectedValueOnce(err);
}

afterEach(() => vi.restoreAllMocks());

// ─── Token validation ─────────────────────────────────────────────────────────

describe("sendExpoPush — token validation", () => {
  it("returns false for null token", async () => {
    expect(await sendExpoPush(null, NOTIF)).toBe(false);
  });

  it("returns false for undefined token", async () => {
    expect(await sendExpoPush(undefined, NOTIF)).toBe(false);
  });

  it("returns false for empty string", async () => {
    expect(await sendExpoPush("", NOTIF)).toBe(false);
  });

  it("returns false for invalid token format", async () => {
    expect(await sendExpoPush("not-an-expo-token", NOTIF)).toBe(false);
  });

  it("accepts ExponentPushToken[ prefix", async () => {
    mockFetch({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }] }),
    });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(true);
  });

  it("accepts ExpoPushToken[ prefix", async () => {
    mockFetch({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }] }),
    });
    expect(await sendExpoPush("ExpoPushToken[yyyyyy]", NOTIF)).toBe(true);
  });
});

// ─── Transport failures ───────────────────────────────────────────────────────

describe("sendExpoPush — transport failures", () => {
  it("returns false (not throws) on network error", async () => {
    mockFetchThrow(new Error("ECONNREFUSED"));
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });

  it("returns false (not throws) on DNS failure", async () => {
    mockFetchThrow(new Error("getaddrinfo ENOTFOUND"));
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });
});

// ─── HTTP-level failures ──────────────────────────────────────────────────────

describe("sendExpoPush — HTTP error responses", () => {
  it("returns false for HTTP 400", async () => {
    mockFetch({ ok: false, json: async () => ({}) });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });

  it("returns false for HTTP 429 (rate limit)", async () => {
    mockFetch({ ok: false, json: async () => ({}) });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });

  it("returns false for HTTP 500", async () => {
    mockFetch({ ok: false, json: async () => ({}) });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });
});

// ─── Expo ticket payload ──────────────────────────────────────────────────────

describe("sendExpoPush — Expo ticket validation", () => {
  it("returns true when ticket status is 'ok'", async () => {
    mockFetch({
      ok: true,
      json: async () => ({ data: [{ status: "ok" }] }),
    });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(true);
  });

  it("returns false when ticket status is 'error'", async () => {
    mockFetch({
      ok: true,
      json: async () => ({ data: [{ status: "error", message: "InvalidCredentials" }] }),
    });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });

  it("returns false when data array is empty", async () => {
    mockFetch({
      ok: true,
      json: async () => ({ data: [] }),
    });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });

  it("returns false when data field is missing", async () => {
    mockFetch({
      ok: true,
      json: async () => ({}),
    });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });

  it("returns false when json() throws (malformed body)", async () => {
    mockFetch({
      ok: true,
      json: async () => { throw new SyntaxError("Unexpected token"); },
    });
    expect(await sendExpoPush(VALID_TOKEN, NOTIF)).toBe(false);
  });
});
