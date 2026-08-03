---
name: HALO member dispatch board
description: Per-member daily dispatch assignments, foreman teams, and the pending-move approval state machine.
---

# Member dispatch & crew teams

- `crews.leaderId` (nullable, no FK) groups members under a foreman (`isLeader` crew). Deleting a crew clears members' `leaderId` and deletes their dispatch assignments.
- `crew_dispatch_assignments`: (memberId, day, jobId) unique; jsonb checklist of `{id,text,done}`; status `assigned | pending_move` with `pendingJobId`.
- **State machine rule:** all move transitions are guarded conditional UPDATEs (`WHERE status=... AND pending_job_id=...`) with row-count checks; unique-violation (23505) maps to 409. New writers must keep this pattern — no read-then-blind-update.
- Moves for members with a foreman go `pending_move` and settle only via portal `move-response` (foreman-only, verified through the member's `leaderId`); members without a foreman move immediately. Decline notifies office via notifications.
- Checklist seeded server-side from job line items + description split (see `seedChecklist` in dispatchBoard routes); office edits and any move re-seed it.
- Members with a `leaderId` are blocked (403) from portal → office messaging; they route through the foreman. Any new portal contact surface should respect this.
- Job delete/reset: `crew_dispatch_assignments` is in the job-delete cascade (also cancels pending moves targeting the job) and the Settings reset wipe list.
- Office UI is the "dispatch" view inside desktop Calendar (`PropertyDispatchDay`), separate from the weekly crew×day `/dispatch` page — both must keep working.

**Why:** no DB FKs and multi-writer portal/office access make unguarded updates corrupt the move flow (double-approve, orphaned refs).
