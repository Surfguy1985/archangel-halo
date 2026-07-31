import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// How often to ask the service worker to check for a newly published build.
const CHECK_INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes

/**
 * Detects a newly published version while the app is open (installed PWA or
 * cached tab) and shows a small "Update available — Refresh" prompt, instead
 * of relying on the service worker's default launch-time check.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;

      const check = () => {
        // update() rejects when offline — that's fine, we'll retry later.
        registration.update().catch(() => {});
      };

      // Periodic check while the app stays open…
      const interval = setInterval(check, CHECK_INTERVAL_MS);
      // …and an immediate check whenever the app comes back to the
      // foreground (crucial for installed iOS PWAs, which suspend timers).
      const onVisible = () => {
        if (document.visibilityState === 'visible') check();
      };
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('focus', check);

      // Registration lives for the page's lifetime; no teardown needed, but
      // keep references off the hook's render path.
      void interval;
    },
  });

  useEffect(() => {
    if (!needRefresh) return;
    // Safety net: if the user never taps refresh, apply the update
    // automatically after a short grace period at a quiet moment.
    const timer = setTimeout(() => {
      void updateServiceWorker(true);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [needRefresh, updateServiceWorker]);

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
          onClick={() => void updateServiceWorker(true)}
          className="rounded-full bg-foreground px-3 py-1 text-sm font-semibold text-background transition-opacity hover:opacity-80"
          data-testid="button-refresh-update"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
