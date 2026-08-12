---
name: Button
description: Primary interactive control. HALO-specific customisations vs stock shadcn/ui.
---

# Button

**Source:** `artifacts/halo/src/components/ui/button.tsx`

## HALO customisations

- Base adds `hover-elevate active-elevate-2` — a pseudo-element overlay that darkens on hover/active, defined in `src/index.css` utilities layer. No hover background-color change; the overlay provides the state feedback.
- `default` variant: `bg-primary` (lime #B4FF44) + `text-primary-foreground` (#000) + `border border-primary-border` (auto-computed darker lime border via `--opaque-button-border-intensity`). The border is a HALO convention on all filled buttons.
- `destructive`: same border pattern via `border-destructive-border`.
- `outline`: `border [border-color:var(--button-outline)]` (rgba(0,0,0,.10) light / rgba(255,255,255,.10) dark). No separate hover state — the overlay handles it. `shadow-xs active:shadow-none`.
- `secondary`: `border bg-secondary text-secondary-foreground border-secondary-border`. Dark navy (#13223A) surface.
- `ghost`: `border border-transparent` — transparent border so it snaps into bordered layouts without shifting.
- Sizes: `min-h-9/8/10` (min-height, not fixed height) to accommodate content wrapping on small viewports.

## Variants

| Variant | Light | Dark |
|---|---|---|
| default | Lime bg, black text, darker lime border | Same (lime is constant) |
| destructive | Red #E11D48, white text | Same |
| outline | Transparent bg, subtle border | Subtle white-tinted border |
| secondary | Navy #13223A, white text | Deeper navy #0A1930 |
| ghost | Transparent | Transparent |
| link | Primary text, underline on hover | Same |

## Sizes

`default` (min-h-9 px-4), `sm` (min-h-8 px-3 text-xs), `lg` (min-h-10 px-8), `icon` (h-9 w-9)
