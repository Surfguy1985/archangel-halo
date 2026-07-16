---
name: HALO portal ownership checks
description: Token portal write endpoints must validate that referenced entities belong to the crew
---
Portal (token-auth) write endpoints that accept an entity reference (e.g. jobId on photo upload) must verify the entity is assigned to that crew (jobs.crewLeaderId OR schedules.crewLeaderId) before insert.

**Why:** No DB foreign keys and no auth — without an ownership check any portal caller can tag records with arbitrary UUIDs, corrupting grouping and leaking labels across crews.

**How to apply:** Reuse the same crew-assignment query used for the portal jobs list; reject with 400 on mismatch. A crew's job list = schedules.crewLeaderId ∪ jobs.crewLeaderId, excluding cancelled.
