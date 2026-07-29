---
name: HALO Payments Hub
description: Payment requests, public /pay page, crew bank connect, and crew payouts — rails stubbed for Cybrid.
---
- Cybrid rails are STUBBED at three marked spots: public pay charge, crew ACH payout, and portal bank verification (instant-verify). SMS send is also a stub (link logged; office copies it).
- Public pay flip and request-return revert are transactional with guarded status transitions (409 on repeat); return only reverts invoices whose payments carry the request's confirmation number.
- Payout create validates job.crewLeaderId === crew, paid-request membership when paymentRequestId given, dedupes on (crew, job, status=paid), and requires a verified crew bank (409 otherwise).
- payerInfo persistence is sanitized server-side: CVV never stored, card/account numbers masked to last4. Bank account rows store raw routing/account (needed for real ACH later) — encrypt/tokenize when rails land.
- Request job amounts come from office per-job overrides (jobAmounts) else the latest "sent" invoice (amount+tax) else job line items; requests also support custom type-in line items stored as payment_request_jobs rows with NULL job_id — every consumer (pay/return recompute, payout distribution) must skip null-jobId lines, and zero-total requests are rejected server-side.
- Public /pay/:token page lives in the mobile (root) app; desktop copy-link must use origin without /desktop prefix.
- Public pay methods include "check" (mail a check): GET /pay/:token exposes mailingAddress from business settings (companyName/attn/street/city); check submit flips paid instantly like every stubbed rail.
- Double-pay guard is DB-level: partial unique index crew_payouts_paid_crew_job_uq on (crew_id, job_id) WHERE status='paid'. Both payout endpoints must catch 23505 → 409; batch (/pay-hub/payouts/batch) is one transaction, all-or-none.
- /pay-hub/payout-queue = completed jobs w/ crewLeaderId minus paid payouts, grouped per crew with bankVerified + crewRate-based suggested amounts; batch pay records each crew's amount against their oldest queued job.

**Invoice lines + attachments on requests:** payment requests can bill specific invoices (invoiceIds) — each becomes its own line and its PDF auto-attaches (attachments jsonb, ready-to-open /api URLs: /api/invoices/:id/pdf or /api/storage/objects/...). Server rejects invoices not on a selected job and cancelled/paid invoices; the paid-settlement loop must skip cancelled invoices. Desktop dialog always sends explicit jobAmounts overrides so UI total === server total.
