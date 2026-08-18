---
name: HALO crew link shapes
description: The one correct URL shape for crew portal / paycard / join links, and why hand-built variants broke on crews' phones.
---

# Crew links are always root-served

Three unauthenticated crew surfaces: portal, paycard check-in, foreman join.
All three are routes of the **root web app**, so a crew link is
`<origin>/<portal|checkin|join>/<token>` and nothing else. Build them with the
shared crew-link helpers in the board UI package rather than by hand.

**Why:** hand-built variants shipped in several office screens, in three
different shapes. Two pointed at the Expo bundler path (`/halo-crew/portal/…`),
which resolves in the dev workspace and **not** in production; others prefixed
`import.meta.env.BASE_URL`, which works only from the root app and breaks from
any base-pathed artifact (e.g. the desktop app at `/desktop/`).

**How to apply:**
- New office UI that shares a crew link: use the helper, never string
  concatenation, and never `BASE_URL` for a crew link.
- The server texts the same shapes; keep them in sync with the helper.
- `BASE_URL` is for in-app route links only. API and asset URLs
  (`/api/storage…`, PDFs, downloads) must be absolute `/api/...`.
- Any new public token surface must also be added to the office-auth public
  prefixes or it 401s.
