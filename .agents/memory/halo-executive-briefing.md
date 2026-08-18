---
name: HALO executive briefing deck
description: What the Pulse "Present" button opens, and the rules the boardroom deck must keep
---
The `Present` button on the Property Pulse Reports card opens a shared full-screen briefing deck (board-ui, used by both the mobile and desktop office apps). Seeding the investor demo property moved to the Showcase entries in the More sheet / sidebar; the two are separate features and should stay that way.

Rules the deck must keep:

- It fetches its own live data and keeps polling while open. A figure quoted in a meeting must be the figure the office sees.
- Never render an unmeasured value as `0`. Distinguish three states: measured, measured-as-none, and *not loaded yet* — an empty array from a still-pending query is not a zero.
- The deck length changes as data arrives (the portfolio pulse inserts slides ahead of Cash). Hold the presenter's place by slide id, not index, or the room jumps backwards mid-sentence.

**Why:** a boardroom screen reads every number as a measurement; a fabricated zero on "jobs blocked on a PO" or "crews working" is worse than saying nothing.

**How to apply:** when adding a slide, give it a stable id, take its data as possibly-undefined, and return the loading slide when it hasn't arrived.
