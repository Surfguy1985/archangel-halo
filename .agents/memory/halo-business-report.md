---
name: HALO business report
description: How the Money "Report" tab / business report computes per-property P&L and where its data comes from
---

# Business report data rules

Rule: the business report (JSON, AI insights, PDF) is all derived from one shared compute function on the server; changing what counts as revenue or expense must happen there, not in the UIs.

**Why:** three consumers (report endpoint, insights prompt, PDF) must never disagree on the numbers.

**How to apply:**
- Revenue = our invoices to property managers, drafts excluded; collected = paid, outstanding = the rest.
- "Supplies" bucket = expenses table (with per-category breakdown); "invoices/labor" bucket = crew_payments (job→property) + submitted crew invoices.
- Crew invoices carry only a free-text propertyAddress — they are linked to properties by a scored significant-token match (exact normalized match wins; else ≥2 token overlap; ambiguous/low-confidence → "Unassigned / general" row). Never first-substring-hit matching — it corrupts per-property P&L.
- All marginPct values in the report are FRACTIONS (0.25 = 25%); UIs and PDF multiply by 100.
- Weak job threshold: margin < 0.25 or negative gross profit (same as Margin Guardian).
- AI insights failures: insights endpoint returns 502 with friendly message; PDF degrades gracefully (ships without the AI section).
