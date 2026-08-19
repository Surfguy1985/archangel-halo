---
name: HALO board workspace (views, filters, custom fields)
description: Rules for the office Job Board's saved-view / custom-field layer — where rail logic must live, what drag may do, and how custom field values are written.
---

# Board workspace layer

## Rail derivation has exactly one home
Board rails, list groups and table rows must all derive a card's rail from the
same shared helper.
**Why:** the board, list and table each looked correct alone but disagreed about
which rail a card belonged to when the logic was duplicated.
**How to apply:** any new board surface imports the shared rail helper — never
re-implements the status/PO/invoice precedence.

## Drag is gated by the server's narrow transition set
The job board-status endpoint accepts only a small set of statuses; the move to
billing is a different endpoint with its own PO + checklist gate.
**Why:** a "kanban" board implies every drag is legal, and it is not — most rail
changes are earned by real events (a crew claims, a PO arrives), not by dropping.
**How to apply:** plan the move client-side first and show the office *why* a
drop is refused; keep a per-card in-flight guard, because the card stays in its
old rail until the refetch lands and can otherwise be dropped twice.

## Custom field values are a jsonb bag, merged in SQL
Field definitions carry a permanent slug key; values live in a jsonb bag on the
job under that key. Retiring a field archives the definition and leaves the
values intact.
**Why:** two people editing different cells of the same job at once silently
lost one edit when the handler did read-modify-write in JS; and a hard delete
would have destroyed values that a re-added field should still show.
**How to apply:** write with a jsonb merge/delete expression in one statement,
never a select-then-replace. Keys are never editable once created.

## Adding a field to the shared Job schema can 500 the whole board
Rows predating a new column carry null, so a non-nullable addition to the Job
response schema fails response validation for every card at once.
**Why:** the board went to a blank skeleton with a ZodError 500 the first time
a new object field was declared required.
**How to apply:** declare new Job fields nullable on the wire (or backfill
before shipping the schema change).
