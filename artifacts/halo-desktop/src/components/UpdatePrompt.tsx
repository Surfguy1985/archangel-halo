import { useEffect, useRef, useState } from "react";

// How often to check the server for a newly published build.
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes

/**
 * The desktop app has no service worker, but browsers can still keep a
 * long-lived tab open across publishes. This polls the app's own index.html
 * (cache-bypassed) and compares the hashed asset references — when they
 * change, a new build has been published and we show a small
 * "Update available — Refresh" prompt.
 */
export function UpdatePrompt() {
  const [needRefresh, setNeedRefresh] = useState(false);
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;

    const indexUrl = `${import.meta.env.BASE_URL}index.html`;

    const fingerprint = (html: string) =>
      // Hashed asset filenames change on every build.
      (html.match(/\/assets\/[\w.-]+\.(?:js|css)/g) ?? []).sort().join("|");

    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(indexUrl, { cache: "no-store" });
        if (!res.ok) return;
        const fp = fingerprint(await res.text());
        if (!fp || cancelled) return;
        if (baseline.current === null) {
          baseline.current = fp;
        } else if (fp !== baseline.current) {
          setNeedRefresh(true);
        }
      } catch {
        // Offline / transient failure — retry on the next tick.
      }
    };

    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, []);

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-background/95 px-4 py-2 shadow-lg backdrop-blur">
        <span className="text-sm font-medium">Update available</span>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-foreground px-3 py-1 text-sm font-semibold text-background transition-opacity hover:opacity-80"
          data-testid="button-refresh-update"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
