---
name: HALO in-app update prompts
description: How published-build updates surface in client dashboard / desktop while the app is open
---
- Client dashboard PWA uses vite-plugin-pwa `registerType: 'prompt'` (NOT autoUpdate) with a React `UpdatePrompt` using `useRegisterSW`: periodic SW `update()` every 3 min + on visibilitychange/focus, "Update available — Refresh" toast, auto-applies after 60s grace.
- **Why:** installed iOS PWAs only checked for a new SW at launch, so publishes looked like they "didn't take". Prompt mode is required for `needRefresh` to fire; `workbox-window` must stay a dependency or the build fails resolving `virtual:pwa-register/react`.
- Desktop app has NO service worker: its `UpdatePrompt` polls its own `index.html` (cache: no-store) and compares hashed /assets/ filenames; PROD-only.
- **How to apply:** don't switch the dashboard back to autoUpdate; any new PWA artifact wanting live updates should copy this pattern. Real verification only possible on the published URL (PWA inert in dev).
