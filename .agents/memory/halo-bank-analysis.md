---
name: HALO bank transaction analysis
description: Smart breakdown of Plaid transactions into paid invoices / crew payments / expenses / other
---
- GET /plaid/analysis classifies 30d Plaid txns: inflows amount-matched to sent/overdue/paid invoices; outflows via crew token match → supply-vendor keywords → one AI batch (fallback = Uncategorized expense).
- Server cache keyed by `${plaidItemId}:${days}` with in-flight dedupe per key; cleared on bank connect/disconnect via invalidateBankAnalysisCache().
- **Why:** a global unkeyed cache/in-flight promise served wrong-window or stale-bank results; also `zod.coerce.boolean()` treats "false" as true, so `refresh` is parsed manually as `=== "true"`.
- **How to apply:** any new cached Plaid-derived endpoint must key by item+params and invalidate on exchange/disconnect; never use coerce.boolean for query flags.
- UI Re-analyze is one-shot: forced `refresh=true` query seeds the normal query key then resets, so subsequent loads use server cache again. Same component pattern in halo (collapsible) and halo-desktop (3-column grid).
- POST /plaid/analysis/apply copies analyzed items into real records: expenses (dedupe on source=`bank:txnId`), crew payments (crew matched or auto-created from personName; dedupe via note tag), invoices marked paid (payment+status in one transaction + recompute + ledger sync).
- **Why:** dedupe is read-then-insert with no DB unique constraints (no-FK convention), so apply runs are serialized through an in-process promise chain; concurrent applies would double-insert without it.
- **How to apply:** any new "import into books" endpoint must reuse this pattern — serialize, dedupe by a bank:txnId tag, and call the ledger/job-finance syncs like the manual routes do.
- POST /plaid/analysis/categorize (tap-to-edit rows): validates crew/invoice FIRST, imports, and only then commits the bucket move — loadAnalysis returns the cached object by reference, so any mutation before an early-return error permanently corrupts the cache. Wrap id lookups in try/catch (non-UUID input otherwise 500s). Bucket moves live only in the cache; they don't survive a cache rebuild (created records do).
