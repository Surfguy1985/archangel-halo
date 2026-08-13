/**
 * Base44 read client — retries, timeouts, no credential leakage.
 */

import {
  classifyFetchFailure,
  classifyHttpStatus,
  retryDelayMs,
  shouldRetry,
  type SyncErrorCode,
} from "./base44SyncCore";

export const DEFAULT_BASE44_URL =
  "https://wakeful-ready-track-flow.base44.app/functions/haloRead";

export class Base44ClientError extends Error {
  constructor(
    message: string,
    public readonly code: SyncErrorCode,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "Base44ClientError";
  }
}

export interface Base44ClientOptions {
  url?: string;
  token?: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  jitter?: () => number;
}

function publicMessage(code: SyncErrorCode): string {
  switch (code) {
    case "token_missing":
      return "Base44 read token is not configured";
    case "token_invalid":
      return "Base44 rejected the read token";
    case "timeout":
      return "Base44 request timed out";
    case "http_500":
      return "Base44 is unavailable";
    case "malformed":
      return "Base44 returned a malformed response";
    case "http_error":
      return "Base44 request failed";
    default:
      return "Base44 is unreachable";
  }
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchBase44Snapshot(
  opts: Base44ClientOptions = {},
): Promise<{ body: unknown; attempts: number; durationMs: number }> {
  const token = opts.token ?? process.env.HALO_READ_TOKEN ?? "";
  const url = opts.url ?? process.env.BASE44_READ_URL ?? DEFAULT_BASE44_URL;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.BASE44_READ_TIMEOUT_MS ?? 15_000);
  const maxAttempts = opts.maxAttempts ?? 4;
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const started = (opts.now ?? Date.now)();

  if (!token) {
    throw new Base44ClientError(publicMessage("token_missing"), "token_missing");
  }

  let lastError: Base44ClientError | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetchFn(url, {
        method: "GET",
        headers: { "x-halo-token": token, accept: "application/json" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        const code = classifyHttpStatus(resp.status) ?? "http_error";
        lastError = new Base44ClientError(publicMessage(code), code, resp.status);
        if (!shouldRetry(code, attempt + 1, maxAttempts)) throw lastError;
      } else {
        let body: unknown;
        try {
          body = await resp.json();
        } catch {
          throw new Base44ClientError(publicMessage("malformed"), "malformed", resp.status);
        }
        if (body === null || typeof body !== "object") {
          throw new Base44ClientError(publicMessage("malformed"), "malformed", resp.status);
        }
        return { body, attempts: attempt + 1, durationMs: (opts.now ?? Date.now)() - started };
      }
    } catch (err) {
      if (err instanceof Base44ClientError) {
        lastError = err;
        if (!shouldRetry(err.code, attempt + 1, maxAttempts)) throw err;
      } else {
        const code = classifyFetchFailure(err);
        lastError = new Base44ClientError(publicMessage(code), code);
        if (!shouldRetry(code, attempt + 1, maxAttempts)) throw lastError;
      }
    } finally {
      clearTimeout(timer);
    }
    await sleep(retryDelayMs(attempt, { jitter: opts.jitter }));
  }
  throw lastError ?? new Base44ClientError(publicMessage("network"), "network");
}
