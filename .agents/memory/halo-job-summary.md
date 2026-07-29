---
name: HALO job summary (service recap doc)
description: Per-job fillable summary shared via public token; close-out opens the form; public payload is a redacted DTO
---

- Close out on desktop no longer clears immediately: it opens JobSummaryDialog (prefilled recap form); the clearJob mutation runs from the dialog's "Close out job" button and still surfaces the server 409 checklist.
- One job_summaries row per job (unique jobId); first save mints the stable token. Public page is /summary/:token on the root (halo) app — remember the desktop-redirect allowlist regex in halo main.tsx must include any new public route prefix.
- **Why:** the public endpoint must return the strict `JobSummaryPublicDoc` DTO (no jobId/propertyId/token/sentTo/sentAt) — an earlier version leaked delivery metadata to anyone with the link. Don't reuse the internal serializer for public routes.
- Community box view on the public page is a generic template (hasBoard always false) until the client CMS task ships; flagged checks turn the unit box red.
- Checklist prefills: categories matching /clean/i get the Archangel touch-up template; others get a "Scope of work" section from the job description.
- Photo attach uses crewPhotosForJobs then re-fetches crew_photos rows for phase/storagePath; URLs are /api/storage${path}.
