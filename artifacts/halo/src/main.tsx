import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// Desktop visitors on the main URL get the full desktop app at /desktop.
// Public/shared pages (pay, portal, track, photos, recap) always render here,
// and ?mobile=1 forces the mobile experience on any screen.
// Self-heal: if this app's shell was served at /board/* (or /devportal/*), an
// old installed service worker hijacked a sibling artifact's URL. Unregister
// the stale SW and reload once so the real page loads from the network.
(() => {
  const path = window.location.pathname;
  if (!/^\/(board|devportal)(\/|$)/.test(path)) return;
  const flag = "halo_sw_selfheal";
  const attempts = Number(sessionStorage.getItem(flag) ?? "0");
  if (attempts >= 2) return; // avoid reload loops, but allow one retry
  sessionStorage.setItem(flag, String(attempts + 1));
  const done = () => window.location.reload();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(done, done);
  } else {
    done();
  }
})();

(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mobile") === "1") return;
  const isDesktop =
    window.innerWidth >= 1024 && window.matchMedia("(pointer: fine)").matches;
  if (!isDesktop) return;
  const rawPath = window.location.pathname;
  if (rawPath.startsWith("/desktop")) return;
  // Strip the app's base path (e.g. "/halo") so route checks below work on
  // the app-relative path — otherwise "/halo/portal/TOKEN" never matches "^/portal/".
  const base = import.meta.env.BASE_URL.replace(/\/$/, ""); // e.g. "/halo"
  const path = base && rawPath.startsWith(base) ? rawPath.slice(base.length) || "/" : rawPath;
  // board + devportal belong to sibling artifacts: if we're rendering there, a
  // stale service worker hijacked the URL and the self-heal above is reloading —
  // never bounce those to /desktop.
  if (/^\/(pay|portal|track|photos|recap|summary|client|dashboard|board|devportal|join|checkin)(\/|$)/.test(path)) return;
  // Only redirect paths that exist in the desktop app; everything else lands on its home.
  const known =
    /^\/(properties|jobs|invoices|money|calendar|crews|wings|pipeline|catalog|supply|vendors|import|jobboard)(\/|$)|^\/$/;
  const target = known.test(path) ? `/desktop${path === "/" ? "/" : path}` : "/desktop/";
  window.location.replace(target + window.location.search + window.location.hash);
})();

registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (registration) {
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60_000);
    }
  },
});

createRoot(document.getElementById("root")!).render(<App />);
