---
name: HALO job board offer lifecycle
description: Invariants for the job board broadcast/approve/reopen flow across server and both frontends.
---

Rule: The offer lifecycle keeps exactly one job_broadcasts row per (job, crew). Rebroadcast to a declined/withdrawn crew RESETS that row to pending (sentAt now, respondedAt null) — never insert a second row. Approval must be atomic first-wins: the job "fill" is a guarded UPDATE (`WHERE boardStatus != 'filled' AND status != 'complete'` + affected-row check via .returning()) inside the transaction; losers get 409.

**Why:** No DB FKs/unique constraints back this — a plain read-then-write let two crews both "win" a job (double schedule rows, last-writer crewLeaderId), and naive rebroadcast created duplicate offer rows shown twice in portals.

**How to apply:** Any new mutation that claims/fills a job (or similar single-winner resource) must use the guarded-update + row-count pattern, not a pre-check. Board status is derived: `completed` if job.status==='complete', else job.boardStatus.

Also: job photo storagePath already starts with `/objects/`, so display URLs are `/api/storage${storagePath}` — prefixing `/api/storage/objects/` doubles the segment and 404s.
