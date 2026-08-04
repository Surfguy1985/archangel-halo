---
name: HALO Wings Program profit share
description: Quarterly 12% profit-share explainer + live Wings calc in every crew portal wings tab.
---

- Crew portal wings tab (both apps) shows the printed Wings Program sheet: 12% quarterly pot, `Wings = (role base + founder bonus) × tenure mult × score mult`. Server computes the `program` block in GET /portal/:token/wings; UI is `WingsProgram.tsx`, duplicated in halo + halo-desktop (keep copies in sync).
- Role bases: crew 10, lead 15, foreman 25, superintendent 35; founder bonus +15 when wing_members.founderStatus ≠ NONE. Source of role/tenure: `crews.role` + `crews.hire_date` (office Add/Edit crew forms + CrewDetail contract carry them — any new crew read model must too, or edit forms clobber saved values).
- Eligibility math on EXACT years (round only for display) or a 364-day tenure rounds to 1.0 and pays early. Missing hire date = ×1.00 + `start_date_missing` blocker note, never zeroed — owner wants it simple and fair.
- Score bands: 95+ ×1.3, 90–94 ×1.15, 80–89 ×1.0 (full share), 70–79 ×0.8, 60–69 ×0.5, <60 ×0.
- Crews auto-import into the program: the wings sweep/list endpoints enroll every active crew as ACTIVE (AUTO_IMPORT) unless `crews.wings_excluded` is true. Exclusion must hold everywhere: flipping it true also deletes the wing_members row, eligibility filters it, and the portal wings endpoint 404s (portal shows its "not in program" fallback). Bryce Back is excluded by owner decision.
- Both crew portals accept `?tab=` deep links (e.g. ?tab=wings); the pending-offers auto-pull effect must skip when a tab param is present or deep links silently land on Offers.
