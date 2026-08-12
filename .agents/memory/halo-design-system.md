---
name: HALO Design System
description: Location, palette, fonts, and key decisions for the extracted HALO Design System artifact.
---

# HALO Design System

Artifact: `artifacts/halo-ds` · preview path `/halo-ds/` · package `@workspace/halo-ds`

## Palette (constant across both themes)

- **Primary:** `#B4FF44` lime (--gold-light) · foreground `#000000`
- **Secondary:** `#13223A` dark navy (--ink2) · foreground `#FFFFFF`
- **Sidebar:** always dark navy (`#07101E` light, `#041029` dark)

### Light-specific
- background `#F4F7F9` (--paper), foreground `#07101E` (--ink)
- card `#FFFFFF`, border `#DDE7F2`, ring `#6D9B12` (olive)
- accent `#F0FAE0` (lime tint), accent-fg `#557F0D`

### Dark-specific
- background `#041029`, card `#07101E`, border `#1A2E45`, ring `#B4FF44`
- muted `#13223A`, muted-fg `#8CA0B9`
- accent `#172C0A` (dark lime tint), accent-fg `#B4FF44`

## Typography
- sans: Plus Jakarta Sans (Google Fonts, already in index.html)
- serif/display: Outfit (Google Fonts, already in index.html)
- mono: system stack

## Radius
- base `0.875rem` (14px) — matches HALO `--radius: 14px`

## Key files
- `tokens.json` — single source of truth; run `pnpm tokens` after edits
- `docs/references/component-inventory.md` — full component index
- `docs/references/components/` — per-family reference for pilot (button, badge, card, input, avatar)
- `docs/references/logos/logo.png` + `public/logo.png` — HALO mark

**Why:** The design system is a reference-only artifact for now; user chose not to migrate apps yet. When migration is requested, read `artifacts/halo-ds/docs/migrating-web.md` first.
