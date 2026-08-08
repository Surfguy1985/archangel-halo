---
name: HALO Base44 sync
description: One-way pull from the Base44 legacy system into HALO tables. Runs every 15 min via scheduler; manual trigger via POST /api/settings/sync-base44.
---

# HALO Base44 Sync

## Endpoint
- URL: `https://wakeful-ready-track-flow.base44.app/api/apps/wakeful-ready-track-flow/functions/haloRead`
- Auth header: `x-halo-token: <HALO_READ_TOKEN secret>`
- Returns 9 resources: `properties`, `units`, `invoices`, `crews`, `crew_jobs`, `payment_requests`, `calendar_slots`, `owners`, `price_items`

## Architecture
- `artifacts/api-server/src/lib/base44Sync.ts` — all sync logic
- `base44_sync_map` DB table (schema: `lib/db/src/schema/settings.ts`) — maps (resource, base44_id) → halo_id UUID; never pollutes existing tables with external-ID columns
- Scheduler (`lib/scheduler.ts`): `BASE44_SYNC_MS = 15 * 60 * 1000`, runs `runBase44Sync()` every 15 min

## Execution order (dependencies)
1. `properties` (needed by everything else)
2. `crews` (needed by crew_jobs)
3. `units`, `price_items`, `calendar_slots`, `owners` (parallel — all reference properties)
4. `crew_jobs` (needs properties + crews)
5. `invoices`, `payment_requests` (parallel — need jobs)

## Entity → HALO table mapping
| Base44 resource  | HALO table              | Natural-key dedup          |
|------------------|-------------------------|-----------------------------|
| properties       | propertiesTable         | name                        |
| crews            | crewsTable              | phone                       |
| crew_jobs        | jobsTable               | jobNo                       |
| invoices         | invoicesTable           | invoiceNo                   |
| payment_requests | paymentRequestsTable    | requestNo                   |
| calendar_slots   | calendarEventsTable     | always insert (no dedup)    |
| units            | propertyUnitsTable      | (propertyId, label) unique  |
| price_items      | priceItemsTable         | (propertyId, lower(service)) expression index — manual SELECT+UPDATE |
| owners           | propertiesTable.pmcName + contactsTable | by Base44 ref on property |

## API endpoints (office passcode required)
- `GET  /api/settings/sync-base44/status` — last sync result JSON
- `POST /api/settings/sync-base44` — trigger immediate sync and wait

## Key design decisions
- `price_items` has a functional expression unique index — can't use drizzle `onConflictDoUpdate` with expression target; solved with manual SELECT + UPDATE
- `calendar_slots` always insert new rows (no stable natural key)
- `owners` patch `propertiesTable.pmcName` for linked properties and upsert to `contactsTable`
- `syncRunning` mutex prevents overlapping runs
- All entity errors are caught and counted — one bad record never aborts the whole sync

**Why map table:** Adding `base44Id` columns to every production table is invasive and pollutes read models. The side-table approach is fully reversible.
