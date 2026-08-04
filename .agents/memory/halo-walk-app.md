---
name: HALO Walk app
description: Field walk app (artifacts/walk) — walks/walk_captures data spine and how completion creates HALO jobs.
---

# HALO Walk

- Separate PWA-style web app at `/walk/` for the PM: Start (property + kind) → Capture (photo + unit + scope) → Review (complete → jobs). Uses the office passcode cookie; app shows its own lock screen on any 401 (queryClient onError → `notifyUnauthorized()` module hook — the QueryClientProvider must stay OUTSIDE AuthProvider).
- Data spine: `walks` + `walk_captures` (no FKs, per project convention). Both are in the Settings reset delete list.
- **Completion is transactional and lock-guarded**: walk row `SELECT ... FOR UPDATE`, status claim open→completed, all job creation inside the same tx. Capture add/delete also lock the walk row and 409 once completed.
- **Why:** review round found double-completion and capture races; locking made second completions fail deterministically.
- Completion creates one FLEX job per unit (J-#### count-based like other job routes), scoped captures become `job_line_items` where **rate is resolved server-side from the property price book by normalized service name** — client `unitPrice` only covers "Other" scopes. Captures get `jobId` so the job events feed shows "N photos captured on the property walk".
- **How to apply:** any new walk output (or new capture field feeding jobs) must go through the same locked transaction and server-side pricing; never trust client prices for price-book services.
