---
name: HALO client board UI (stacked mode + unit template)
description: Client dashboard board view modes, touch-expansion quirk, and the fixed 50-box unit template contract.
---

## Stacked/unstacked board view
- Board has two view modes persisted in `localStorage.halo_board_view_mode` (`stacked` | `unstacked`). Stacked lanes overlap cards with negative top margins; expansion is driven by `hoveredLane`/`expandedLane`/`dragOverLane`.
- **Why the touch guards exist:** taps on touch devices fire synthetic `mouseenter` before `click`, so hover-gated expansion lets the tap fall through to a buried card. Hover is ignored on `(pointer: coarse)` devices; first tap on a collapsed multi-card stack expands it (`onClickCapture` + preventDefault), and expansion is exclusive (claiming one lane collapses others; mouseleave is unreliable across lanes).
- **How to apply:** any future rework of lane interaction must keep tap-to-expand + exclusive expansion, and keep the drag handlers structurally intact (touch-drag logic also lives there).
- Testing note: lane DIVs are full-height flex containers — lane height never indicates collapsed state; measure card top offsets instead (~78px collapsed vs 400px+ expanded).

## Fixed 50-box unit template
- Units page renders exactly 50 slots (no map image, no grid generation, no manual create); units fill in numeric label order, extra slots are dashed placeholders. This capability reduction is a deliberate user decision.
- Server (`unitMapView`) auto-materializes `property_units` rows for unit labels seen only in HALO data (jobs/work requests/invoice line items), capped so total ≤ 50, with staggered default coords so the office AdminUnitMap doesn't stack boxes at (0,0). `computeUnitStatuses` returns `{ byUnit, display }` — display preserves raw labels for materialization.

## Reference board rebuild (Jul 2026)
- Card grammar driven by `components/kanban/templateSpec.ts`: specs come from `ref-templates.ts` (22 reference templates); API template ids (job/request → wo, makeready, invoice, crew, custom) are aliased in `specFor()` — new API templates must be added to the alias map or cards render with the wrong accent/pipeline.
- Triage sheet in board.tsx lists urgent/high, past-due, and requested-lane cards; Defer is client-side only (in-memory dismiss); read-only viewers get the login dialog instead of dispatching actions.
- Create Card button is visible to guests by design (click → login dialog); template picker encodes the chosen template name in notes/description because the create API has no template field.
- Header has BOTH `button-map-view` (crew map /map, tour target — must keep) and `button-site-map` (units grid /units).

## Fixed-seed spec rebuild (Jul 2026)
Board now follows the uploaded fixed-seed spec (attached_assets/REPLIT_PROMPT_1785304749112.md, sections 2-5): every card is a fixed 340x430 nine-region frame, all surfaces color-mix derived from the category accent hex, navy pulse rail + category chip toolbar in the chrome.
**Rules that keep breaking:**
- Lane render order MUST be persisted `position` order — never sort cards by heat/due date, or drag reorder-within-lane silently stops sticking. Heat is only for the "N hot" column badge and the SLA rail.
- Header buttons `button-map-view`, `button-site-map`, `button-board-tour` are a test/tour contract (DashboardTour anchors) — restyles must keep them.
- Category chips/counts must derive from templateSpec specFor()/API_TEMPLATE_ALIASES, never hardcoded template lists.
- Card internal margins must sum to exactly 430 with the 38px footer — overflow:hidden clips the footer silently if any mt-* is padded out.
