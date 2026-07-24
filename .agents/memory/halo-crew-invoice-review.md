---
name: HALO crew invoice review
description: Admin review state machine for crew-submitted portal invoices
---
Crew invoices have a server-enforced state machine: submitted → approved → paid, submitted → needs_corrections → (crew resubmits) → submitted. Clearing to history sets clearedAt (only for non-submitted, not already cleared); invalid transitions return 409.

**Why:** Admin UI and crew portal both mutate the same rows with no auth/FKs; without server guards, stale clients or races could produce paid→needs_corrections and similar corrupt states. Resubmit's status precondition lives inside the UPDATE's WHERE clause (id + crewId + status='needs_corrections') to stay atomic under races.

**How to apply:** Any new invoice action must guard on current status in the route (not just the UI) and, for portal writes, keep preconditions inside the SQL WHERE. Note: api-server has NO global express error middleware — never throw from async route handlers; return sentinel values and respond with explicit status codes.
