---
name: HALO Cleaning Checklist
description: Archangel Turn Cleaning checklist — crew portal integration, DB table, API routes, PDF report
---

## Rule
Cleaning jobs (category/description includes "clean", "turn", "make ready") get an extra
`cleaning-checklist` card in the crew portal flow, inserted between the work checklist and
after-photos steps. Sign-off is persisted in `cleaning_checklists` table.

## How to apply
- Detection: `isCleaningJob(category, description)` in `lib/cleaningChecklist.ts`; same fn
  in `CrewPortalFlow.tsx` as inline copy (PortalJob type is generated, no category field).
- Template constant: `CLEANING_CHECKLIST` in `artifacts/api-server/src/lib/cleaningChecklist.ts`
  (31 items, 4 sections — Kitchen, Bathrooms, Interior, Exterior).
- DB table: `cleaning_checklists` — unique on (job_id, crew_id); `checkedItems` jsonb is
  `[{id, checkedAt, checkedBy}]` for checked items only.
- Portal routes (all in `portal.ts`):
  - GET  `/portal/:token/jobs/:jobId/cleaning-checklist` — fetch or auto-create row
  - POST `/portal/:token/jobs/:jobId/cleaning-checklist/toggle` — check/uncheck (limits.walkWrite)
  - POST `/portal/:token/jobs/:jobId/cleaning-checklist/sign-off` — lock + notify office
- CrewPortalFlow: `cleanChecklists` state, `useEffect` loads after `jobs` is declared;
  `job.category`/`job.description` require `(job as unknown as {…})` cast (not in PortalJob type).
- `deriveCard` accepts `cleanSignedOff: Record<string, boolean>` 6th param (default `{}`).
- PDF: `buildSummaryPdf` accepts optional `cleaningChecklist` field; rendered after the standard
  checklist. Fetched in `jobSummaries.ts` PDF route by joining `cleaning_checklists` (all crew
  rows merged — union of checked IDs, latest sign-off).
- Source PDF: `artifacts/api-server/public/archangel-turn-cleaning-checklist.pdf`, served at
  `/api/docs/archangel-turn-cleaning-checklist.pdf` via `express.static("public")`.

**Why:**
The PDF was uploaded by the office and has 31 detailed cleaning steps across 4 sections.
The crew checks them off in the portal; the sign-off appears in the job summary PDF sent to the property.
