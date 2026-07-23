---
name: HALO/Falkon official palette
description: The official 5-color brand palette and the token conventions used across halo, halo-desktop, and devportal.
---

Official palette (user-supplied, July 2026): lime #B4FF44, light #EEF2F6, medium grey #CBD5E1, slate #475569, ink #0F172A.

Rules the user set: light color on large surfaces (backgrounds), lime for buttons with dark text, ink for text, medium grey/medium colors for section boxes and accents. "Colorful without being overwhelming, like Apple."

Token conventions:
- All three apps are LIGHT theme: background #EEF2F6, cards white, borders #CBD5E1, text #0F172A, secondary text #475569.
- **Why:** lime #B4FF44 is unreadable as small text on white, so the `--gold` family is split: `--gold` = dark lime (#6D9B12) for TEXT/icon accents, `--gold-light` = #B4FF44 for BUTTON/badge backgrounds (always with dark/black text).
- **How to apply:** new buttons use `bg-[var(--gold-light)]` or `--primary` (lime) with `text-primary-foreground`/black; accent text uses `text-[var(--gold)]`; never lime text on light backgrounds except large display headlines.
- halo mobile maps Tailwind `--color-primary` to `var(--gold)` (dark) — solid lime buttons there were sed-swapped to `bg-[var(--gold-light)]`.
- halo-desktop :root defines `--red/--green/--blue/...` status colors (white text ok on them); Money.tsx status badges depend on these existing.
- devportal is HSL-token based; Scalar API reference theme vars are overridden inline in ApiReference.tsx and must stay light.
- Logo images render dark via `filter: brightness(0)` (no invert) on light headers.
