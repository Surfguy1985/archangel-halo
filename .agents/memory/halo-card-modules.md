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
- New module kinds: `crewmap` (live crew snapshot, sourceId = propertyId so one card per property, full-bleed client popup uses the LIVE /client/:token/board/map endpoint, not the snapshot), `invoice_batch` (per-invoice payUrl/pdfUrl inside invoices[] — there is NO top-level payUrl/pdfUrl, sourceId = sha1 of sorted ids, module.invoiceIds is the refresh source), `bid` (bid + lineItems + /api/bids/:id/pdf), `document` (link-based inline PDF viewer). Composer kinds map to legacy card kinds (crewmap→tracker, invoice_batch→invoice, bid/document→manual) — render off module.type.
- Summary modules carry `taskSections` (capped checklist) for the expanded card task list; invoice module now includes pdfUrl.
- Field names in module payloads are the API's camelCase (crewName, description) — mirrors reading shorthand names (c.name, item.desc) was a real bug once.

## Push-card attachments + guaranteed pay links (Jul 2026)
- Push cards accept `attachments[{name,url}]` (openapi ClientCardPushInput); server validates (/api/storage//api/invoices paths or http(s) only, cap 8 links) and merges into card links. Desktop PushCardDialog uploads via /api/storage/uploads/request-url + presigned PUT.
- buildInvoiceModule/buildInvoiceBatchModule auto-mint a payment_request (status sent, sentVia board, invoice-PDF attachment) when none covers the invoice — invoice cards ALWAYS carry payUrl. Creation is advisory-lock guarded per invoice (`paylink:<id>`) plus a global `payhub:request_no` lock because PR numbering is count-based.
