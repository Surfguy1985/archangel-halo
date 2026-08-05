---
name: HALO job work checklist
description: Per-job line-item checklist with crew assignment, crew-scoped completion, and auto-move to Done
---

Job line items are a work checklist, not a price display: each item can be assigned to one crew (`assignedCrewId`) and completed (`completedAt`, `completedByCrewId`).

**Rules:**
- Portal completion endpoint enforces ownership server-side: only the crew with `assignedCrewId === crew.id` may toggle an item (portal tokens carry no permissions).
- When the LAST open item on a job completes (from portal OR office override via PATCH /job-line-items), the job auto-moves with a guarded UPDATE `boardStatus='completed'` only from `active|filled|reopened`. Any new completion path must reuse this rule.
- Job board cards emit `lineItems` (with assignedCrewName + completion); `priceItems` stays only for the change-order upcharge picker.
- Crew portal shows the checklist on the schedule tab (WorkChecklistSection): all items visible, only "mine" tappable.

**Why:** office wanted the in-progress card to reflect actual job scope and flip to Done automatically as crews check off their own work.
