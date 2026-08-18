---
name: HALO Property Pulse dock rails
description: How the /pulse HUD panels dock, float, and persist — and the flex rules that keep the map usable
---

The Pulse HUD is a **hybrid layout**: every nav item opens its own panel, docked by
default into an importance-ranked rail, and any panel can be popped out to float
(drag + resize) and docked again. A Reset layout control restores defaults.

Rail assignment is editorial, not alphabetical:
- **left rail** = "where do I look right now" — Overview, Sites (POs on the Pulse desk), and the desk's third card (Reports / Vendors / Crew paycards).
- **right rail** = unused on the three-desk default. GPS Finder / Site Twin stay Punchlist map tools, not extra cards.
- The map keeps the whole centre channel between the rails.

**Why:** the office uses this as a wall dashboard. Ranking by urgency means the two
panels that answer "what needs me" are always in the same place, while detail panels
are opened on demand — so the default state stays legible on a shared screen.

**How to apply — the non-obvious rules:**

- **Docked boxes must not drag or resize.** The rail owns placement. The docked
  branch returns a non-positioned flex child and the position-resolving layout
  effect is gated to floating mode, so a docked panel never reads or writes a
  saved position.
- **Sizing is by intent, not a single height.** Panels whose content is fixed
  (stat grids, button stacks) size to their content (`flex-basis: auto`, no grow);
  list panels take a ranked preferred height and grow to absorb rail slack. Giving
  every panel a hardcoded height either clips the fixed ones or leaves dead space
  under the lists — both were observed before this split.
- **Rails are `pointer-events: none` with interactive children** so the map stays
  draggable in the gaps between panels. The consequence: the rail's own scrollbar
  cannot be grabbed. Docked panels therefore shrink to fit (small `min-height`) and
  their bodies opt out of `overscroll-behavior: contain` so a wheel gesture can
  chain out to the rail. Do not "fix" a full rail by re-enabling pointer events on
  it — that blankets the map with a dead column.
- **Panels must outrank Leaflet, inside an isolated stage.** Leaflet's own CSS
  stacks panes at 200-700, controls at 800 and `.leaflet-top/.leaflet-bottom` at
  **1000**, and neither `.leaflet-container` nor the stage wrapper creates a
  stacking context on its own — so any panel layer numbered below 1000 competes
  with those values and is painted *under the map*. The symptom is maddening:
  the nav button lights up, React state flips, the panel renders in the DOM, and
  nothing appears. The stage therefore sets `isolation: isolate` and the panel
  layers sit above 1000 inside it. Keep both halves: raising the numbers without
  isolating would also lift panels over the GPS Finder / Site Twin modals, which
  are siblings *outside* the stage at 80-95. Never introduce a `transform`,
  `filter`, or `will-change` on the stage — that would break `position: fixed`
  for anything inside it.
- **All three localStorage keys (positions / open / mode) are user-writable and
  outlive schema changes, so each is validated per panel id on load**, not spread
  over defaults. An unrecognised mode string matches neither rail nor the floating
  filter, which makes an open panel silently vanish; a non-object positions blob
  used to crash the page during state init.

**Scope:** desktop only. The mobile Pulse view is a deliberately separate design
problem and was explicitly deferred — do not port these rails to it verbatim.
