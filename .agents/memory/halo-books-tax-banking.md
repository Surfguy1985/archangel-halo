---
name: HALO Books — AP bills, sales tax, bank reconcile
description: Rules for vendor bills (AP 2000), tax-inclusive sales tax (2100), and Plaid bank-to-ledger import/reconcile
---
- Vendor bills: expense with paymentStatus=open posts CR 2000 Accounts Payable; paying (POST /expenses/:id/pay or voice pay_bill) posts DR 2000 / CR 1000. Non-bill expenses credit cash directly.
- Sales tax is TAX-INCLUSIVE: when invoice taxAmount omitted, it's derived from business_settings.taxRatePct out of the total (net = total/(1+rate)). Explicit taxAmount wins. Invoice ledger split: CR 4000 net + CR 2100 tax.
- **Every invoice write path must recompute taxAmount** (create AND patch) then resync ledger — stale taxAmount distorts 4000/2100 and the tax report.
- Bank import dedup: outflows keyed by expenses.source = `bank:<txnId>`; inflows by journal memo containing txn id. Import handler is serialized per transactionId via withRefLock — keep this or concurrent imports duplicate.
- Plaid transaction fetch is paginated with a 2000-row cap; response carries `truncated` flag surfaced in the desktop Bank Match UI. Don't silently cap.
- Tax report maps expense category account codes to Schedule C lines; 2100 credits = tax collected.
**Why:** double-entry books stay consistent only if every mutation path posts/resyncs; no DB constraints enforce it.
