---
name: HALO job timeline (JobFunnel)
description: Desktop job pipeline stepper — crew assignment sync, live events feed, OCR invoice, recap close-out
---

- Desktop JobFunnel (property detail) drives the 5-stage pipeline: crew → work → invoice → crew pay → close out, with an always-visible pre-close checklist chip row (crew/work/invoice/crew-pay).
- GET /jobs/:id/events aggregates offer acceptance, crew check-ins/outs, photos by phase, "Crew note" activities, and completedAt into a newest-first feed; any NEW field-activity source must be added there too or the "Live work updates" panel misses it.
- Manual crew assignment via PATCH /jobs/:id with a non-null crewLeaderId also (in one transaction) marks boardStatus "filled", withdraws pending broadcasts, withdraws OTHER crews' approved broadcasts, and re-points schedules rows to the new crew — so the old crew's portal loses access on reassignment. This sync lives server-side so voice/other clients get it free.
- **Why:** job board and manual assignment must never disagree; the portal accept flow treats boardStatus "filled" as taken.
- JobFunnel polls getJob every 5s while unfilled using a refetchInterval callback gated on the FRESH polled data (not the prop), so polling stops immediately on accept.
- Invoice OCR reuses /ingest/scan (base64 image) just to prefill the amount; the file itself is uploaded via uploadReceiptFile as attachmentPath.
- Close-out "send photo report" chains draftJobRecap → sendJobRecap → closeOutJob; sendJobRecap 422s when the property has no contact email — always keep the "close without report" fallback.
