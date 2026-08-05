---
name: HALO client board rails
description: Client dashboard vendors tab is a five-rail board (Needs you first); mapping/token rules and what was intentionally retired.
---

The vendors tab of the client dashboard renders `RailsBoard` from @workspace/board-ui (rails/ dir): five FIXED rails — requested, in_progress, done, paid ("Billing"), needs_you ("Alerts", LAST and RED) — desktop = five columns, phone = horizontal snap rails (same components, flex-direction swap).

Rules:
- Rail assignment is a pure client-side adapter (`railMapping.ts`) over the unchanged server card contract: module.status "paid" OR module.clientPaidAt ("payment on its way") → Billing rail; needsAction && !snoozedUntil → Alerts; lanes requested/scheduled+in_progress/done map through; lane billing → Billing rail. Do not change the server lanes for rail work.
- 24h billing SLA is SERVER-side: unpaid money cards get needsAction only after 24h (auto invoice cards: sentAt??createdAt; pushed cards: card createdAt) — Alerts chip says "Past due". A client "mark_paid" action (new CardMarkPaidAction) stamps invoices.clientPaidReportedAt/By + module.clientPaidAt/By, keeps the card in Billing as "Payment on its way", and must never be swept until the office records real payment. clientPaidAt/By must ride ACTION_STATE_KEYS + buildInvoiceModule or refreshes clobber it. Projected `invoice:<id>` cards take mark_paid via a special pre-tx branch (guarded null-stamp UPDATE gates side effects; synthetic feed-card response).
- The accent border (now RED, was lime) is RESERVED for Alerts tiles; everywhere else hairline. Color = status only (RAIL_TONES; action tone = red). Shared tokens + density switch live in `railTokens.ts`.
- Client drag-and-drop is REMOVED on the vendors board by design ("cards move themselves"); PM tab and office mirror keep AppleBoard + drag. Tour/PresentationMode target `rail-<key>` testids (present even when a rail is empty and collapsed).
- Waybill volt strip moved from tiles to the CardDetailDialog sheet — keep it reachable there in restyles.
- Vendor-side custom/AI card creation was intentionally retired with the rails swap; "Request work" is the only client entry.

**Why:** Halo master spec direction approved by user (desktop-first). One decision per screen; Needs you is the product.
**How to apply:** Any new client-facing card family must map cleanly into one of the five rails and speak plain-phrase status (never internal enums) on its chip.

Office side: halo-desktop ClientBoardOffice now renders the SAME `RailsBoard` tiles as the client (comfortable density, "identical vendor board" per user), chips slice cards via `railFor`; the older dense `BoardRowList` remains exported but unused there. Keyboard map (J/K/Enter/Esc) still drives selection. Office demo spotlights `board-row-list` / `board-filter-chips` testids now, not lane-*. Only `push:*` cards are deletable (id = cardKey minus prefix); sheet Move-to chips reuse the guarded `card.moved` action.

Known drift: tour/presentation narration MP3 clips still voice the pre-rails copy (targets/text were updated for rails); re-render clips or the drift-check task will flag it.
