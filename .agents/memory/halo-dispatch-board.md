---
name: HALO dispatch board
description: Rules for the desktop drag-and-drop dispatch board and its /jobs/:id/dispatch endpoint
---
Rule: any dispatch-style move (assign/unassign + reschedule) must be one transaction that syncs ALL derived state: jobs.crewLeaderId/scheduledOn, crewVacatedAt cleared on any deliberate dispatch decision, boardStatus (assign → "filled" unless removed/completed; unassign → "reopened" if it was "filled"), broadcast withdrawals, and a rebuilt schedules-mirror row (exactly one per dispatched job, none when backlogged) so the crew portal feed updates immediately.

**Why:** code review rejected a first pass that left backlogged jobs stuck at boardStatus "filled"; "reopened" matches the emergency-vacate semantics in jobboard/emergency routes.

**How to apply:** new assignment/reschedule surfaces should call or mirror POST /jobs/:id/dispatch rather than patching fields piecemeal; integration coverage lives in dispatch.integration.test.ts (env-gated via HALO_E2E_BASE + HALO_E2E_COOKIE).
