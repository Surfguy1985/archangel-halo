---
name: HALO client board clear-to-history
description: How trash-icon card clearing, the History tab, and the CSV export work on the client board
---
- Clearing a card snapshots it (denormalized: status/amountPaid/unit/job/frequency derived server-side by cardKey prefix) into `client_card_history`, then hides it via an `archived` row in client_dashboard_cards (custom rows archive themselves; other families get a `kind:"override"` archived row). `projectBoard` post-filters any cardKey with an archived row.
- Clear endpoint is idempotent (FOR UPDATE check on the archived row; repeat clear returns the existing history entry), validates cardKey against a known-prefix regex (no synthetic history), and is rate-limited with `limits.cardAction`.
- CSV export is an express-only route `/client/:token/board/history.csv` (NOT in openapi), token-only; escaper must keep the spreadsheet-formula-injection guard (prefix `'` for cells starting `= + - @ \t \r`).
- `client_card_history` must stay in the Settings reset delete list AND the presentation-demo teardown delete list.
- **Why:** cards recompute on read, so history must be a snapshot at clear time; no un-clear/restore by design.
- Test sign-in recipe: create user via `POST /api/admin/accounts/:propertyId/users`, then POST /session (cookie jar) BEFORE /board/login, then Bearer sessionToken + cookie for writes.
