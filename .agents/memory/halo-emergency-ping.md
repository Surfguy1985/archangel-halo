---
name: HALO emergency crew ping
description: Emergency ping / bonus / pay-hold invariants — first-wins commit, HELD state machine, same-day pay, hold-settlement rule
---

# Emergency crew ping & pay holds — invariants

- **One winner per ping.** The single-winner gate is the guarded UPDATE flipping the ping open→filled (row-count checked, in a transaction). Any refactor must keep that flip as the sole claim point; losers get a 409 "filled".
  **Why:** no DB FKs or locks elsewhere — without this gate two crews can claim the same emergency.
- **Hold lifecycle is HELD → RELEASED or CANCELLED, release only via job close-out approval.** Never release a hold from any other path; cancel returns it.
  **Why:** the product promise is "pay is held until complete + approved"; double-release must be impossible.
- **A hold only counts as paid by its own money movement** — a paid payout or the canonical emergency same-day payment. All surfaces (earnings, Today sweep, payout queue) must use the shared settlement helper, never ad-hoc checks; a HELD hold satisfies the close-out "crew paid" gate, and release subtracts prior completed payments (emitting a settled marker when nothing remains) so obligations can neither duplicate nor linger.
- **Emergency bonus is a crew cost everywhere:** job financial recompute, labor ledger posting (base + bonus together), and payout suggestions (same-day jobs bypass net-30 and sort first). Adding a new cost aggregator? Include the bonus.
- **Bonuses are never exposed on client/property-facing surfaces.**
- Portal gotchas: `neededBy` is free text ("5 PM today") — never format it as a Date; new portal badge sections must be added to the canonical seen-section enum in the API spec or seen-marking 400s and the badge never clears; only refetch the bundle after seen-marks succeed to avoid retry loops.
- SMS pings are best-effort (must never fail the ping); delivery result is recorded per target.
