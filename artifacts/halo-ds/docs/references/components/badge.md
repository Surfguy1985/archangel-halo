---
name: Badge
description: Compact status label. HALO-specific customisations.
---

# Badge

**Source:** `artifacts/halo/src/components/ui/badge.tsx`

## HALO customisations

- Base adds `hover-elevate` — same pseudo-element overlay as Button, for elevated/clickable badges.
- `whitespace-nowrap` enforced — badges must never wrap to two lines.
- `default`: `bg-primary` (lime) + black text + `shadow-xs`. No separate hover (overlay handles it).
- `secondary`: navy secondary surface, white text.
- `destructive`: red, white text, `shadow-xs`.
- `outline`: `border [border-color:var(--badge-outline)]` — a very subtle border (rgba(0,0,0,.05) light / rgba(255,255,255,.05) dark), foreground text.

## Variants

| Variant | Role |
|---|---|
| default | Lime — primary status, "New", active label |
| secondary | Navy — supporting status |
| destructive | Red — error, overdue |
| outline | Ghost — secondary metadata |
