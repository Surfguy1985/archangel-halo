---
name: HALO property job timeline
description: Desktop property page 5-stage job timeline mirrors Job Board state; server derives its timestamps/flags
---
The desktop property page renders a 5-stage per-job timeline (Crew → Work → Invoice → $ → Close) that must stay in lockstep with the Job Board rails.
**Why:** the old 4-stage bar was computed locally and drifted from the board; the fix was to drive both from the same server fields.
**How to apply:** the property jobs read model (GET /properties/:id) derives `crewAssignedAt` (latest job activity kind="assigned"), `workStartedAt` (first crew check-in), and a combined crew-paid signal: `crewPaymentStatus`/`crewPaidAt` count BOTH crew_payments rows (portal flow) and the board's crewPay jsonb entries / boardStatus="pay_alert". Any new pay or check-in mechanism must feed these derivations or the timeline lies. The "$" stage is payment received AND crew paid (partial = half-lit segment with a hint). Property-page mutations invalidate getListJobBoardQueryKey; board mutations use blanket invalidateQueries(), so both views refetch each other.
