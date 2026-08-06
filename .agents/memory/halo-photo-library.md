---
name: HALO office photo library
description: Board photo browser (GET /photo-library) + assign-to-card endpoint rules
---
- Job Board photos are `activities` rows (entityType job, kind photo_before/photo_after, storagePath); crew portal vault is `crew_photos`. The office photo library merges both, dedupes by storagePath, labels columns by property via the photo's job.
- **POST /jobs/:id/photos/assign must only accept storagePaths that exist in the library set (crew_photos OR photo activities).** Client selection is not an authorization boundary — an unvalidated path would let any private object (checks, docs) be laundered onto a card and served via /api/storage. Reject unknown paths with 400.
- Assigning copies photos onto the job as new photo activities (source untouched); re-assign is a dedupe no-op.
