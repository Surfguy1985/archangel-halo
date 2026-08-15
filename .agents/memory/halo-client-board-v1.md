---
name: HALO Client Board v1 (CAF portfolio)
description: Portfolio-scale client board — event-sourced turns, turn engine, client-owned stages, integer cents, namespaced client_* tables
---

# Client Board v1 (CAF Edition)

Layer **above** the per-property kanban (`client_board_cards`) and **below** the card (unit turn record). Additive — do not replace the office client board.

**Ship order:** 1 (schema) → 2 (turn engine) → 3–6 + CSV. Do not start the next segment until the current one is cleared 10/10. Do not push to git / Replit unless asked.

## Invariants (do not take the easy path)

1. Turn clock is **event-sourced**. `client_turn_stage_events` is append-only. Never a mutable `days_vacant` on `client_turns`. Dashboards read `client_turn_metrics_mv`.
2. **Client-owned stages are first-class** via `client_stage_ownership`. `pending_approval` and `approved` belong to the client.
3. All money is **bigint cents** (`lib/db/src/moneyCents.ts`). Never JS `number` arithmetic.
4. Day-boundary math uses `properties.timezone` (IANA), never server/browser TZ.
5. Table names are `client_*` so we do not collide with office `invoices`, `bids`, `notifications`, `price_items`, or CMS `property_units`.
6. Existing `properties` table is **extended**, never cloned. Operational units are `client_units`.
7. `TurnMetrics.compute` calls `computeTurnMetrics`. Do not invent a second days/hours/cents formula. `is_stalled` is p75 of that stage at the property (Segment 2).

## Segment 1 — schema

- DDL: `lib/db/src/clientBoardDdl.ts` → `lib/db/migrations/0015_client_board_v1.sql` (`pnpm --filter @workspace/api-server render:client-board-ddl`).
- Boot: `ensureClientBoardSchema()`. Do **not** `drizzle-kit push --force`.
- Formula: `lib/db/src/turnMetrics.ts`. SQL `refresh_client_turn_metrics` must match.
- Flags: `dataModel` + `turnEngine` + `pulse` on; later UI segments dark.
- Seed: `pnpm --filter @workspace/api-server seed:client-board` — double-marker `CAF Demo — ` + brief `CAF_CLIENT_BOARD_SEED_v1`.

## Segment 2 — turn engine (no UI)

- Graph: `lib/db/src/turnGraph.ts`. Rework only after `qc`, then back to `in_progress`. Ready is terminal.
- Stats: `lib/db/src/turnStats.ts` (median, p75, predictor).
- Orchestration: `artifacts/api-server/src/lib/turnEngine.ts` — `TurnStateMachine`, `TurnMetrics.compute(orgId, turnId)`, `ReadyDatePredictor`, `PortfolioMetrics.compute`. `orgId` required on every call (session, never a client-supplied org param).
- `source=app` stamps `occurred_at = received_at`. Import/system may pass historical `occurred_at` and record `clock_skew_seconds` in meta.
- Outbox: `client_turn_outbox` is written in the same transaction as the stage events. `deliverClientTurnOutbox()` claims with `FOR UPDATE SKIP LOCKED`. Scheduler ticks the worker; HTTP SSE attach is Segment 10.
- `is_stalled` is computed inside SQL `refresh_client_turn_metrics` (p75, 90d, same property). The engine does not UPDATE the MV. Pass `p_as_of` for historical replay.
- Nightly: `refresh_open_client_turn_metrics` + batched prediction writes, once per property IANA timezone at 01:15 local.

## Segment 3 — Portfolio Pulse

- Route: client-dashboard `/:token` (Vite base `/board/`). Office mirror: `/portfolio` on halo + halo-desktop (do not use `/board` or rebuild `/pulse`).
- APIs: `GET /v1/portfolios`, `GET /v1/portfolios/:id/pulse|attention|stream`, `PUT .../saved-view`, plus `/client/:token/portfolio/*` twins. OpenAPI schemas are `*Document` nouns. Money is string integer cents.
- Read path: `artifacts/api-server/src/lib/portfolioPulse.ts` reads `client_turn_metrics_mv` + turns + properties. Never `client_turn_stage_events`.
- Flag `pulse` on via `ensureClientBoardSchema` UPDATE. 404 when dark.
- UI: `lib/board-ui` `PortfolioPulse` — IBM Plex Mono headline, 300ms tween (skipped under `prefers-reduced-motion`), SSE `event: pulse`.
- Tile click → `/properties/:id/board` (office) or `/:token/board` (client) until Segment 4.

## Append-only deletes

`halo_append_only_guard` blocks UPDATE/DELETE on events, audit log, and invoice line snapshots. Settings reset and seed teardown must `SET LOCAL` via `set_config('halo.allow_append_delete', 'on', true)` **inside the same transaction**.

## Reset list

All `client_*` operational tables are in POST `/settings/reset`. Preserve `client_stage_ownership` and `client_board_flags`.
