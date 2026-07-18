---
name: HALO double-entry ledger
description: How the Books accounting engine posts, syncs, and guards against double-posting
---

- Ledger lives in ledger_accounts / journal_entries / journal_lines; entry_no (JE-####) has a DB unique constraint; numbering serialized via pg_advisory_xact_lock inside the postJournal transaction.
- Every invoice/expense/job mutation (REST *and* voice) must call the matching syncXLedger helper; the voice /voice/confirm handlers are a separate code path from money.ts/jobs.ts and are easy to miss.
- Sync helpers + rebuildLedger are serialized by an in-process keyed mutex (withRefLock) — single-server assumption; remove+repost per ref is the idempotency model. **Why:** concurrent rebuilds once quintupled the books.
- Posting rules: non-draft invoice DR 1100/CR 4000; paid (paidAt set) DR 1000/CR 1100 as refType invoice_payment; expense DR mapped 5xxx/CR 1000; completed job w/ crewRate DR 5000/CR 1000. Rebuild wipes only source="system"; manual/voice entries survive.
- Balance sheet adds synthetic 3900 Retained Earnings so assets always equal liabilities+equity.
- drizzle-kit push crashes on adding a unique constraint to a populated table; add it manually via ALTER TABLE with drizzle's expected name (<table>_<col>_unique), then push shows no diff.

**How to apply:** any new money-affecting entity or mutation path needs a sync helper call, inclusion in rebuildLedgerInner, and the settings reset delete list.
