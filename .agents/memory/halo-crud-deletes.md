---
name: HALO CRUD deletes & error handling
description: How edit/delete flows must handle the no-FK schema, transactions, dependency guards, and client error shape.
---

# Deletes and edit flows in HALO

## No DB-level foreign keys
The Drizzle schema uses plain `uuid` columns for relations (no `.references()`), so
deletes never raise FK errors and nothing cascades automatically.

**How to apply:** every delete handler must (1) run inside `db.transaction(async (tx) => …)`,
(2) re-run its dependency guards *inside* that tx before deleting, and (3) manually delete
child rows. Return a `{ status, error? }` object from the tx and translate it to the HTTP
response outside — do not call `res` inside the transaction.

- Property delete: block (409) if any jobs, invoices, or expenses reference it (money records
  must stay intact). Cascade-delete agreements, contacts, price_items, then the property.
- Job delete: cascade-delete schedules, then the job.
- Crew delete: block (409) if the crew leads any jobs; otherwise delete.

**Why:** without FKs a check-then-delete across separate statements is race-prone and can
orphan financial rows (invoices/expenses point at a deleted property → null property name in
money views).

## Client error shape
The generated api client throws `ApiError` with the server's JSON body on `err.data`, NOT on
`err` top-level. To surface a server 409 message in the UI read
`(err as { data?: { error?: string } })?.data?.error`, with a friendly string fallback.

**Why:** reading `err.error` silently loses every guard message and users only ever see the
generic fallback copy.
