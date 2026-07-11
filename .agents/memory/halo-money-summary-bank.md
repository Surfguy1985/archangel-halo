---
name: HALO money summary bank data
description: Money summary cash metrics come from Plaid when a bank is connected; receivables stay invoice-based.
---

Rule: when a Plaid bank is connected, /money/summary derives MTD Revenue, Collected MTD, Spent MTD, and margin from real bank transactions (Plaid sign convention: negative amount = money in). Margin = (inflows − outflows) / inflows ("Cash Margin"). Landing (Owed), At Risk, and aging always stay invoice-based — bank data cannot know receivables.

**Why:** demo/job-based numbers were inaccurate; the user wants figures matching actual bank activity. Internal "TRANSFER OUT" rows count as outflows deliberately (owner moves cash out to pay crews).

**How to apply:** bank cashflow comes from the shared Plaid client helper in api-server (5-min in-memory cache, invalidated on bank connect/disconnect). If bank fetch fails or no bank is linked, the summary silently falls back to invoice/job math with `bankConnected: false`. Any new money widgets should branch on `bankConnected` the same way the desktop Money cards do.
