---
name: HALO job finance recompute
description: Rules for per-job finance (crewRate, grossProfit, marginPct) and property margin stats
---

- Job finance is denormalized: `grossProfit` and `marginPct` (FRACTION) are stored on jobs and recomputed by `recomputeJobFinancials` (revenue = non-draft invoices for the job; costs = crewRate + job expenses).
- **Rule:** any mutation that changes job revenue or costs (invoice create/patch/delete/send/status, payment record, expense create, job crewRate PATCH) MUST call the recompute, or stored margins go stale. Deleting rows via raw SQL also leaves stale values — re-trigger a recompute afterwards.
- Property stats `activeMarginPct`/`historicalMarginPct` are PERCENT (0-100), revenue-weighted from grossProfit with avg-marginPct fallback; "active" = not cleared and not complete/closed/cancelled.
- POST /expenses validates jobId belongs to propertyId (400 otherwise); keep client dialogs from letting property drift when a fixed jobId is supplied (lock the property field).
- **Why:** desktop expense dialog once allowed picking Property B while submitting a job from Property A, corrupting finance links.
