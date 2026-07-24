---
name: HALO crew invoice job linking
description: Portal-submitted crew invoices can link to a job; ownership check and label propagation rules.
---

Crew portal invoices accept an optional jobId. Rules:

- **Server must validate ownership**: the referenced job's crewLeaderId must equal the portal crew's id; otherwise 400. propertyId is derived server-side from the job — never trusted from the client.
- **Why:** no FKs/auth in this app; an unchecked jobId would silently attach a crew's invoice to another crew's job/property.
- **How to apply:** any new endpoint that writes crew_invoices (submit, resubmit, future voice/admin paths) must go through the same resolve-link helper and store jobId+propertyId together, and every crew-invoice read model (portal list, admin crew invoices) must attach jobLabel via jobLabelMap.
- Form state gotcha: the portal invoice form's jobId state must be reset in ALL three places — success, cancel-edit, and startFix (restore from inv.jobId) — or a stale link carries into the next draft.
