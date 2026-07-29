---
name: HALO unit status map + Property Hub CMS
description: Client dashboard unit box map with live red/yellow/green statuses, AI map extraction, and the client CMS (Property Hub) shared client/office.
---

- Unit-map/hub features are dual-surface: every endpoint exists on both the client-token mount and the office mount sharing one handler; adding an endpoint to only one surface silently 404s the other.
- Unit boxes store FRACTIONAL x/y/w/h (0..1) of the canvas; UIs render percent-positioned. Never store pixels.
- Status matching key is `normUnit(label)` (lowercase, strips unit/apt/#/punctuation) applied to jobs.unitNo, work_requests.unitNo, invoice line-item unitNo, and job_summaries.unitNumber. Invoices map to units via their job's unitNo plus their line items.
- **Why:** free-text unit labels ("Unit 204", "#204", "204") must land on the same box or statuses silently show green.
- AI map extraction (completeJsonWithImage) is best-effort and must never fail the image upload — client always has grid-generate + manual editor fallback. Dedupe extracted labels against existing via normUnit.
- Client feature keys: map = existing `unit_map`, CMS = `hub`; guests get read-only view (both keys in GUEST_VIEWER + guest role defaults); writes gated by requireWriter.
- Storage request-url body is `{name, size, contentType}` → `{uploadURL, objectPath}` (capital URL); objectPath must start with `/objects/`, served at absolute `/api/storage${path}`.
