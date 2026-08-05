---
name: HALO Walk app
description: Field walk app (artifacts/walk) — walks/walk_captures data spine and how completion creates HALO jobs.
---

# HALO Walk

- Separate PWA-style web app at `/walk/` for the PM: Start (kind only) → Capture (photo + unit + scope) → Review (complete → jobs).
- **Own passcode + Thornbury-locked (Aug 2026):** Walk has its OWN passcode, separate from the office one (user request). Walk routes (boundary-anchored `WALK_RE` in officeAuth) require the `halo_walk_session` cookie OR an office session; `/walk-auth` status/setup/login/change/logout live in officeAuth.ts, hash in business_settings.walkPasscodeHash (survives reset). Setup needs office authority (office cookie or inline office passcode) and the walk passcode must differ from the office one; change is office-cookie-only (office can reset a lost walk passcode). Client lock screen = WalkGate wrapping the router. EVERY walk route still self-scopes server-side to the single target property resolved by `getWalkTargetProperty()` (name ilike '%thornbur%') and every mutation carries `limits.walkWrite` — never loosen either.
- Data spine: `walks` + `walk_captures` (no FKs, per project convention). Both are in the Settings reset delete list.
- **Completion is transactional and lock-guarded**: walk row `SELECT ... FOR UPDATE`, status claim open→completed, all job creation inside the same tx. Capture add/delete also lock the walk row and 409 once completed.
- **Why:** review round found double-completion and capture races; locking made second completions fail deterministically.
- Completion creates one FLEX job per unit (J-#### count-based like other job routes), scoped captures become `job_line_items` where **rate is resolved server-side from the property price book by normalized service name** — client `unitPrice` only covers "Other" scopes. Captures get `jobId` so the job events feed shows "N photos captured on the property walk".
- **How to apply:** any new walk output (or new capture field feeding jobs) must go through the same locked transaction and server-side pricing; never trust client prices for price-book services.
