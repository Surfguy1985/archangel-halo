---
name: HALO card modules
description: Pushed-card interactive modules on the client board — build, action state, dedupe, and detail-dialog gotchas
---
- Modules are server-built at push (`lib/cardModules.ts`); action state (approvedAt, payMethod, requestedAt…) is merged back via ACTION_STATE_KEYS and survives re-sends.
- Invoice cards have a staged pay flow: approve → choose `pay_method` (ach|check, switchable) → ACH opens the Pay Hub payUrl. Server action is idempotent (same method = no-op) and 409s on paid invoices. Choosing a method implies approval.
- **Auto-projected `invoice:<id>` cards are suppressed when a pushed card with sourceType=invoice/sourceId matches** — otherwise the client sees two cards with the same title and different powers. Projected invoice cards carry a display-only module (canApprove:false); real actions only work on `push:` cards because the action endpoint needs a client_board_cards row.
- Old module snapshots lack newer fields (summary photos/flaggedItems/taskSections). Detail views must render gracefully from counts-only snapshots; full data appears after a re-send (refreshModule path rebuilds it).
- `BoardCardModules.tsx` exists in TWO near-duplicate copies: lib/board-ui (used by both boards via AppleCard) and artifacts/client-dashboard (legacy). Edit BOTH or they drift.
- All buttons inside CardDetailDialog content need `type="button"` — the dialog body is a `<form>`, so a missing type submits it and closes the dialog ("card disappears").
- **Why:** these rules came from a session where a duplicate projected card made the new invoice UI look missing, and stale module snapshots made features appear broken.
