---
name: HALO Falkon waybill cards
description: FLK network codes + six volt-dot waybill strips on client/office boards; derived on read, no stored state.
---

- Waybill is DERIVED on read, never stored: `serCard` (feed/office feed, column+timestamp based via `deriveWaybill`) and `decorateWaybill` in clientBoard.ts (projected boards, lane-rank based via `deriveLaneWaybill`). Any NEW producer of `ClientBoardFeedCard` or `ClientBoardCardView` must emit `waybillCode` + `waybill` — both are REQUIRED in the spec, zod .parse will 500 otherwise.
- FLK code = `FLK-` + Crockford base32 of sha256(card id). Projected board cardKeys carry a `push:` prefix that MUST be stripped before hashing or client vs office show different codes for the same card.
- Dots are ALWAYS volt #B4FF44 (network owns status, brand owns header). Live sync rides the existing SSE→refetch pipeline; `useStagePings` in board-ui pings only stages newly appearing after first render (diff by stage name, immune to array identity churn). Never add per-card EventSources.
- Money cards (invoice templates / invoice module types) get the Falkon gradient face in AppleCard but KEEP ModuleBoundary/ModuleDecision wiring — do not fork the pay-flow state machine into the new face.
- Both boards move cards via the same `card.moved` dispatch + shared override storage, and both dispatch routes emitBoardEvent — that's why dots stay in sync by construction.
- **Why:** user requirement — dots must mirror card movement across boards perfectly; storing waybill state would drift.
