---
name: HALO job funnel close-out
description: Desktop PropertyDetail guided funnel and the close-out endpoint's safeguard contract
---

Desktop PropertyDetail renders a 5-stage per-job funnel (Crew → Work → Invoice → Crew pay → Close out) via `JobFunnel.tsx`.

**Rules:**
- `POST /jobs/:id/close-out` is the funnel's final gate: requires crew assigned, status complete, a paid invoice for the job, and a completed crew_payments row for the crew leader. Blocks with 409 `{error, missing[]}` — the UI renders `missing[]` as the red warning list (read from `err.data`).
- On success it sets clearedAt, logs activity, recomputes job financials + labor ledger, and sends `sendCrewThankYouEmail` (only if crews.email is set; response `emailSent` reflects this).
- Legacy `POST /jobs/:id/clear` intentionally remains as a manual override on JobDetail pages (mobile+desktop) with only the status==complete check — do not "fix" it to enforce funnel rules without user sign-off.
- Property detail jobs carry funnel fields (`nextVisitOn` from schedules, `crewPaymentStatus`/`crewPaidAt` from crew_payments) computed only in GET /properties/:id.
- Invoices support `attachmentPath` (object storage path, uploaded via /storage/uploads/request-url; view at `/api/storage${path}`).

**Why:** close-out is the single place that guarantees books/margins are final before a job leaves the board; scattering clears elsewhere breaks that guarantee.
