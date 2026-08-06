---
name: HALO crew availability & work history
description: Crews directory list, availability jsonb, work-history endpoint, bonus/gift-card payments
---
- `crews.availability` jsonb: `{ mon..sun: { on, from, to } }` — free-text times, edited on the crew profile AvailabilityCard, saved via the generic crew PATCH (`.set(body)` passes it through).
- `crew_payments.kind`: null/`job_pay` = normal pay; `bonus` | `gift_card` are extras shown only in the work-history popup — money aggregators still count them as payments, so keep that in mind if extras must be excluded from pay totals later.
- `GET /crews/:id/work-history` — completed jobs (services derived from `job_line_items`, NOT the job row), crew invoices (status reported "paid" when clearedAt set), extras. **Attribution is `jobs.crewLeaderId` — team members don't see jobs done under their leader; expand via roster if that semantic changes.**
- Crews page is a searchable directory LIST (not card grid); row icon actions must `preventDefault/stopPropagation` or they navigate.
- Crew profile map thumbnail reuses `GET /crews/map` pins filtered by crew id; non-interactive leaflet with CircleMarker (no icon assets).
**Why:** availability capture is step 1 toward week-ahead dispatch planning the user wants.
