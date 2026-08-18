---
name: HALO Base44 sync
description: One-way pull from the Base44 legacy system into HALO tables. Runs every 15 min via scheduler; manual trigger via POST /api/settings/sync-base44.
---

# HALO Base44 Sync

## Endpoint
- URL: `https://wakeful-ready-track-flow.base44.app/functions/haloRead` (overridable via `BASE44_READ_URL`).
- Write-back for Pulse POs: `https://wakeful-ready-track-flow.base44.app/functions/haloWrite` (`BASE44_WRITE_URL`, token `HALO_WRITE_TOKEN` or `HALO_READ_TOKEN`). Body `{ action: "set_po", po_number, unit_id, crew_job_ids, job_no, unit_number, property }`. HALO stamps the job even if Work is down. Inbound unit sync never overwrites a HALO PO with empty.
  Earlier notes recorded an `/api/apps/<app>/functions/haloRead` path — that is **not** what the client uses.
- Auth header: `x-halo-token: <HALO_READ_TOKEN secret>`
- Payload shape is `{ generated_at, data: { <resource>: [...] } }` — **resources are nested under `data`**, not top level.
- Serves 9 resources: `properties`, `units`, `invoices`, `crews`, `crew_jobs`, `payment_requests`, `calendar_slots`, `owners`, `price_items`.
  `unit_jobs` and `unit_schedules` also appear in `base44_sync_map` but are **HALO-side derivations** (from `units`), not upstream resources.

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

## Guard clauses must call `noteSkip`, never bare `continue`
Every `if (!propertyId) continue;`-style guard inside a sync function must call `noteSkip(resource, bid, reason)` first.

**Why:** these guards used to `continue` silently. The sync reported `success` with 0 errors on 881 consecutive
runs while permanently dropping rows the upstream was still serving — including *paid* crew jobs whose `unit_id`
pointed at units deleted upstream (no `property`/`property_id` fallback exists on those records, so the property is
unresolvable and the row can never be placed). Skips are not errors, but they are not synced either; unreported they
are indistinguishable from success.

**How to apply:** `noteSkip` feeds exact per-resource/per-reason counters plus a detail list capped at
`MAX_SKIP_DETAIL`. Roll-up must use the *counters*, never `skipLog.length`, or capping silently undercounts.
Surfaces as `SyncResult.totalSkipped`, `resources[x].skipped`, and health `unplaced`/`unplacedDetail`.
Accessors return copies — never hand out the live array.

## Reading the sync counters
- `totalCreated`/`totalUpdated` come from the **ingest/evidence layer**, which does real change detection. All-zero
  totals on a healthy run mean *nothing changed upstream*, not that the sync is broken.
- Per-resource `updated` comes from the legacy projection path, which re-upserts unconditionally — it means
  "rows touched", not "rows changed". The two numbers legitimately disagree.
- `price_items` fans out per property (N upstream items × M properties), so its count far exceeds the upstream count.

**Why map table:** Adding `base44Id` columns to every production table is invasive and pollutes read models. The side-table approach is fully reversible.

## Crew-job rescue fallbacks (unresolved property)
When a crew_job's unit_id points at a unit gone from the upstream payload, syncCrewJobs no longer skips blindly. Order:
1. Existing crew_jobs sync-map entry → the already-filed HALO job remembers the property; patch payment fields only (Path-A style, never overwrite jobNo/boardStatus downward).
2. Unambiguous inference: all HALO jobs for that crew on the same scheduledOn date at exactly ONE property → use it. Ambiguous = stay unplaced.
3. Otherwise noteSkip("crew_jobs", …, "unresolved_property") — visible via totalSkipped/unplaced, never guessed.
**Why:** two paid Work App jobs were dropped every run even though their HALO job rows already existed — the unresolved_property guard ran before the own-mapping lookup.
Also: a dead unit_id must not blank unitNo on update (unitNo only written when resolved or on insert).
