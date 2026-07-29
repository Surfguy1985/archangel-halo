---
name: HALO client board card modules
description: Interactive module payloads on pushed client-board cards — build/refresh rules, action endpoint gating, dedupe gotcha
---

Pushed office cards (`client_board_cards`) carry a `module` jsonb payload (invoice snapshot + pay/approve, tracker GPS, flagged items, referral form). Rules:

- **Modules are built server-side at push time** (`lib/cardModules.ts`, wired in the admin push route). The office composer only sends `sourceType`/`sourceId`; never trust client-supplied module data.
- **Re-send refreshes module data but must preserve client action state** (`approvedAt`, `requestedAt`, `referredAt`, ...) — see `pickActionState` in `lib/clientBoard.ts`. Adding a new action-state key means adding it to `ACTION_STATE_KEYS` there.
- **Dedupe gotcha:** pushing the same invoice twice UPDATES the existing card (upsert by property+sourceType+sourceId), including its title — an "already approved" fresh push is usually this, not a bug.
- **Client board projection:** pushed cards surface on the client `/client/:token/board` projection as `cardKey "push:<id>"` (routes/clientBoard.ts projectBoard) — they do NOT come from the `/board/feed` endpoints the client dashboard doesn't use. The action endpoint strips the `push:` prefix.
- **Action endpoint** `/client/:token/board/cards/:cardId/action` requires an authenticated non-guest board session (Bearer, `resolveViewer`) — the link token alone is view-only; actions run in one transaction with the card row locked (`.for("update")`) so double-clicks can't duplicate work requests/approvals; each action validates module type (approve↔invoice, schedule↔flags, refer↔referral).
- **Why:** approve mutates `payment_requests.approvedAt` and schedule creates real Pipeline work requests — token-only write access was flagged as broken access control in review.
- Office composer: typing a custom TITLE keeps the quick-pick source (module depends on it); amount/link edits still clear it. Referral pushes store kind "manual" with a referral module — office UI must key referral rendering off `module.type`, not only `card.kind`.
- **Full admin CRUD:** office PATCH/DELETE on `/admin/accounts/:propertyId/board/cards/:cardId` work on ANY pushed card (manual-only restriction lifted); PATCH `refreshModule:true` rebuilds the module from the card's source while preserving `ACTION_STATE_KEYS` (exported from lib/clientBoard.ts — reuse it, never inline the list).
- **Source library:** quick-picks endpoint returns invoices, trackers, summaries (job recaps), and photoJobs; module kinds now include `summary` (recap snapshot + public /summary URL) and `photos` (thumbnail strip from crew_photos, root-absolute /api/storage URLs — never BASE_URL-prefixed).
- Both boards use an Apple-app-tile design language: per-kind color+icon squircles (invoice amber, tracker violet, summary sky, photos pink, flag red, referral teal); keep new module kinds in that palette.
