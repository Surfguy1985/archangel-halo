---
name: HALO expense approvals & receipts
description: Approval-gated expenses, receipt AI extraction, and where approval status must be enforced
---

Expenses have `approvalStatus` (approved default, pending when `businessSettings.expenseApprovalThreshold` > 0 and amount >= threshold, rejected).

**Rule:** any code path that aggregates or posts expenses must include ONLY `approvalStatus === "approved"` — that means the per-expense ledger sync AND the full ledger rebuild (`postExpenseEntry` guards it), job finance recompute, and business report. Filtering out only "rejected" is a bug: pending must also stay off the books.

**Why:** a code review caught rebuild + job finance counting pending expenses after the sync path was gated, silently distorting margins/books.

**How to apply:** when adding new expense consumers (reports, dashboards, exports meant to reflect the books), filter to approved. UI totals also exclude rejected.

Receipt/bill scanning: `POST /ingest/receipt` takes base64 image + kind (receipt|bill), returns extracted fields + optional `bankMatch` (Plaid ±4 days, amount within $0.02). Client uploads the photo via presigned URL (`/api/storage/uploads/request-url` → PUT) and stores `receiptPath`; display link is `/api/storage${receiptPath}`. `ExpenseInput.spentOn` is YYYY-MM-DD, anchored server-side at local noon.
