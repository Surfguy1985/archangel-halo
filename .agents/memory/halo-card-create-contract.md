---
name: HALO client board card create/move contract
description: Client-side board UI must mirror the server card contract exactly — checklist item shape and move-to-done gating.
---

**Rule 1:** Card create payloads to `/client/:token/board/cards` must send checklist as `{id, text, done}` objects. Templates in board-ui carry `checklist: string[]` — always convert at submit. Bare strings fail Zod with a blank 400 "Invalid input".
**Why:** Every template with a checklist silently failed card creation on both board lenses in production (July 2026).
**How to apply:** Any new UI that creates client-board cards from templates must map strings → BoardChecklistItem objects; conversion currently lives in AppleCardForm's submit.

**Rule 2:** The client drag gate must match the server `card.moved` gate: block by cardKey PREFIX (`job:`/`crew:`/`invoice:`) entering `done`, allow reorder when already in `done`, vendor board only. Never gate by template type — templates and cardKey prefixes diverge.
**Why:** A template-based client gate blocked moves the server allowed (and vice versa), so cards appeared un-movable or snapped back.

Also: client-dashboard `components/kanban/CreateCardDialog.tsx` is orphaned legacy — the live create flow is board-ui AppleTemplateGallery → AppleCardForm. Don't fix bugs there.
