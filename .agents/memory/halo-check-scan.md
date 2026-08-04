---
name: HALO check scan
description: Check-photo OCR payment flow — design decisions and constraints
---

- Virtual check filing: GET /checks (listCheckFiles) returns every payment with method "check" OR a checkImagePath, enriched with invoice/property/job labels; "Check Files" tab in Money on mobile + desktop filters client-side. New check-recording paths need no extra wiring — anything landing in payments shows up in the files.
- Check scan applies payment via the existing recordPayment endpoint (method:"check" + payerName/checkNumber/checkImagePath); a paid invoice is the anchor — user MUST pick property + invoice (job optional) before applying.
- **Why:** payments have no standalone entity; anchoring to an invoice keeps books/ledger/job margins consistent (syncInvoiceLedger + recomputeJobFinancials fire on the same path).
- The scan UIs require a successfully scanned photo before submit, but the server intentionally does NOT reject photo-less check payments — the manual "Record payment" flow legitimately records checks without images.
- Invoice "past_due" status is computed virtually from sent+dueAt; in DB only "sent" exists (past_due rows don't exist in DB).
- Invoice pickers in the check-scan UIs show ALL invoices regardless of status (paid/draft included, labeled), and /payments accepts payments on already-paid invoices — ledger sync is idempotent (one invoice_payment journal per invoice).
- Bulk checks: picker is multi-select; ONE invoice selected → entered check amount applied (partial payments allowed); MULTIPLE selected → each invoice paid its own full amount via sequential recordPayment calls sharing the same check photo/number. Keep this split rule if reworking the flow.
- Scan suggestion considers all invoices: amount match (+5), payer-name tokens vs property/contact names (+2 each), +1 boost for status "sent" so open invoices win ties; suggest only when score ≥2.
