---
name: HALO Walk approve → client board
description: Approve button on walk review pushes created jobs + photos to the client board; trust model decision.
---

- `POST /walks/:id/approve` (walk-passcode namespace) pushes one `kind:"photos"` client-board card per created job via `raiseClientCard` (`sourceType:"walk_job"`, `sourceId:jobId` → idempotent re-approve refreshes, never duplicates).
- Walk photos live on `walk_captures`, NOT `crew_photos` — `buildPhotosModule` can't be reused; the photos module is built inline from capture `storagePath`s (`/api/storage` prefix).
- **Why walk auth is enough:** the walk passcode is a trusted staff field credential that already creates jobs on any property at walk completion, and those jobs already project onto that property's client board. Approve adds no new cross-property capability, so a stricter office gate was deliberately not added (architect flagged it; decision recorded here).
- **How to apply:** any future walk-app write that reaches CLIENT-visible surfaces should keep the same job↔walk property ownership check this route does, and stay idempotent by source dedupe.
