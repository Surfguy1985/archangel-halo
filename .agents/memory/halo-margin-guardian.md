---
name: HALO Margin Guardian
description: How thin-margin jobs are flagged into the Today/queues feed and the fraction gotcha.
---

# Margin Guardian

Adds a `margin` queue to the `computeQueues()` feed for jobs below the margin floor.
The floor is now PER-PROPERTY: `properties.marginMin` (fraction, nullable) with a 0.25
default fallback. Properties also have `marginTarget` (target margin). Both are editable
from the Margin section on Property/Job detail pages in both apps (MarginSection component
per app); job `marginPct` (current) is also settable via PATCH /jobs/:id.
Tier is `now` when margin < 15%, else `today`. It surfaces in the Today feed and all
task-list emails automatically because they render the same feed.

**marginPct is stored as a FRACTION, not a percentage** (0.25 = 25%). Compare against
`0.25`, and multiply by 100 only for display. Comparing against `25` silently flags nothing.

**Active-status filter is exclusion-based**, not a whitelist: flag when status is NOT
`complete`, `paid`, or `cancelled`. Using exclusion keeps future active states (e.g.
`in_progress`) covered without code changes. Do NOT flag `complete` jobs — the guardian is
about jobs you can still act on.
