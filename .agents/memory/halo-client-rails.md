---
name: HALO client board rails
description: Client dashboard vendors tab is a five-rail board (Needs you first); mapping/token rules and what was intentionally retired.
---

The vendors tab of the client dashboard renders `RailsBoard` from @workspace/board-ui (rails/ dir): five FIXED rails — needs_you, in_progress, requested, done, paid — desktop = five columns, phone = horizontal snap rails (same components, flex-direction swap).

Rules:
- Rail assignment is a pure client-side adapter (`railMapping.ts`) over the unchanged server card contract: module.status "paid" → Paid; needsAction && !snoozedUntil → Needs you; lanes requested/scheduled+in_progress/done map through; billing w/o action → In progress. Do not change the server lanes for rail work.
- The accent (lime) border is RESERVED for Needs-you tiles; everywhere else hairline. Color = status only (RAIL_TONES). Shared tokens + density switch live in `railTokens.ts` — the office compact-row task must consume the same file.
- Client drag-and-drop is REMOVED on the vendors board by design ("cards move themselves"); PM tab and office mirror keep AppleBoard + drag. Tour/PresentationMode target `rail-<key>` testids (present even when a rail is empty and collapsed).
- Waybill volt strip moved from tiles to the CardDetailDialog sheet — keep it reachable there in restyles.
- Vendor-side custom/AI card creation was intentionally retired with the rails swap; "Request work" is the only client entry.

**Why:** Halo master spec direction approved by user (desktop-first). One decision per screen; Needs you is the product.
**How to apply:** Any new client-facing card family must map cleanly into one of the five rails and speak plain-phrase status (never internal enums) on its chip.

Office side: halo-desktop ClientBoardOffice renders the SAME cards as a dense `BoardRowList` (compact density, ROW_SPINE/ROW_TOKENS in railTokens) with filter chips replacing the Board/Inbox/History switcher and a J/K/Enter/Esc keyboard map. Office demo spotlights `board-row-list` / `board-filter-chips` testids now, not lane-*. Only `push:*` cards are deletable (id = cardKey minus prefix); sheet Move-to chips reuse the guarded `card.moved` action.

Known drift: tour/presentation narration MP3 clips still voice the pre-rails copy (targets/text were updated for rails); re-render clips or the drift-check task will flag it.
