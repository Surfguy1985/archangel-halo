---
name: HALO Founding Wings module
description: Agentic crew program — Halo Scores/tiers, First Flight, Wingline overrides 80/20 Guardian Reserve, AI quality review, daily automation.
---

- Money/eligibility decisions are DETERMINISTIC TS engines (`api-server/src/wings/core/`); AI (Anthropic claude-sonnet-4-6) only reviews photo evidence and writes the daily operator brief. Keep this split.
- Quality evidence source is the `crew_photos` table (jobId + phase 'before'/'after'), NOT activities. No-photo jobs go to NEEDS_REVIEW, never auto-fail.
- All sweeps are idempotent; reserve settlement claims the override in-transaction with a guarded UPDATE (`status='HELD'` → AVAILABLE/ADJUSTED, .returning) before touching balances — required because manual run + 15-min scheduler can overlap.
  **Why:** double settlement corrupts reserve balances/txns.
- Overrides are payout-ready ledger rows only; require paid invoices + gross profit + PASS quality; 80% immediate, 20% Guardian Reserve (~45-day window, quality kicker on release, rework costs debited first).
- Scheduler: 15-min sweep + daily brief 07:15 ET guarded by lastWingsBriefDate. Wings tables are in POST /settings/reset delete list — add new wings tables there too.
- UI: desktop /wings admin page + sidebar + WingsGuideDialog in More; mobile /wings + MoreMenuSheet entries (guide via ?guide=1); both CrewPortals have a "wings" tab using GET /portal/{token}/wings (token-scoped, own data only). All guide copy is EN/ES.
- Wings endpoints unauthenticated on purpose (see no-auth posture memory) — architect will flag this; it's by design.

## Membership approval gate
- New wing_members default membershipStatus PENDING_APPROVAL; only ACTIVE members pass First Flight eligibility or accrue sponsor overrides (both recruit AND sponsor must be ACTIVE).
- Decision endpoint sets ACTIVE or SUSPENDED + approvedAt/approvedBy, audit-logged; readiness in members list counts only completedAt-set assignments, W-9 via crews.w9_submitted_at, unresolved incidents.
- **Why:** owner wants recruits to build history but not receive jobs/overrides until vetted.
