---
name: Input
description: Text field. Stock shadcn/ui, themed by HALO tokens.
---

# Input

**Source:** `artifacts/halo/src/components/ui/input.tsx`

## Token expression

- Border: `border-input` → `--input` (#DDE7F2 light / #1A2E45 dark) — matches card borders.
- Background: `bg-transparent` — inherits card or page surface.
- Focus ring: `focus-visible:ring-1 focus-visible:ring-ring` → olive green (#6D9B12) light / lime (#B4FF44) dark.
- Height: `h-9` with `px-3 py-1`.

## Notes

- Used everywhere in HALO for search, form fields, and inline editing.
- Combine with `Field` for label + error message layout.
- `InputGroup` wraps it with inline addons (icons, buttons).
