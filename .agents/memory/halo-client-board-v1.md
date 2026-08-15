---
name: HALO Client Board v1 (CAF portfolio)
description: Rules for the portfolio-scale client board — event-sourced turn clock, client-owned stages, integer cents, namespaced tables, and the flag/dark-launch discipline.
---

# Client Board v1 (CAF Edition)

A layer **above** the per-property kanban and **below** the card (the unit turn record). Additive: it does not replace the office client board, and the existing kanban routes stay reachable.

## Invariants — the easy path is wrong in each of these

1. **The turn clock is event-sourced.** Stage events are append-only; there is never a mutable `days_vacant` column to "just update". Dashboards read the metrics materialized view.
   **Why:** the client argues about dates. A derived clock can be recomputed and defended; a mutated counter cannot.
2. **Client-owned stages are first-class.** Approval stages belong to the client, and the UI must show that ownership.
   **Why:** most vacancy days lost to client-side approval get blamed on us. Ownership is the whole point of showing the ring.
3. **All money is bigint cents.** Never JS `number` arithmetic.
4. **Day-boundary math uses the property's IANA timezone**, never the server's or the browser's. Nightly jobs run once per property timezone, not once globally.
5. **Tables are `client_*`-namespaced.** Office already owns `invoices`, `bids`, `notifications`, `price_items`, and the CMS owns `property_units` — several of those names were already taken and collided.
6. **`properties` is extended, never cloned.** Operational units are their own table.
7. **One formula.** Metrics compute goes through the shared turn-metrics function, and the SQL refresh must match it. Do not invent a second days/hours/cents formula — a second one always drifts.
8. **Rework is a real state.** The stage graph allows returning to in-progress only after QC; ready is terminal.
9. **`orgId` comes from the session on every engine call**, never from a client-supplied parameter.

## Operational rules

- Schema is applied by a boot-time ensure function, and the SQL migration file is *rendered* from the DDL module. If you hand-edit one, the other silently drifts — a checked-in guard test compares them. Never `drizzle-kit push --force`.
- The outbox is written in the same transaction as the stage events and claimed with `FOR UPDATE SKIP LOCKED`.
- `source=app` events stamp `occurred_at = received_at`; only imports/system may pass a historical `occurred_at`, and they must record the clock skew.
- Stall detection lives inside the SQL refresh (p75 for that stage at that property). The engine never updates the view.
- Segments dark-launch behind flags and 404 when off. Turning a segment on is a deliberate flag flip, not a side effect of deploying it.
- Polar/ring math is duplicated for the browser on purpose — the DB package must not be imported client-side.
- Append-only guards block UPDATE/DELETE on events, the audit log, and invoice line snapshots. Settings reset and seed teardown must set the bypass config **inside the same transaction**.
- Reset wipes the `client_*` operational tables but preserves stage ownership and the flags row.
