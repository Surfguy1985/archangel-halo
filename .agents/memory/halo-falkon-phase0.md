---
name: HALO Falkon Ops Phase 0
description: Schema, outbox, routes, and walk-approved wiring for the Falkon Ops integration.
---

## Tables added (Phase 0)

- `falkon_connections` — singleton row for the active Falkon connection (mode, webhook URL, secret).
- `falkon_events` — outbound HMAC-signed outbox; status: pending → delivered | failed → dead (5 attempts, exponential backoff).
- `falkon_inbound_events` — received Falkon → HALO events (replay-deduped by falkon_event_id).
- `falkon_policies` — per-property or global automation/QC rules.
- `falkon_units` — unit/asset twins: stable UUID per (property_id, unit_label) pair.

## Naming collision — property_units is TAKEN

`property_units` already exists as the client-board CMS site-map table (columns: id, property_id, label, x, y, w, h) defined in `lib/db/src/schema/client_cms.ts`. The Falkon unit twin table **must** be `falkon_units`.

**Why:** HALO has no SQL FK guards, so creating a same-named table would fail silently or corrupt the CMS. Always check `information_schema.columns` before naming a new table.

**How to apply:** Any future Unit twin work references `falkonUnitsTable` from `@workspace/db/schema`, not `propertyUnitsTable` (which is the CMS box).

## crewCheckinsTable actual columns

`lat`, `lng`, `accuracy`, `label`, `note`, `kind`, `movingToUnit`, `createdAt` — NO `latitude`, `longitude`, `address`, `arrivalDetected`, `checkInAt`, `checkOutAt`.

## HMAC signing

`falkonEmit.ts` exports `emitFalkonEvent` (fire-and-forget outbox write), `buildFalkonSignature`, `verifyFalkonSignature`. The routes file uses `verifyFalkonSignature` directly — do not add a local duplicate.

## Outbox delivery

`falkonScheduler.ts → deliverFalkonOutbox()` called every scheduler tick. Fast-path no-ops when mode=OFF or no connection row.

## Walk-approved wiring

`emitFalkonEvent("job.walk_approved", ...)` fires in two places:
1. `clientBoard.ts` — office-side walk approval action.
2. `clientAccess.ts` — client-board `approve_walk` action.

Both are fire-and-forget (`void`), after the primary DB commit, inside the same try block.

## Desktop route

`/integrations` → `<FalkonConnect />` (gate: office passcode cookie). Desktop app uses bare `/api/...` fetch paths — no `apiUrl` helper exists.

## drizzle-kit push in CI

`drizzle-kit push` requires a TTY for column-rename prompts. Use raw SQL via the `pg` module at `/home/runner/workspace/node_modules/.pnpm/pg@8.22.0/node_modules/pg/lib/index.js`. Run statements ONE AT A TIME — multi-statement `client.query()` batches fail on index creation against a newly created table.
