---
name: HALO job lifecycle values
description: What jobs.status / boardStatus / clearedAt actually mean, and which combinations a read model must use to count live work
---
`jobs.status` is free text, not an enum, so the values that *appear* in dropdowns are not the values the board runs on. The authoritative lifecycle is:

- `status`: `open` → `scheduled` → `complete` → `paid`, plus `cancelled`.
- Crew-is-working is **`boardStatus === "filled"`**, not a status value. `in_progress`, `blocked`, and `invoiced` exist only in the desktop edit form's picker; nothing writes them.
- Finished is `status "complete"` (with `boardStatus "completed"`). There is no `status "completed"`.
- Off the board is `clearedAt` being set, or `boardStatus "removed"`. There is no `status "cleared"`.

**Why:** a new read model that counted "in_progress" and "completed" statuses silently reported zero live work and misclassified paid jobs as blocked, because those strings are never written by the API.

**How to apply:** any dashboard, digest, or briefing that counts live work should filter out `clearedAt || boardStatus === "removed" || status === "cancelled"` first, then derive working/done/paid from `boardStatus === "filled"`, `status === "complete" || boardStatus === "completed"`, and `status === "paid"`. Mirror `jobRail()` in the desktop Job Board rather than inventing a second interpretation.

Related trap in the same area: the money summary endpoint returns `marginPct: 0` when nothing has been measured (no bank, no jobs carrying a margin). Treat a flat zero as "not measured", never render it as a result.
