---
name: Avatar
description: Profile image with fallback. Stock shadcn/ui, themed by HALO tokens.
---

# Avatar

**Source:** `artifacts/halo/src/components/ui/avatar.tsx`

## HALO usage pattern

- Used extensively for crew members. When a crew selfie exists (`selfiePath`), render `AvatarImage src={selfiePath}`; otherwise `AvatarFallback` shows initials.
- `AvatarFallback` background: `bg-muted` (#EBF0F6 light / #13223A dark) — navy fallback on dark matches the HALO sidebar palette.
- Common sizes: default `h-10 w-10` (40px), `h-8 w-8` (32px) for compact lists, `h-14 w-14` (56px) for crew cards.
- Always `rounded-full`.

## Sub-components

`Avatar`, `AvatarImage`, `AvatarFallback`
