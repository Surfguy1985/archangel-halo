---
name: HALO live job tracker & evidence
description: Crew Live Link — GPS check-ins, before/after photos with SHA-256, public /track/:token page, job report PDF
---

- Jobs carry a stable `trackerToken` (one per job, reused). Creation is atomic first-wins: conditional UPDATE `WHERE tracker_token IS NULL` + re-read on conflict. Never blindly overwrite it or existing shared links die.
- Public tracker page lives in the MOBILE app (halo, mounted at `/`) at `/track/:token`; desktop office UI links to it via `window.location.origin/track/...` — that's correct since mobile owns root.
- Crew photo phases are free strings "before"/"after"/null. UI pairs before/after by index within a job group; anything else falls back to a plain grid. Keep filtering with `!== "before" && !== "after"` so nulls show.
- Photo SHA-256/sizeBytes are computed server-side at upload (warn-and-continue if storage read fails) — tamper-evidence claims in UI/PDF depend on this staying server-side.
- Crew check-ins live in `crew_checkins` with optional jobId + kind (checkin/checkout) + GPS; checkout notes double as public "work notes". Job delete must cascade crew_checkins (no FKs).
- Job report PDF: GET /jobs/:id/report streams pdf-lib output built by gatherJobReport/buildJobReportPdf; office links must be absolute `/api/...`.
- Portal first-visit agreement modal blocks until POST /portal/:token/agreement; idempotent, keeps original acceptance timestamp.
