---
name: HALO crew office-view access
description: Per-crew read-only office access grants surfaced in the crew portal link.
---

# Crew office-view access

- Grant lives on `crews.access_grants` jsonb (`features` schedule/dispatch/jobs/properties, property/job scope `all|selected` + id lists). Empty features = null = no access.
- **Rule:** the portal link never carries permissions. `GET /portal/:token/office-view` re-reads the grant and recomputes scope on every request; jobs are the intersection of property scope AND job scope, and schedule/dispatch rows must be a subset of scoped job ids.
- **Rule:** office-view payloads are read-only operational data only — never money (rates, margins, invoices), client contacts, or general office calendar events (only job-linked events in scope).
- Write path (`PUT /crews/:id/access`) filters submitted ids to existing records and rejects `selected` scopes with empty id lists.
- Portal shows an "Office" tab only when `enabled`, with a human `accessSummary` line built server-side.

**Why:** portals are public token links with no auth; any leak here goes straight to subcontractors.
**How to apply:** when adding fields to office-view or new grantable features, keep the server-side scoping/no-money rules and extend the feature enum in schema + grant editor together.
