---
name: HALO root desktop redirect
description: Main (root) app redirects desktop visitors to /desktop; rules for public routes and overrides
---
The root (mobile) app's `main.tsx` redirects desktop visitors (width ≥1024 + fine pointer) to the same path under `/desktop` before React renders.

**Why:** the root URL showed the mobile app in a phone frame to desktop visitors; user wants the main website to be the desktop experience on desktop screens.

**How to apply:**
- Public/shared routes (`/pay`, `/portal`, `/track`, `/photos`, `/recap`) must NEVER redirect — they only exist in the root app.
- `?mobile=1` forces the mobile app on any screen.
- Only paths on the known-routes allowlist redirect path-preserving; unknown paths go to `/desktop/`. Adding a new page to both apps → update the allowlist regex in `artifacts/halo/src/main.tsx`.
