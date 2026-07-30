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


## Template-driven card grammar
- Card styling (accent/pipeline/prefix) comes from a client-side template spec registry; API template ids are mapped through an alias table — any new API template id must be added to that alias map or its cards silently render with the wrong accent/pipeline.
- Triage sheet in board.tsx lists urgent/high, past-due, and requested-lane cards; Defer persists server-side via the `card.snoozed` action (snoozedUntil on the override row); read-only viewers get the login dialog instead of dispatching actions.
- Create Card button is visible to guests by design (click → login dialog); the create API carries a first-class `template` field (validated server-side), with legacy notes-encoded template names still decoded for old cards.
- Header has BOTH `button-map-view` (crew map /map, tour target — must keep) and `button-site-map` (units grid /units).
## Fixed-seed spec rebuild (Jul 2026)
Board now follows the uploaded fixed-seed spec (attached_assets/REPLIT_PROMPT_1785304749112.md, sections 2-5): every card is a fixed 340x430 nine-region frame, all surfaces color-mix derived from the category accent hex, navy pulse rail + category chip toolbar in the chrome.
**Rules that keep breaking:**
- Lane render order MUST be persisted `position` order — never sort cards by heat/due date, or drag reorder-within-lane silently stops sticking. Heat is only for the "N hot" column badge and the SLA rail.
- Header buttons `button-map-view`, `button-site-map`, `button-board-tour` are a test/tour contract (DashboardTour anchors) — restyles must keep them.
- Category chips/counts must derive from templateSpec specFor()/API_TEMPLATE_ALIASES, never hardcoded template lists.
- Card internal margins must sum to exactly 430 with the 38px footer — overflow:hidden clips the footer silently if any mt-* is padded out.

## New-card spotlight & guest add-card
- Board open pops unseen cards front-and-center (NewCardSpotlight): seen-set in localStorage per token with in-memory fallback; first visit baselines quietly except pushed cards still in Sent stage. Keep it gated behind the tour so they never overlap.
- Add-card button is intentionally visible to guests; unauthenticated click opens the sign-in dialog instead of hiding the affordance ("clients can't create" complaints were guests with no visible entry point).
- Never call the parent's onClose/setState inside a React setState updater (DashboardTour advance) — triggers "cannot update a component while rendering".

## Read-only viewers & module action buttons (Jul 2026)
- ModuleDecision action buttons are now ALWAYS rendered (even for guests/read-only); clicking while readOnly calls optional `onReadOnlyClick` (wired to the Sign In dialog for guests, a toast for read-only members). Never hide or `disabled=` the buttons for readOnly — silent dead buttons were the "clients can't do anything" complaint.
- **Every button inside ModuleDecision/card modules must have `type="button"`** — these components render inside the Card Details dialog whose body is a form; untyped buttons fire a phantom form submit ("Form submission canceled because the form is not connected") and the click does nothing.
- CardDetailDialog must receive a LIVE card (re-derived from board query data by cardKey), not a snapshot, or post-action flips (e.g. flags WORK REQUESTED) never appear in the dialog.
- Playwright HTML5 drag simulation is flaky (dragstart often never fires); a failed synthetic drag is not proof the board broke — check for AppleCard console errors instead.
