---
name: HALO/Falkon official palette
description: The official brand palette and token conventions used across halo, halo-desktop, and devportal.
---

Official palette (user-directed, July 2026): NAVY + LIME are the core company
colors. Lime is #B4FF44; navy family is #07101E / #0A1930 / #13223A ink tones.
User asked for "beautiful and professionally done" after finding the earlier
light-grey theme hard to read — readability/contrast is the top rule.

Token conventions:
- All three apps keep LIGHT content surfaces (paper #F4F7F9-ish, white cards)
  with navy used for chrome: mobile tab bar/backdrop, desktop sidebar, dark
  hero/brief cards, devportal footer.
- **Why:** lime #B4FF44 is unreadable as small text on light backgrounds, so
  the `--gold` family split persists: `--gold` = DARK lime (#6D9B12) for
  text/icon accents on light surfaces; `--gold-light` = #B4FF44 for
  button/badge FILLS (always dark #07101E text) and for text accents on NAVY
  surfaces.
- **How to apply:** on dark/navy surfaces use `text-[var(--gold-light)]`; on
  light surfaces use `text-[var(--gold)]`; fills use `--gold-light` or
  `.btn-gold` with dark text. Never white text on lime.
- halo mobile fonts: Outfit (display) + Plus Jakarta Sans (body). Desktop:
  Plus Jakarta Sans (display) + Inter (UI).
- halo-desktop :root still defines --red/--green/--blue/... status tokens
  (Money.tsx badges depend on them). Mobile --green is a dark readable green
  (#15803D), not lime.
- devportal is HSL-token based; Scalar API reference theme vars are overridden
  inline in ApiReference.tsx and must match the navy/lime theme.
- Logo images render dark via `filter: brightness(0)` on light headers, and
  inverted/bright on navy chrome.
