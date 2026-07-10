---
name: HALO date-only fields must use local date, not UTC
description: Avoiding off-by-one day bugs when building/formatting YYYY-MM-DD date-only values
---

# Rule
For date-only (`YYYY-MM-DD`) values in HALO (schedules `scheduledOn`, calendar `eventDate`,
payment `paidAt`, etc.), build and display them from LOCAL date parts, never via UTC.

- Default/today: build `${y}-${pad(m+1)}-${pad(d)}` from `getFullYear/getMonth/getDate`,
  NOT `new Date().toISOString().slice(0,10)`.
- Display: parse `Y-M-D` into a LOCAL `new Date(y, m-1, d)` before `toLocaleDateString()`,
  NOT `new Date("YYYY-MM-DD")` (that parses as UTC midnight).

**Why:** `toISOString()` and `new Date("YYYY-MM-DD")` are UTC-based. For users in negative-UTC
timezones (US evenings), both shift the day by one, causing accidental mis-scheduling and wrong
dates shown in toasts/labels.

**How to apply:** any new date-only input default or human-readable date render — reach for a
local helper (localToday / formatYmd style). date-mode-string DB columns store the raw string, so
the fix lives entirely in the frontend build/format step.
