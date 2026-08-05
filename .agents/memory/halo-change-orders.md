---
name: HALO change orders
description: Client change-order flow on unit site map — guarded flips, rail derivation, banner surfaces
---

# HALO change orders

- A pending change order is signalled ONLY by `jobs.change_order_status = "requested"` — boardStatus is never touched by the request. Rails derive the Requested placement from the flag: server `vendorRail()` in clientCms.ts, client-side `jobRail()` in desktop JobBoard.tsx, and clientBoard.ts (lane forced to "requested", winning over client lane overrides). All three must stay in sync.
- **Why:** because boardStatus keeps evolving naturally while the CO sits in review, reopen just clears the CO fields and the card lands back on whatever its CURRENT board status says — no stale-restore risk. `change_order_prev_board_status` exists but is intentionally unused for restore.
- Both CO flips are guarded conditional UPDATEs: request guards `isNull(changeOrderStatus)` (409 duplicate), reopen guards `eq(changeOrderStatus,'requested')` (409 none pending).
- The unit-map CO endpoint is dual-mounted (client token + /admin/accounts) like all unit-map routes; client mount is writer-gated. Server rejects any jobId that isn't the unit's CURRENT live card (re-derives via unitCardsByKey) — stale/older jobs 409.
- Reopen keeps the same crew (clears crewVacatedAt only when a crew is set) and alerts the crew via crew_messages.
- Banner surfaces when adding renderers: board-ui RailTile (card.changeOrder), desktop JobBoard tile + sheet CO panel, site-map unit box "CO" strip. Site-map unit boxes are colored by `unit.card.rail` (vendor rail tones), falling back to legacy status colors when no live job.
