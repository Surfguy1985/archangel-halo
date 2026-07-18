---
name: HALO bank transaction analysis
description: Smart breakdown of Plaid transactions into paid invoices / crew payments / expenses / other
---
- GET /plaid/analysis classifies 30d Plaid txns: inflows amount-matched to sent/overdue/paid invoices; outflows via crew token match → supply-vendor keywords → one AI batch (fallback = Uncategorized expense).
- Server cache keyed by `${plaidItemId}:${days}` with in-flight dedupe per key; cleared on bank connect/disconnect via invalidateBankAnalysisCache().
- **Why:** a global unkeyed cache/in-flight promise served wrong-window or stale-bank results; also `zod.coerce.boolean()` treats "false" as true, so `refresh` is parsed manually as `=== "true"`.
- **How to apply:** any new cached Plaid-derived endpoint must key by item+params and invalidate on exchange/disconnect; never use coerce.boolean for query flags.
- UI Re-analyze is one-shot: forced `refresh=true` query seeds the normal query key then resets, so subsequent loads use server cache again. Same component pattern in halo (collapsible) and halo-desktop (3-column grid).
