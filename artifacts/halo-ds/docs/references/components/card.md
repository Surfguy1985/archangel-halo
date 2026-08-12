---
name: Card
description: Grouped content surface. Stock shadcn/ui, themed by HALO tokens.
---

# Card

**Source:** `artifacts/halo/src/components/ui/card.tsx`

## Token expression

- Light: white (#FFF) surface on #F4F7F9 background — clean lift.
- Dark: #07101E surface on #041029 background — subtle depth between layers.
- `rounded-xl` — uses `--radius-xl` (base 0.875rem + 4px = ~1.125rem), giving the prominent rounded corners consistent across HALO.
- Border uses `--border` (#DDE7F2 light / #1A2E45 dark) — hairline-weight.
- Shadow is the standard `shadow` Tailwind utility; the design system adds `--shadow-card` via token CSS for consumers that want the HALO-specific soft shadow.

## Sub-components

`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardFooter`

## Usage rules (from source)

- `CardHeader` → `CardTitle` + `CardDescription` pattern is the canonical header layout.
- Keep `p-6` default padding; reduce only for dense list items.
- `CardFooter` always uses `flex items-center` — action buttons live here, not inline in content.
