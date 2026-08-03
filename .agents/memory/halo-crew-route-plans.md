---
name: HALO crew day-route plans
description: Ordered per-crew, per-day route plans — stop-key contract shared by office API and crew portal feed.
---

- A route plan is an ordered list of **stop keys**: a `schedules` row id for job stops, or `event-<calendarEventId>` for crew calendar events. These keys are the same ids the crew portal schedule feed uses — office and portal must never diverge on key format.
- **Why:** the portal applies the saved order by matching its item ids against the saved keys; a format drift silently reverts crews to time order.
- **How to apply:** any new stop source (e.g. another assignment rail) must emit keys the same way in both the office day-plan builder and the portal feed, and dedupe by jobId against schedule rows.
- Saved plans are lenient: unknown/stale keys are filtered out on save and on read; unplanned stops append after planned ones, ordered chronologically via a free-text time parser (window times are strings like "9:00 AM" — never sort them lexicographically).
- One plan per (crew, day) via unique index + upsert. Table is in the settings-reset wipe list and crew-delete cascade.

**Testing office-gated endpoints:** supertest tests can mint a valid office session cookie themselves — HMAC `office.<exp>.<nonce>` with SESSION_SECRET (same scheme as officeAuth) — instead of running a passcode login flow. See crewRoutePlan.test.ts. Routes are mounted under `/api` in app.ts.
