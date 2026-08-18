---
name: HALO job priority ordering
description: Job ordering is ascending/lower-first per the client-board precedent; allocating a top slot needs a lock over the whole set, and severity tier still outranks it.
---

# Direction

Job ordering is ascending — lower sorts first, matching the client board's
existing card ordering. It is a float so a job can always be slotted between two
others, and the default leaves existing rows where they were.

**Why:** the repo already had one ordering convention. A descending
"higher = more important" field reads naturally in isolation but leaves two
contradictory ordering rules in one codebase.

# Allocating a slot needs a lock over the SET, not the row

"Move to the top" reads the current minimum and writes below it. Row-locking the
target record does not make that safe: two requests for different records lock
different rows, both read the same minimum, and both write the same value — so
neither ends up on top. Take a transaction-scoped advisory lock over the whole
ordering set, following the hashed-name advisory locks already used elsewhere
for numbering and minting.

**Why:** this exact defect shipped and was caught in review. The general rule:
when the value you write is derived from an aggregate over a set, the lock has
to cover the set. Locking the row you are about to update looks correct while
protecting nothing.

**How to apply:** anything else that allocates an ordering slot must take the
same lock or it races. Keep a test that fires concurrent allocations and asserts
distinct slots — and confirm it fails with the lock removed, or it proves
nothing.

# Tier still wins

The daily feed sorts by severity tier first, then ordering within the tier. A
prioritized job rises to the top of its own tier, not the whole list.

**Why:** letting an operator preference outrank severity would push urgent money
alerts below a routine job somebody bumped.
