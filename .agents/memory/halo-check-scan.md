---
name: HALO check scan
description: Check-photo OCR payment flow — design decisions and constraints
---

- Check scan applies payment via the existing recordPayment endpoint (method:"check" + payerName/checkNumber/checkImagePath); a paid invoice is the anchor — user MUST pick property + invoice (job optional) before applying.
- **Why:** payments have no standalone entity; anchoring to an invoice keeps books/ledger/job margins consistent (syncInvoiceLedger + recomputeJobFinancials fire on the same path).
- The scan UIs require a successfully scanned photo before submit, but the server intentionally does NOT reject photo-less check payments — the manual "Record payment" flow legitimately records checks without images.
- Invoice "past_due" status is computed virtually from sent+dueAt; DB queries for open invoices should filter status "sent" (past_due rows don't exist in DB).
- Scan suggestion: amount match (+5) and payer-name tokens vs property/contact names (+2 each), suggest only when score ≥2.
