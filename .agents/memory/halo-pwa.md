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
