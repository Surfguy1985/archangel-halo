import { useEffect, useRef, useState } from 'react';

/**
 * useBoardEvents — one SSE subscription for both sides of the board.
 *
 *   Office:  useBoardEvents(`/api/admin/accounts/${propertyId}/board/events`, refetch)
 *   Client:  useBoardEvents(`/api/client/${token}/board/events`, refetch)
 *
 * Replaces the raw `new EventSource(...)` effect in ClientBoardOffice.tsx and
 * brings the client board from 15-second polling to ~1-second push. Keep the
 * TanStack Query refetchInterval as the fallback — SSE degrades, polling
 * catches what it drops.
 *
 * Hardening over the raw effect it replaces:
 *   - explicit exponential backoff with jitter (EventSource auto-reconnect is
 *     browser-defined and can hammer a restarting server)
 *   - refetch on EVERY open, not just the first — reconnect after a drop means
 *     "you missed something; go look"
 *   - `credentials: 'include'`-equivalent via withCredentials so the session
 *     cookie (session-auth.ts) rides along once you migrate off path tokens
 *   - visibility pause: a backgrounded tab drops the stream and re-opens (with
 *     catch-up) on return, instead of holding a zombie connection
 *   - status surface so the UI can show a "live" dot honestly
 */

export type BoardStreamStatus = 'connecting' | 'live' | 'reconnecting' | 'off';

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 1_000;

export function useBoardEvents(
  url: string | null,
  onBoardChange: () => void,
  eventName = 'board',
): BoardStreamStatus {
  const [status, setStatus] = useState<BoardStreamStatus>(url ? 'connecting' : 'off');
  const onChange = useRef(onBoardChange);
  onChange.current = onBoardChange;

  useEffect(() => {
    if (!url) {
      setStatus('off');
      return;
    }

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let disposed = false;

    const teardown = () => {
      es?.close();
      es = null;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer) return;
      setStatus('reconnecting');
      const backoff =
        Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempts) * (0.5 + Math.random());
      attempts += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, backoff);
    };

    const connect = () => {
      if (disposed || document.visibilityState === 'hidden') return;
      teardown();
      setStatus(attempts === 0 ? 'connecting' : 'reconnecting');
      es = new EventSource(url, { withCredentials: true });

      es.onopen = () => {
        attempts = 0;
        setStatus('live');
        // Catch up on anything missed while disconnected. This runs on the
        // very first open too — cheap, and it closes the gap between the
        // initial query and the stream starting.
        onChange.current();
      };

      es.addEventListener(eventName, () => onChange.current());

      es.onerror = () => {
        // EventSource fires error both for transient blips (it will retry
        // itself) and hard failures (readyState CLOSED). Take over retry
        // scheduling in both cases so backoff is ours, not the browser's.
        teardown();
        scheduleRetry();
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        teardown();
        if (retryTimer) {
          clearTimeout(retryTimer);
          retryTimer = null;
        }
        setStatus('off');
      } else {
        attempts = 0;
        connect();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    connect();

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (retryTimer) clearTimeout(retryTimer);
      teardown();
    };
  }, [url, eventName]);

  return status;
}
