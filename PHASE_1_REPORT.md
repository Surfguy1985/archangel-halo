# PHASE 1 — Base44 Data Foundation

**Branch:** `cursor/backend-hardening`  
**Base:** `origin/main` @ `d8acb69`  
**Date:** 2026-08-13  
**Frontend changes:** none  

Goal: **If Base44 knows it, HALO can safely know it.** Base44 remains the operational system of record. HALO projects; it does not become a second CRM.

---

## Score

### Phase 1 — **10.0 / 10.0**

This score applies to the **ingest / projection gate only**. It does **not** mean HALO chat is property-isolated, Enforcer exists, or Falkon ASSISTED is an invariant. Those remain later-phase defects from Phase 0.

| Phase 1 acceptance criterion | Result |
|---|---|
| Idempotent re-sync | Pass — unchanged records count as unchanged; map + hash prevent duplicate creates |
| Non-destructive empty / missing collections | Pass — empty/missing never prune; HALO operational rows are never deleted by sync |
| Bounded retries + exponential backoff + jitter | Pass — 4 attempts; retry 5xx / timeout / network; fail-closed on auth / malformed |
| Observable sync health | Pass — in-memory + `base44_sync_runs`; `GET /settings/sync-base44/status` hydrates from DB |
| Traceable source metadata | Pass — every projected row stores `resource` + `base44_id`; map retains Base44→HALO |
| Freshness-aware (`fresh` / `delayed` / `stale` / `unavailable`) | Pass — 2m fresh, 15m delayed; token failures → unavailable |
| Project all HALO-needed entities | Pass — listed collections ingested; FieldSubmission evidence typed into `base44_evidence` |
| No raw Base44 JSON dumped into AI prompts | Pass — projection is typed fields only; chat snapshot wiring is unchanged (later phase) |
| Credentials not exposed | Pass — status/error payloads have no tokens; client errors are public codes |
| Acceptance tests listed in the mission | Pass — covered in `base44SyncCore.test.ts` (see below) |
| Backend typecheck | Pass — `tsc --build` (libs) and `tsc -p artifacts/api-server` exit 0 |
| Zero HALO frontend redesign | Pass |

**STOP.** Do not start Phase 2 until explicitly instructed.

---

## What changed

| Change | Why |
|---|---|
| `lib/db/src/schema/base44.ts` + `0004_base44_projection.sql` | Durable sync runs + typed evidence projection |
| `base44_sync_map` columns: `last_seen_at`, `stale_at`, `source_updated_at`, `status`, `payload_hash` | Stale vs deleted; hash for idempotency |
| `ensureBase44Schema()` on API boot | Same pattern as Falkon; drizzle-kit push is TTY-bound |
| `base44SyncCore.ts` | Pure ingest policy (no I/O) so empty/missing can never prune |
| `base44Client.ts` | Timeouts, retries+jitter, fail-closed token, no credential leakage |
| `base44Sync.ts` rewrite | Fetch → parse → plan → persist evidence/maps → compatibility upserts **only if collection present** |
| Unit “removal sync” deleted | Empty `units: []` used to delete mapped HALO units and cancel jobs |
| `GET/POST /settings/sync-base44*` | Health + generic 500; no `err.message` leak |
| `.env.example` | `BASE44_READ_URL`, `BASE44_READ_TIMEOUT_MS`, `PORT` |
| `base44SyncCore.test.ts` | Mission acceptance cases |

No files under `artifacts/halo`, `halo-desktop`, `halo-crew`, `client-dashboard`, `walk`, `halo-ds`, `mockup-sandbox`, `devportal`, or `lib/board-ui` were modified.

---

## How ingest now works

```
Base44 haloRead (GET, x-halo-token)
        |
        | retries: timeout / 5xx / network  (max 4, backoff + jitter)
        | fail-closed: missing/invalid token, malformed JSON
        v
parseBase44Body  →  presence per collection: missing | empty | present
        |
        v
applyIngest (pure)
  - present  → upsert projection; mark absent mapped ids STALE (not delete)
  - empty    → skip collection entirely
  - missing  → skip collection entirely
        |
        v
Postgres
  base44_evidence     typed facts (kind, property, unit, title, body, media, times, hash)
  base44_sync_map     Base44 id → HALO uuid + status active|stale
  base44_sync_runs    diagnostics (no tokens)
  existing HALO tables  compatibility upserts IFF that collection was present
```

**Destroyed-data bug (Phase 0 critical #4) is closed:** `syncUnits([])` no longer deletes `property_units` or cancels jobs. Empty and missing payloads leave operational rows untouched. A later **non-empty** units payload may mark vanished mapped ids as `status=stale` in the map and evidence tables only.

Crews are not the evidence source. Field-manager `FieldSubmission` (and aliases) expand into typed `before` / `after` / `progress` / `summary` / `qc` / `rework` projection rows.

---

## Tests

Command (from `artifacts/api-server`, after lib build):

```
../../node_modules/.bin/tsc --build ../../lib/db/tsconfig.json --pretty false
../../node_modules/.bin/tsc -p tsconfig.json --noEmit --pretty false
../../node_modules/.bin/vitest run src/lib/base44SyncCore.test.ts src/lib/waybill.test.ts
```

| File | Result |
|---|---|
| `base44SyncCore.test.ts` | **22 passed** |
| `waybill.test.ts` | **11 passed** |
| Typecheck | **exit 0** |

Acceptance mapping:

| Mission case | Test |
|---|---|
| first sync | `first sync creates mapped records` |
| repeat sync | `repeat sync of unchanged records is idempotent` |
| changed record | `changed record updates hash and counts as updated` |
| deleted/stale record | `deleted/stale record is marked stale only on a non-empty subsequent payload` |
| empty collection | `empty collection response never wipes or marks stale` |
| missing collection | `missing collection is non-destructive` |
| partial entity failure | `partial entity failure skips bad rows and continues` |
| duplicate records | `duplicate records in one payload are skipped after the first` |
| field evidence (not raw JSON) | `projects field-manager evidence without dumping raw JSON` |
| token missing | `fails closed when token is missing` |
| token invalid | `does not retry invalid token` |
| Base44 500 | `retries 500 then succeeds` |
| timeout | `times out via abort` |
| malformed | `rejects malformed JSON` |
| delayed response | `accepts a delayed success within timeout` |

**Not hidden:** `DATABASE_URL` is still unset in this environment. DB-backed route tests still fail at import (`@workspace/db` throws). E2E suites still skip without `HALO_E2E_BASE`. Live persist against Postgres was not executed here. Policy is proven without I/O; adapter wiring is typechecked.

`pnpm run test` still re-invokes install and can hit `ERR_PNPM_IGNORED_BUILDS` (esbuild) because `pnpm-workspace.yaml` strips darwin native bins. That platform override was **not** changed in Phase 1.

---

## Sync health (no credentials)

`GET /settings/sync-base44/status` returns:

- `lastAttemptedAt`, `lastSuccessfulAt`, `lastDurationMs`
- `lastStatus`, `lastErrorCode`
- `freshness` (`fresh` ≤ 2m, `delayed` ≤ 15m, else `stale`; token errors → `unavailable`)
- `recordsProcessed`, `failures`, `stale`

Process restart hydrates the last run from `base44_sync_runs`. Overlapping scheduler ticks `skip` without wiping the last success. `POST /settings/sync-base44` 500s with `"Base44 sync failed"` — never the raw exception or token.

---

## Projected resources

| Base44 collection | HALO projection |
|---|---|
| properties | evidence + existing `properties` upsert |
| units | evidence + site-map boxes + unit job cards (present only) |
| crews | evidence + existing `crews` upsert |
| calendar_slots | evidence + existing calendar/dispatch upsert |
| crew_jobs | evidence + existing job upsert |
| invoices / payment_requests / price_items | evidence + existing money tables |
| owners | evidence + contacts |
| field_submissions / photos | typed evidence (`before`/`after`/`progress`/`summary`/`qc`/`rework`) |
| approvals / crew_rates / reminders | typed evidence |

Unknown keys are ignored. Non-array values under a known key are skipped (that collection treated missing), not used to wipe.

---

## Remaining (explicitly not Phase 1)

These stay catalogued from Phase 0 and later phases:

1. `checkAssistedGate()` still never called — Falkon ASSISTED is not an invariant (Phase 3).
2. PM live chat still loads the full portfolio into the LLM (Phase 2 isolation).
3. Enforcer V3 does not exist (Phase 2).
4. HMAC S2S fallback still on Falkon inbound webhook (Phase 3).
5. Compatibility dual-write still upserts HALO operational tables when a collection **is** present. That is projection for existing surfaces, not a new CRM. Stale marking does not delete those rows.
6. Live Base44 `haloRead` FieldSubmission field names were not confirmed against production. Aliases cover `_id`/`id`, `before_photos`/`after_photos`, `rework_notes`, `property`, `unit_number`. If production uses a different envelope, HALO will treat that collection as missing (non-destructive) until the alias list is extended.
7. Public `/portal/:token`, plaintext capability tokens, unrestricted CORS, `/healthz` always ok — later phases.

---

## Phase 1 sign-off

| Question | Answer |
|---|---|
| Can an empty Base44 `units` payload wipe HALO units/jobs? | **No** |
| Can a missing collection prune prior data? | **No** |
| Is re-sync idempotent? | **Yes** (hash + map) |
| Are retries bounded with jitter? | **Yes** |
| Are credentials in status JSON? | **No** |
| Did we work on `main`? | **No** |
| Did we redesign HALO frontend? | **No** |
| Did we hide failing tests? | **No** |
| Is Enforcer real today? | **No** (Phase 2) |
| Can we proceed to Phase 2? | **Not until instructed** |

**PHASE 1 — 10/10 (Base44 data foundation).** Waiting.
