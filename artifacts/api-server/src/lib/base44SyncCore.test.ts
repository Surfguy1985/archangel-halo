import { describe, expect, it } from "vitest";
import {
  applyIngest,
  classifyHttpStatus,
  collectionPresence,
  computeFreshness,
  DELAYED_MS,
  extractBase44Id,
  FRESH_MS,
  parseBase44Body,
  retryDelayMs,
  shouldApplyCollection,
  shouldMarkStale,
  shouldRetry,
  type IngestState,
} from "./base44SyncCore";
import { Base44ClientError, fetchBase44Snapshot } from "./base44Client";

function emptyState(): IngestState {
  return { maps: new Map() };
}

function snapshot(data: Record<string, unknown[]>) {
  const parsed = parseBase44Body({ data });
  if (!parsed.ok) throw new Error("expected parse ok");
  return parsed;
}

describe("Base44 parse + presence", () => {
  it("rejects malformed non-objects", () => {
    expect(parseBase44Body(null).ok).toBe(false);
    expect(parseBase44Body("nope").ok).toBe(false);
    expect(parseBase44Body(1).ok).toBe(false);
  });

  it("treats missing collections as missing and empty arrays as empty", () => {
    expect(collectionPresence(undefined)).toBe("missing");
    expect(collectionPresence([])).toBe("empty");
    expect(collectionPresence([{ id: "1" }])).toBe("present");
    expect(shouldApplyCollection("empty")).toBe(false);
    expect(shouldApplyCollection("missing")).toBe(false);
    expect(shouldMarkStale("empty")).toBe(false);
    expect(shouldMarkStale("present")).toBe(true);
  });

  it("canonicalizes aliased resource keys", () => {
    const parsed = parseBase44Body({
      FieldSubmission: [{ _id: "fs1", notes: "ok" }],
      CrewRate: [{ id: "cr1", amount: 20 }],
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.presence.field_submissions).toBe("present");
    expect(parsed.presence.crew_rates).toBe("present");
  });
});

describe("Base44 ingest planner", () => {
  const now = new Date("2026-08-13T18:00:00.000Z");

  it("first sync creates mapped records", () => {
    const result = applyIngest(
      emptyState(),
      snapshot({
        properties: [{ _id: "p1", name: "Thornbury" }],
        units: [{ _id: "u1", property: "Thornbury", unit_number: "214" }],
      }),
      now,
    );
    expect(result.totalCreated).toBeGreaterThanOrEqual(2);
    expect(result.totalStale).toBe(0);
    expect(result.state.maps.get("properties\0p1")?.status).toBe("active");
  });

  it("repeat sync of unchanged records is idempotent", () => {
    const first = applyIngest(
      emptyState(),
      snapshot({ properties: [{ _id: "p1", name: "Thornbury" }] }),
      now,
    );
    const second = applyIngest(
      first.state,
      snapshot({ properties: [{ _id: "p1", name: "Thornbury" }] }),
      new Date(now.getTime() + 1000),
    );
    expect(second.resources.properties.created).toBe(0);
    expect(second.resources.properties.unchanged).toBe(1);
    expect(second.state.maps.size).toBe(first.state.maps.size);
  });

  it("changed record updates hash and counts as updated", () => {
    const first = applyIngest(
      emptyState(),
      snapshot({ properties: [{ _id: "p1", name: "Thornbury" }] }),
      now,
    );
    const second = applyIngest(
      first.state,
      snapshot({ properties: [{ _id: "p1", name: "Thornbury East" }] }),
      now,
    );
    expect(second.resources.properties.updated).toBe(1);
    expect(second.state.maps.get("properties\0p1")?.status).toBe("active");
  });

  it("deleted/stale record is marked stale only on a non-empty subsequent payload", () => {
    const first = applyIngest(
      emptyState(),
      snapshot({
        units: [
          { _id: "u1", unit_number: "214" },
          { _id: "u2", unit_number: "215" },
        ],
      }),
      now,
    );
    const second = applyIngest(
      first.state,
      snapshot({ units: [{ _id: "u1", unit_number: "214" }] }),
      now,
    );
    expect(second.resources.units.stale).toBe(1);
    expect(second.state.maps.get("units\0u2")?.status).toBe("stale");
    expect(second.state.maps.get("units\0u1")?.status).toBe("active");
  });

  it("empty collection response never wipes or marks stale", () => {
    const first = applyIngest(
      emptyState(),
      snapshot({ units: [{ _id: "u1", unit_number: "214" }] }),
      now,
    );
    const second = applyIngest(first.state, snapshot({ units: [] }), now);
    expect(second.resources.units.applied).toBe(false);
    expect(second.resources.units.stale).toBe(0);
    expect(second.state.maps.get("units\0u1")?.status).toBe("active");
  });

  it("missing collection is non-destructive", () => {
    const first = applyIngest(
      emptyState(),
      snapshot({ units: [{ _id: "u1", unit_number: "214" }] }),
      now,
    );
    const second = applyIngest(first.state, snapshot({ properties: [{ _id: "p1", name: "X" }] }), now);
    expect(second.state.maps.get("units\0u1")?.status).toBe("active");
  });

  it("partial entity failure skips bad rows and continues", () => {
    const result = applyIngest(
      emptyState(),
      snapshot({
        invoices: [{ name: "no-id" }, { _id: "inv1", invoice_number: "INV-1" }],
      }),
      now,
    );
    expect(result.resources.invoices.errors).toBe(1);
    expect(result.resources.invoices.created).toBe(1);
  });

  it("duplicate records in one payload are skipped after the first", () => {
    const result = applyIngest(
      emptyState(),
      snapshot({
        crews: [
          { _id: "c1", name: "Carlos" },
          { _id: "c1", name: "Carlos Updated" },
        ],
      }),
      now,
    );
    expect(result.resources.crews.skipped).toBe(1);
    expect(result.state.maps.get("crews\0c1")?.status).toBe("active");
  });

  it("projects field-manager evidence without dumping raw JSON", () => {
    const result = applyIngest(
      emptyState(),
      snapshot({
        field_submissions: [
          {
            _id: "fs1",
            property: "Thornbury",
            unit_number: "214",
            notes: "Paint complete",
            before_photos: ["https://example.com/before.jpg"],
            after_photos: ["https://example.com/after.jpg"],
            rework_notes: "Touch up north wall",
          },
        ],
        approvals: [{ _id: "ap1", title: "QC pass", property: "Thornbury" }],
        reminders: [{ id: "rm1", title: "Call PM" }],
        crew_rates: [{ _id: "rt1", name: "Carlos", notes: "45" }],
      }),
      now,
    );
    const kinds = result.records.map((r) => r.kind).sort();
    expect(kinds).toContain("before");
    expect(kinds).toContain("after");
    expect(kinds).toContain("rework");
    expect(kinds).toContain("approval");
    expect(kinds).toContain("reminder");
    expect(kinds).toContain("rate");
    for (const rec of result.records) {
      expect(JSON.stringify(rec)).not.toMatch(/before_photos/);
    }
  });
});

describe("freshness + HTTP classification", () => {
  it("classifies token, timeout, and 500", () => {
    expect(classifyHttpStatus(401)).toBe("token_invalid");
    expect(classifyHttpStatus(403)).toBe("token_invalid");
    expect(classifyHttpStatus(500)).toBe("http_500");
    expect(classifyHttpStatus(504)).toBe("timeout");
  });

  it("does not retry auth or malformed", () => {
    expect(shouldRetry("token_missing", 1)).toBe(false);
    expect(shouldRetry("token_invalid", 1)).toBe(false);
    expect(shouldRetry("malformed", 1)).toBe(false);
    expect(shouldRetry("http_500", 1)).toBe(true);
    expect(shouldRetry("timeout", 1)).toBe(true);
    expect(shouldRetry("http_500", 4)).toBe(false);
  });

  it("applies exponential backoff with jitter bounds", () => {
    const low = retryDelayMs(0, { jitter: () => 0 });
    const high = retryDelayMs(0, { jitter: () => 1 });
    expect(high).toBeGreaterThanOrEqual(low);
    expect(retryDelayMs(8, { capMs: 1000, jitter: () => 0 })).toBeLessThanOrEqual(1000);
  });

  it("computes freshness windows", () => {
    const now = new Date("2026-08-13T18:00:00Z");
    expect(computeFreshness(null, null, now)).toBe("unavailable");
    expect(computeFreshness(now, "token_invalid", now)).toBe("unavailable");
    expect(computeFreshness(new Date(now.getTime() - FRESH_MS / 2), null, now)).toBe("fresh");
    expect(computeFreshness(new Date(now.getTime() - FRESH_MS - 1), null, now)).toBe("delayed");
    expect(computeFreshness(new Date(now.getTime() - DELAYED_MS - 1), null, now)).toBe("stale");
  });
});

describe("Base44 client", () => {
  it("fails closed when token is missing", async () => {
    await expect(
      fetchBase44Snapshot({ token: "", fetchFn: async () => new Response("no") }),
    ).rejects.toMatchObject({ code: "token_missing" } satisfies Partial<Base44ClientError>);
  });

  it("does not retry invalid token", async () => {
    let calls = 0;
    await expect(
      fetchBase44Snapshot({
        token: "bad",
        maxAttempts: 4,
        fetchFn: async () => {
          calls += 1;
          return new Response("nope", { status: 401 });
        },
      }),
    ).rejects.toMatchObject({ code: "token_invalid" });
    expect(calls).toBe(1);
  });

  it("retries 500 then succeeds", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await fetchBase44Snapshot({
      token: "ok",
      maxAttempts: 4,
      jitter: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchFn: async () => {
        calls += 1;
        if (calls < 3) return new Response("err", { status: 500 });
        return new Response(JSON.stringify({ data: { properties: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(calls).toBe(3);
    expect(sleeps.length).toBe(2);
    expect(result.attempts).toBe(3);
  });

  it("times out via abort", async () => {
    await expect(
      fetchBase44Snapshot({
        token: "ok",
        timeoutMs: 5,
        maxAttempts: 1,
        fetchFn: async (_url, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      }),
    ).rejects.toMatchObject({ code: "timeout" });
  });

  it("rejects malformed JSON", async () => {
    await expect(
      fetchBase44Snapshot({
        token: "ok",
        maxAttempts: 1,
        fetchFn: async () => new Response("not-json", { status: 200 }),
      }),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("accepts a delayed success within timeout", async () => {
    const result = await fetchBase44Snapshot({
      token: "ok",
      timeoutMs: 1000,
      fetchFn: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ data: { crews: [{ _id: "c1" }] } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    expect(result.attempts).toBe(1);
    expect(extractBase44Id((result.body as { data: { crews: unknown[] } }).data.crews[0])).toBe("c1");
  });
});
