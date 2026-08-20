---
name: Pulse viewer surfaces are gated by payload, not by UI
description: Rule for anything on the Pulse desk that a non-office viewer reads — the response itself must be the boundary.
---

Anything rendered on the Pulse desk (the tablet/big-screen dashboard) is read by
property managers and regionals standing next to it, not by the office. Surfaces
built for them must be served by hand-built read models that omit invoice totals,
crew pay, margin, client billing and internal row ids — not by an office endpoint
that the UI happens to render selectively.

**Why:** the Pulse desk has no login. "The UI doesn't link it" is not a boundary;
anyone can read the JSON. The owner's stated line for these surfaces is photos,
scope, dates, status, turn time and PO status — no dollar figures at all.

**How to apply:** when adding a viewer-facing Pulse panel, add a dedicated
endpoint and hand-pick every field. If the UI needs an id to make its next call,
ship the minimum (a property id for scoping) and drop the rest; job numbers read
better than job ids anyway and lead nowhere.

Unit labels are typed a dozen ways ("12", "Unit 12", "#12", "apt 12-B"). Match on
a normalised form computed in SQL (strip to letters+digits) on BOTH sides, before
any row-budget limit — normalising in JS after a bounded scan silently drops
valid matches.

Turn time for a unit spans jobs, not one job: while anything is open, measure from
the earliest OPEN job, or an old finished job on the same unit stretches today's
clock into months.
