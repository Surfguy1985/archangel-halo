---
name: HALO Tax Planner
description: 2026 federal tax planning engine inside Books — entity comparison, Books prefill, settings singleton
---
- Planning engine lives server-side (api-server lib), ported from a user-supplied reference package; it is an ESTIMATOR, not a filing engine — keep assumptions/warnings/disclaimer in every response.
- Rules are per-year immutable packs (RULES_2026). Future years = new pack selected by taxYear, never mutate old numbers.
- Entity math: S-corp AND C-corp must deduct owner W-2 wages + employer payroll tax from business profit before entity-level tax, or wages are double-counted (reference package had this bug for C-corp; we fixed it).
- Planner settings are a singleton table preserved by the Settings data reset (like business_settings) — do NOT add it to the reset delete list.
- Percent fields are stored as 0–100 pct in DB/API and converted to fractions only at the engine boundary.
- Books prefill: YTD revenue/expenses summed from journal lines by account type, annualized by elapsed days; the user chooses YTD vs full-year pace in the UI.
**Why:** keeps tax math auditable and consistent between estimate and compare endpoints.
