import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// Desktop visitors on the main URL get the full desktop app at /desktop.
// Public/shared pages (pay, portal, track, photos, recap) always render here,
// and ?mobile=1 forces the mobile experience on any screen.
(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mobile") === "1") return;
  const isDesktop =
    window.innerWidth >= 1024 && window.matchMedia("(pointer: fine)").matches;
  if (!isDesktop) return;
  const path = window.location.pathname;
  if (path.startsWith("/desktop")) return;
  if (/^\/(pay|portal|track|photos|recap|summary|client|dashboard)\//.test(path)) return;
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
