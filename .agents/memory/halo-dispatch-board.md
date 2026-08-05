---
name: HALO dispatch board
description: Rules for the desktop drag-and-drop dispatch board and its /jobs/:id/dispatch endpoint
---
Rule (user-mandated, supersedes the earlier boardStatus-sync rule): **dispatch is scheduling-only and NEVER touches the vendor/job board** — no boardStatus changes, no broadcast withdrawals. It still updates jobs.crewLeaderId/scheduledOn/scheduledTime, clears crewVacatedAt, keeps status open↔scheduled, and rebuilds the schedules mirror (exactly one row per dispatched job, none when backlogged) in one transaction.

**Why:** the user explicitly required "the dispatch board never updates the board"; the board is managed only from the Job Board itself.

**Safety valve:** because dispatch no longer withdraws stale offers, the portal offer-approval handler hard-rejects (409) when jobs.crewLeaderId is already a different crew. Any new offer-approval path must keep this guard or two crews can hold conflicting access.

**Views stay in sync via shared sources:** Dispatch reads jobs (crewLeaderId+scheduledOn) directly; Calendar reads the schedules mirror + calendar_events. Dispatch moves rebuild the mirror; calendar's /jobs/:id/schedule updates the job — so the two views mirror each other without extra sync code.

Dispatch cards deliberately show only unit # + service (services come from GET /jobs, which attaches distinct job_line_items service names, "Quoted price" excluded; " — n BR" suffixes stripped in UI).

Crew portal schedule feed window is [1st of current month .. end of next month] to power the day/week/month view switcher in ScheduleTab; route-plan queries remain week-bounded.
