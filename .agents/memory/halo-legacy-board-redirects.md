---
name: HALO legacy client-board redirects
description: Legacy /dashboard and /client links redirect to /board — must preserve query/hash.
---
The root halo app owns legacy client-board routes (`/dashboard/:token`, `/dashboard/:token/:rest*`, `/client/:token`, `/client/:token/board`) and client-side `window.location.replace`s them to `/board/<token>`.

**Rule:** every such redirect must append `window.location.search + window.location.hash` (token wrapped in `encodeURIComponent`).

**Why:** the redirects originally dropped the query string, which silently broke deep links on the live site — `?present=1` (narrated walkthrough), `?map=1`, `?tab=...` all landed on a bare board. The bug is invisible in dev when testing the new `/board/...` links directly.

**How to apply:** when adding or changing any legacy-path redirect (halo or halo-desktop), carry search+hash through; prefer a shared helper if more redirects appear. Direct `/board/<token>?present=1` links always work regardless.
