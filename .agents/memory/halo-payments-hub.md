---
name: HALO Payments Hub
description: Payment requests, public /pay page, crew bank connect, and crew payouts — rails stubbed for Cybrid.
---
- Cybrid rails are STUBBED at three marked spots: public pay charge, crew ACH payout, and portal bank verification (instant-verify). SMS send is also a stub (link logged; office copies it).
- Public pay flip and request-return revert are transactional with guarded status transitions (409 on repeat); return only reverts invoices whose payments carry the request's confirmation number.
- Payout create validates job.crewLeaderId === crew, paid-request membership when paymentRequestId given, dedupes on (crew, job, status=paid), and requires a verified crew bank (409 otherwise).
- payerInfo persistence is sanitized server-side: CVV never stored, card/account numbers masked to last4. Bank account rows store raw routing/account (needed for real ACH later) — encrypt/tokenize when rails land.
- Request job amounts come from the latest "sent" invoice (amount+tax) else job line items; request pays those exact invoices on public payment (payments insert + syncInvoiceLedger + recomputeJobFinancials).
- Public /pay/:token page lives in the mobile (root) app; desktop copy-link must use origin without /desktop prefix.
