---
name: Bounded newest-first scans and filters
description: Why every filter axis on a row-budgeted feed query must be pushed into SQL, not applied after the scan.
---

# Bounded scans must filter in SQL, on every axis

When a read model caps each source at the newest N rows (photo reel, feeds, activity
merges), any filter applied *after* that scan is a correctness bug, not just a
performance one: an unrelated high-volume entity can spend the whole row budget, so
the filtered result comes back empty even though matching rows exist.

**Why:** the photo reel scoped its job-backed sources by property in SQL but left the
Base44 evidence source scanning globally and filtering in memory. A busy community's
newest 400 evidence rows could push a quiet property's photos out of the window
entirely — the reel looked "empty", which reads to the office as "the crew never took
photos".

**How to apply:** for each source in a bounded merge, ask what the filter's column is
*on that source*. Sources keyed differently (an id on one, a free-text property name on
another) each need their own pushed-down predicate. Two related traps:

- Do not early-return when one source has nothing to offer. A property with no jobs can
  still have label-carrying evidence; the empty-jobs short-circuit silently dropped it.
- Name-matched sources must resolve ambiguity before querying: when two rows share a
  normalized name, match nothing rather than picking one, and keep those rows unplaced.
