---
name: HALO desktop map-first home
description: Desktop root is the live map with the chat as a floating module; the full-screen chat still exists at its own route.
---

Desktop `/` is the **Property Portfolio** desk (corporate) — the same PropertyPulse map HUD
as `/pulse` (PM) and `/punchlist` (Archangel Contractors). The HALO chat is no longer a
full-screen page there — it runs inside a small floating window over the map (Ask HALO
pill, 2×, bottom-right), and the same chat page component serves both shapes through a
`compact` prop (compact = thread + composer only, no hero, no own header, no `100dvh`).

**Why:** the owner wants the map to be the operating picture and the chat to be an
assistant he can move or dismiss, not a wall that hides the map.

**How to apply:**
- Keep one chat implementation. If you need another chat surface, add a mode to the
  existing page — a second copy will drift.
- Anything that intentionally wants the FULL chat must link to the dedicated chat route,
  never to `/`. Grep before repointing navigation.
- The floating module must sit above Leaflet and the HUD rails (they cap around z-index
  1100). It re-centers on every load by design; only its dragged position is remembered,
  and hidden state is session-scoped so it comes back next visit.
- Whenever the chat page's header actions change, check they are still reachable from the
  module toolbar or the map HUD — the map has no chat header to inherit them.
