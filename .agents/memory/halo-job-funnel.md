---
name: HALO job funnel close-out
description: Desktop PropertyDetail guided funnel and the close-out endpoint's safeguard contract
---

Desktop PropertyDetail renders a 5-stage per-job funnel (Crew → Work → Invoice → Crew pay → Close out) via `JobFunnel.tsx`.

**Rules:**
- `POST /jobs/:id/close-out` is the funnel's final gate: requires crew assigned, status complete, a paid invoice for the job, and a completed crew_payments row for the crew leader. Blocks with 409 `{error, missing[]}` — the UI renders `missing[]` as the red warning list (read from `err.data`).
- On success it sets clearedAt, logs activity, recomputes job financials + labor ledger, and sends `sendCrewThankYouEmail` (only if crews.email is set; response `emailSent` reflects this).
- `POST /jobs/:id/clear` now enforces the SAME checklist as close-out (shared `computeCloseOutMissing`), per user-approved fix (July 2026) — the old lightweight override was a loophole. Desktop JobDetail's clear button was removed; mobile clear buttons remain but surface the 409 error inline.
- Invoice gate requires EVERY invoice on the job paid (not just one) — multi-invoice/change-order jobs can't close early.
- POST /crew-payments is idempotent per (jobId, crewId): retries reuse/upgrade the existing non-cancelled row instead of double-paying.
- Property detail jobs carry funnel fields (`nextVisitOn` from schedules, `crewPaymentStatus`/`crewPaidAt` from crew_payments) computed only in GET /properties/:id.
- Invoices support `attachmentPath` (object storage path, uploaded via /storage/uploads/request-url; view at `/api/storage${path}`).

**Why:** close-out is the single place that guarantees books/margins are final before a job leaves the board; scattering clears elsewhere breaks that guarantee.
- The job report PDF (`GET /jobs/:id/report`, jobReportPdf.ts) doubles as the close-out summary: its checklist section must mirror `computeCloseOutMissing` semantics exactly (all invoices paid; completed crew_payment for the CURRENT crewLeaderId), or the "verify before closing" report lies after crew reassignment.
