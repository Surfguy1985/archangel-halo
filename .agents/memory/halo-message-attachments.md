---
name: HALO crew message attachments
description: crew_messages supports file attachments; every message-thread UI must render them
---
crew_messages rows can carry `attachmentName`/`attachmentPath` (object-storage path, served at `/api/storage{path}`). Invoice submit/resubmit from the portal optionally deliver a client-generated jsPDF (uploaded via presigned flow, passed as `pdfStoragePath`) as a message attachment plus a `from_crew` crew_documents row, inside the same transaction.

**Why:** The invoice PDF is generated client-side (jsPDF, like the W-9 helper) — the server never renders PDFs. If a new message-rendering surface ignores attachment fields, delivered invoices silently disappear from that view.

**How to apply:** Any new UI that renders the crew message thread (portal MessagesTab, admin CrewDetail in halo AND halo-desktop) must render the attachment download link when `attachmentPath` is set. Sending an invoice must invalidate messages + documents + invoices query caches.
