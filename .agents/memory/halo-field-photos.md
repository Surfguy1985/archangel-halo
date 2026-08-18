---
name: HALO field photo capture
description: Durable invariants for crew before/after photos — two homes, retries are not new captures, and nothing may fail after the commit.
---

# A field photo has two homes

The crew photo vault is not what the office reads. The job board tiles, the
before/after compare, the recap and the photo reel all read the **activity
feed**, so every vault write must also mirror an activity for the same photo.

**Why:** field uploads used to succeed and then appear nowhere in the office.

**How to apply:** new photo-write paths mirror too; readers that merge both
sources dedupe by storage path or every field photo counts twice.

# A retry is the same capture, never a new one

Phones re-send when a response is lost — routine on site LTE, invisible in
testing. Capture surfaces must keep the uploaded storage path (persisted with
the queue, not just in memory) and retry only the registration; re-uploading
produces a second object that nothing can later tell apart from a real second
photo. The server treats a repeated path as the same photo.

Corollary that is easy to miss: because the mirror is best-effort, **every**
path that returns an existing photo (plain retry or lost insert race) has to
re-run the mirror from the stored row. Otherwise a failed first mirror is never
repaired — the crew sees success and the office never sees the photo. Mirror
from the stored row, never from the retry's request body: the crew's dispatch
may have moved on and the photo would land on the wrong job.

# Once committed, never fail the request

After the photo row lands, no later step may turn the response into an error. A
500 there sends the crew back to retry a capture that already succeeded. If the
row insert itself fails, delete the uploaded object — nothing else references
it and nothing else cleans it up.

# Capture normalization

Browser capture downscales and re-encodes to JPEG before upload, with a
pass-through fallback: HEIC/HEIF can't be decoded outside Safari, so an
undecodable frame must upload as-is rather than fail.
