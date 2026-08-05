---
name: HALO job board offer lifecycle
description: Invariants for the job board broadcast/approve/reopen flow across server and both frontends.
---

Rule: The offer lifecycle keeps exactly one job_broadcasts row per (job, crew). Rebroadcast to a declined/withdrawn crew RESETS that row to pending (sentAt now, respondedAt null) — never insert a second row. Approval must be atomic first-wins: the job "fill" is a guarded UPDATE (`WHERE boardStatus != 'filled' AND status != 'complete'` + affected-row check via .returning()) inside the transaction; losers get 409.

**Why:** No DB FKs/unique constraints back this — a plain read-then-write let two crews both "win" a job (double schedule rows, last-writer crewLeaderId), and naive rebroadcast created duplicate offer rows shown twice in portals.

**How to apply:** Any new mutation that claims/fills a job (or similar single-winner resource) must use the guarded-update + row-count pattern, not a pre-check. Board status is derived: `completed` if job.status==='complete', else job.boardStatus.

Multi-slot broadcasts: jobs carry crewsNeeded/crewsFilled; the slot claim is a guarded UPDATE with `WHERE crewsFilled < crewsNeeded`, SQL increment, and a CASE that flips boardStatus to 'filled' only on the last slot; crewLeaderId is COALESCEd to the first accepter. Every path that resets crewsFilled to 0 (unlist AND reopen) must also null crewLeaderId when any approval existed and revert status scheduled→open — otherwise a stale leader survives a partial fill. Flex broadcasts store scheduleType='flex' + flexDueBy computed with LOCAL date math from flexDays. Posting terms are editable after broadcast via a board-settings endpoint — any such read-modify-write on the job row must `SELECT ... FOR UPDATE` inside the tx or a concurrent portal slot-claim races it into inconsistent crewsFilled/boardStatus.

Also: job photo storagePath already starts with `/objects/`, so display URLs are `/api/storage${storagePath}` — prefixing `/api/storage/objects/` doubles the segment and 404s.

## Specialty broadcasting & staggered starts
- Broadcast mode "specialties": each crew gets an offer covering only line items whose service matches their specialty profile (crews.services names, trade fallback; token-containment matcher `crewCoversService` mirrored client-side in QuickJobDialog). Already-assigned items go only to their assigned crew.
- job_line_items.startTime + job_broadcasts.forServices/startTime carry staggered arrivals; earliest time wins when one crew covers several services.
- `sendBroadcasts` is the single offer writer: it must refresh forServices/startTime on ALL targeted rows (including live pending/approved offers) so rebroadcasts in a different mode never leave stale scope; inserts upsert against the (job_id, crew_id) unique index.
