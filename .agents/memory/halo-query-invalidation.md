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

# Action buttons with no visible state change need a toast
Any mutation button whose success does NOT visibly change the UI (e.g. invoice "Send reminder" leaves status `past_due`, so the button stays put) MUST fire a `useToast()` on success (and on error). Without it the action looks broken even though it returns 200 — this is a recurring "button not working" report. Buttons that flip status and disappear (Send draft→sent, Mark paid) are self-evidencing and don't strictly need one, but a toast is still nicer. Toast API: `useToast` from `@/hooks/use-toast`, `toast({ title, description, variant: "destructive" })`.
