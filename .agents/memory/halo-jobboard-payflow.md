---
name: HALO job board pay pipeline
description: Billing/crew-pay flow from Done card through client payment choice to cleared history
---
Flow: quality-check pass (or manual verify) → boardStatus completed → office "Create Invoice" (Done rail) → invoice CREATE raises client card **with module via buildInvoiceModule** (raise without module = dead card, no actions/flash) → client picks route via ACTIONS `invoice.pay_by_check`/`invoice.pay_by_platform` (sets invoices.payment_choice*, job → billing) → office PaymentFlowDialog records payment then per-crew Pay → all paid → pay_alert → per-crew Clear → all cleared → boardStatus removed + jobs.cleared_at.

Rules:
- **Money-safety**: /jobs/:id/crew-pay and /crew-pay/clear are transactional with `.for("update")` on the job row; crew pay is server-gated on the newest linked invoice being paid. Ledger sync + recomputeJobFinancials run AFTER the tx commits (idempotent rebuilds).
- Crew pay = approved paid expense, category "crew labor", source `job_board_pay`; tracker jsonb jobs.crew_pay [{crewId,name,amount,paidAt,clearedAt}]. Roster = crewLeaderId + crews.leaderId team (active!==false).
- Green invoice flash lives in THREE card renderers: board-ui RailTile (rails view), board-ui AppleCard, client-dashboard kanban BoardCard — condition: module.type invoice && status!=='paid' && !paymentChoice && !clientPaidAt (`data-invoice-ready`).
- Deleting an invoice does NOT delete its pushed client card — stale cards linger and break dedupe; clean client_board_cards when removing invoices.
- Client board puppeteer tests: the guided-tour overlay swallows clicks — remove its fixed container before interacting.
- Client rails put unpaid invoice cards in the Billing rail on read regardless of paymentChoice (lane comes from rail mapping, not choice).
