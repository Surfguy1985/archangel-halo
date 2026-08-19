---
name: HALO Command money actions
description: Why a new HaloCommand action that touches money must be registered in three separate places, and what silently breaks when it isn't.
---

A HaloCommand capability that changes money is only real when it appears in **three** registries. Miss one and the failure is silent or misleading, never an error the author will notice.

1. **`ACTION_TO_CAPABILITY` (enforcerCore)** — maps the capability string to a role grant. Missing entry ⇒ `capabilityForAction` returns null ⇒ `authorizeAction` 403s **every** caller with `insufficient_role`, no matter their role. The action looks implemented and can never run.
2. **`CAPABILITY_GATE_MAP` (command route)** — maps it to a `ConsequentialAction`. Missing entry ⇒ it classifies as `auto`, skips ASSISTED review and the amount ceilings, and executes straight from a sentence. Absence means allowed, not blocked.
3. **The executor itself** — must write the field the rest of the system actually reads, then rebuild derived money.

**Why:** the three registries are owned by different layers (identity, Falkon gate, dispatch) and nothing cross-checks them, so a new action can be simultaneously un-runnable and, if it ever ran, ungated.

**How to apply:** when adding any `*.adjust` / money-moving capability, grep for all three and add all three, then execute it once against a real record and confirm the row moved.

Two field-level traps in the same area:

- **`crewPay` is display, `crewRate` is truth.** `recomputeJobFinancials` and `syncJobLaborLedger` both read `crewRate` (+ `emergencyBonus`); the `crewPay` jsonb array is not read by either. A payout change that only writes `crewPay` leaves margin and the labor ledger frozen at the old number while the UI shows the new one. Write both: `crewRate` = sum of the `crewPay` amounts.
- **Draft invoices post nothing.** Revenue in margin excludes `status = "draft"`, and the invoice ledger sync posts nothing for a draft, so an invoice edit on a draft legitimately leaves `gross_profit`/`margin_pct` null. That is not a broken sync — check the invoice status before chasing it.

**Narration is not confirmation.** The `/command/conversations/:id/ask` brain composes its answer text *before* anything executes, and that endpoint never dispatches; the client executes the returned `actionPlans` separately against `/command/actions/execute`. So the chat bubble can read "line updated to $450" for a job that has no invoice at all. Trust the action-plan card's status/result, and when judging whether an action worked, verify the row — never the prose.
