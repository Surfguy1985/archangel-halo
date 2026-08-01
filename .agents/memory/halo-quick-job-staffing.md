---
name: HALO quick job & staffing
description: Crew-vacancy flag contract and quick create-and-staff conventions
---

# Quick job & staffing

## crewVacatedAt contract (the important rule)
Jobs carry a `crewVacatedAt` timestamp set when a crew is pulled off. **Every server path that (re)assigns `crewLeaderId` must also clear `crewVacatedAt` in the same update** — including voice-command scheduling, not just the obvious REST routes. Today's feed alerts on `crewVacatedAt && !crewLeaderId`; a missed clear produces phantom "Job X lost its crew" alerts.

**Why:** no FKs/triggers — the flag is maintained manually across routes; a code review caught the voice path missing it once already.
**How to apply:** when adding any new assignment path, clear the flag atomically; extend the integration regression test (`crewVacancy.integration.test.ts`, gated on `HALO_E2E_BASE` pointing at a running server) with the new path.

## Other durable notes
- Jobs have no price column — a quick-quoted price is stored as a custom line item (priceItemId null), not a new schema field.
- Pull-off-a-job uses a guarded UPDATE (`where crewLeaderId = crewId`) so concurrent pulls can't double-claim; 409 if the crew already moved.
- Generated react-query hooks called with an options object need an explicit `query.queryKey` or typecheck fails.
