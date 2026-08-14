---
name: HALO crew de-duplication
description: Why duplicate crew rows appear and the rules that keep the Base44 sync from re-creating or corrupting merged crews.
---

- Duplicate crew rows come from the Base44 sync matching crews by exact name: a spelling variant creates a phone-less twin that jobs point at, so SMS pings silently go nowhere. The cure is merge + alias, not code in the SMS path.
- Rules the sync must keep: resolve crews by normalized name OR recorded alias before inserting; never null out contact fields HALO already has (Base44 phones are often missing); never rename an existing row — the office spelling wins.
- **Why:** merges repoint every crew reference and record the losing spelling as an alias; if the sync renames or re-creates the variant, the merge silently undoes itself on the next pull.
- base44_sync_map.halo_id is TEXT — always cast uuid comparisons (`halo_id = <uuid>::text`) or queries fail with `text = uuid`.
- drizzle-kit push prompts interactively (new-table-vs-rename) and dies without a TTY; runtime-required tables also need the idempotent startup-ensure path, not just a migration file.
