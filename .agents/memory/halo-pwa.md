---
name: HALO mobile PWA
description: The mobile app (artifacts/halo) is an installable PWA — how it's set up and what to watch when changing it
---

# HALO mobile PWA (add-to-home-screen)

Rule: the mobile app (artifacts/halo, served at root `/`) is an installable PWA via `vite-plugin-pwa` (VitePWA in vite.config.ts, registerType autoUpdate). Icons live in `artifacts/halo/public/` (pwa-192, pwa-512, maskable-512, apple-touch-icon), generated from the wings+halo emblem cropped out of halo-logo.png onto a paper (#F4F3EF) background.

**Why:** the navy emblem is invisible on a dark background, so icons use the app's light paper color. Only the mobile app is a PWA — desktop (/desktop/) is not.

**How to apply:**
- PWA is inert in dev (vite-plugin-pwa devOptions default off) so the service worker never hijacks the shared $REPLIT_DEV_DOMAIN across artifacts. Install/testing only works on the deployed (published) URL, not the dev preview.
- iOS needs the `apple-touch-icon` link + apple-mobile-web-app-* meta tags in index.html (not just the manifest) — keep them.
- Workbox navigateFallbackDenylist excludes /api and /desktop so the SW never serves the SPA shell for those.
- After changing icons/manifest you must rebuild (and republish) for changes to take effect; regenerate all four icon sizes together.
- SW registration is manual in `src/main.tsx` via `registerSW({ immediate: true })` from `virtual:pwa-register` with a 60s `registration.update()` interval, and `injectRegister: null` in vite.config — keep these paired or you get double registration / stale installed shells.
- All `/api` responses get `Cache-Control: no-store` from an app-level middleware in the api-server (routes like storage objects override it later); don't remove it or installed PWAs/proxies serve stale JSON ("not syncing" complaints).

## Service worker vs sibling artifacts
The halo PWA service worker's navigateFallback will hijack navigations to sibling artifacts (/board, /devportal), serving the cached halo shell — whose desktop-redirect then bounces users to /desktop/. Any new artifact path must be added to navigateFallbackDenylist in artifacts/halo/vite.config.ts AND the desktop-redirect exemption regex in halo main.tsx. main.tsx also has a self-heal (unregister SW + reload, bounded by sessionStorage counter) for devices with a stale SW. Symptom only reproduces on devices with the SW installed — headless curls/screenshots look fine.
