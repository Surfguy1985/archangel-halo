---
name: Pulse map on hidden/narrow stages
description: Why the Portfolio Pulse view went dead on phones/tablets — Leaflet mounted inside a display:none stage — and the rule that keeps it alive.
---

# Never mount a Leaflet map inside a CSS-hidden stage

The Portfolio Pulse map stage is hidden by a media query on narrow viewports, but the
map component was still mounted there. Leaflet cannot compute pixel positions for a
zero-size container, so the first camera move (`flyTo` / `fitBounds` / `invalidateSize`)
threw `Cannot read properties of undefined (reading '_leaflet_pos')`. That throw escaped
into React and unmounted the **entire** pulse view — the nav rail, the panels and the
Board button all went dead at once.

**Rule:** any map whose container can be hidden by CSS must (a) not mount at all while
the container is hidden — match the JS breakpoint to the CSS media query exactly — and
(b) guard every camera call behind a "container is connected and has non-zero size"
check wrapped in try/catch.

**Why:** a hidden map is invisible, so its failure is invisible too — the user only sees
that unrelated controls stopped responding, and reports it as "the button does nothing"
or "it's stuck behind the map". Nothing in the console points at the button.

**How to apply:** whenever a `display: none` breakpoint is added over a map stage, or a
map is placed inside a collapsible/tabbed container, add the mount guard in the same
change. When someone reports a dead control on a page that also has a map, check the
console for `_leaflet_pos` before hunting z-index.
