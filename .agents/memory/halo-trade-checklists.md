---
name: HALO trade checklists
description: Carpet/make_ready/painting checklists in the crew portal — DB table, routes, agreement gate, and detection logic.
---

# HALO Trade-Specific Job Checklists

## Rule
Three trade-specific checklists (carpet, make_ready, painting) live in the `job_checklists` DB table.
A crew must tap **"I Agree"** (recorded server-side in `agreed_at`) before any item can be checked.
The agreement acknowledges that incomplete work may pro-rata or delay their pay.

## Why
Archangel requires explicit crew acknowledgement of consequences before they start work on trade-specific checklists (vs. cleaning, which has no agreement gate).

## Detection priority
In `CrewPortalFlow.tsx` and `lib/jobChecklists.ts`:
1. **carpet** — job category/description contains "carpet"
2. **painting** — contains "paint"
3. **make_ready** — contains "make ready", "make-ready", "make_ready", "punch", or "unit punch"
4. **cleaning** (separate, existing) — contains "clean" or "turn", but NOT the above trade keywords

`isCleaningJob()` was updated to exclude carpet/paint/make-ready words so there's no overlap.

## How to apply
- New job types that need a checklist: add detection to `getJobChecklistType()` in both `CrewPortalFlow.tsx` (inline) and `lib/jobChecklists.ts`.
- New checklist content: add a new `JobChecklistType` literal, a section array, and entries in `JOB_CHECKLISTS`, `JOB_CHECKLIST_ITEMS_FLAT`, `JOB_CHECKLIST_PDF`, `JOB_CHECKLIST_LABEL`.
- Portal routes follow the pattern at the bottom of `portal.ts` — GET, /agree, /toggle, /sign-off.

## Key identifiers
- DB table: `job_checklists` (unique on job_id + crew_id + checklist_type)
- State map key in UI: `${jobId}:${checklistType}`
- Card kind in `ActiveCard`: `"job-checklist"` — occupies the same step-dot position as `"cleaning-checklist"`
- Server routes: `/portal/:token/jobs/:jobId/checklist/:type/{agree,toggle,sign-off}`
- PDF docs served at: `/api/docs/archangel-{carpet-cleaning,make-ready,painting}-checklist.pdf`
