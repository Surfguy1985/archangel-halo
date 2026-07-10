---
name: HALO query invalidation on create/action sheets
description: Which query keys each HALO create/action mutation must invalidate to avoid stale UI
---

# Rule
Every create/action sheet's `onSuccess` must invalidate ALL query keys whose views the mutation affects — not just the primary list. HALO derives many views from computed/aggregate endpoints, so a single write often touches several.

**Why:** PropertyDetail renders expenses from `getGetProperty(id)`, and Today shows PO/bid blocker cards from `getGetToday()`. Invalidating only the primary list (e.g. `getListExpenses`) leaves those derived views stale until manual refetch/navigation.

**How to apply — non-obvious cross-invalidations:**
- Expense create: also `getGetMoneySummaryQueryKey()` and, when scoped to a property, `getGetPropertyQueryKey(propertyId)`.
- Invoice create / send / remind / record payment: also `getGetMoneySummaryQueryKey()`.
- Purchase order create / receive: also `getGetTodayQueryKey()` (POs surface as Today blocker cards).
- Bid create / update / nudge: also `getGetTodayQueryKey()`.
- Property-scoped contact & price item create: `getGetPropertyQueryKey(propertyId)` (the detail endpoint, NOT a separate list).
