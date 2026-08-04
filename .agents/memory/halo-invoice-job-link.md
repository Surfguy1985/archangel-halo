---
name: HALO invoice job link
description: Invoices are never free-floating — required job-card link and where it's enforced.
---
Rule: every office invoice must be linked to a job card at the same property.
**Why:** user directive (Aug 2026) — invoices were creatable "free-floating" and job financials/close-out gates missed them.
**How to apply:**
- Server is the source of enforcement: invoice create/update validate the job link (400 if missing, unknown, or other-property job); an edit can move the link but never clear it (omitted jobId keeps the existing one).
- Any NEW invoice-creation path (voice tool, concierge, portal, batch) must supply a valid jobId or intentionally skip creation with a clear message.
- Exemption: AI file-ingest invoice imports may stay jobless (historical records); legacy jobless invoices get forced to pick a job on next edit.
- Frontends: job pickers are required fields in mobile editor and desktop create page; wizard is job-based by design.
