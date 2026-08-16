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
- Orval Get*Params / Body collisions: add the type-folder path to `lib/api-spec/stripCollidingZodParams.mjs` (Pulse, Turn Board, evidence file params, `createTurnRecordBody`, invoice export params, scope/variance `*Input`).

## Ship status

Order: 1 → 2 → 3 → 4 → 5 → 6 → 10 (CSV) → 9 → 7 → 8 → 11 → **12**.

Flags on: `dataModel`, `turnEngine`, `pulse`, `propertyBoard`, `evidence`, `invoiceCompliance`, `csvImport`, `workSource`, `bidBoard`, `pipeline`, `security`. `demo` and `realtime` stay dark. Do **not** enable `realtime`.

### Segment 4 — Turn Ring (cleared 10/10)

Office `/properties/:id/turns`, client `/:token/property/:propertyId`. Kanban stays at `/properties/:id/board` and `/:token/board`. 44px ring centers the unit number (outlined gold client arcs); 280px centers days vacant (hatched gold). Drag off.

### Segment 5 — Evidence ledger + Unit Turn Record

- Viewer: `EvidenceLedger` in `lib/board-ui`. Room-by-room before/after with a draggable divider. Canonical room order. Caption = property-TZ stamp, device, GPS distance, capturer. Integrity chips are never hidden; tap shows plain copy (`Location was 140m from the unit`). SVG GPS trail (check-in, path, check-out, geofence). Full-screen: arrows, Escape, pinch/wheel zoom.
- PDF: `pdf-lib` (no headless browser, no `@react-pdf/renderer`). `POST /v1/turns/:id/records` `{ variant: full | move_out_condition }` writes to `CLIENT_BOARD_RECORD_DIR` or tmp. Signed URL `/api/v1/records/:id/file?exp=&sig=&jti=` — 15 minutes, single-use (Segment 11). Move-out cut is sections 1, 3, 7, 9.
- Verify: Merkle root over evidence hashes + timeline on `client_turns.verification_hash`. `GET /v1/turns/:id/verify` recomputes. Mutating one `sha256` makes `matches: false`.
- File GETs are officeGuard-exempt. Tests use a 1×1 PNG for every image.
- After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.

### Segment 6 — Invoice compliance engine

- Engine: `lib/db/src/invoiceCompliance.ts`. Active price list is the one whose `effective_from`/`effective_to` covers the scope date — never “the latest”. Exact `code`+`tier` at schedule price → `matched`. Price delta beyond `invoice_tolerance_bps` (default 0) → `variance_pending`. No match → `off_schedule`. `variance_approved` lines may invoice; `first_pass_accepted` is true only when every line is `matched`.
- Hard gate in `turnInvoice.createScopeInvoice`, not the UI. Non-compliant POST `/v1/scopes/:id/invoice` → **422** naming the line and the schedule (`Rev 01`, effective month). Empty variance reason → 400.
- Viewer: `ScopeCompliance` on the Turn Ring sheet (office + client). Badge expands line-by-line with price-item code. Variance approve/reject writes `client_audit_log`. Export PDF/CSV/JSON via `window.open('/api/v1/invoices/:id/export?format=')` (office cookie; client twin under `/api/client/:token/...`). Invoice number `{propertyCode}-{unitNumber}-{YYMMDD}-{seq}`.
- Pulse: compliance strip (auto-validated / blocked / assumed hours saved). Tooltip + footnote state the hours figure is a **configured assumption**, not a measured duration. Attention adds `blocked_invoices` and `variance_pending`.
- Seed: ready-turn lines carry `code`/`tier`; Paloma’s first open turn has a draft scope with matched paint + `MARBLE-UP` off-schedule. Flag `invoiceCompliance` on. Tests: `invoiceCompliance.test.ts`, `propertyInvoice.integration.test.ts` (`caf-invoice-seg6` / `CAF_CLIENT_BOARD_INVOICE_SEG6`).
- Orval collisions: strip `exportTurnInvoiceParams`, `exportClientTurnInvoiceParams`, `getTurnInvoiceExportParams`, `getClientTurnInvoiceExportParams`, plus `*Input` request bodies. Helvetica PDFs must WinAnsi-sanitize `—` / `→`.
- Do not start Segment 10 (CSV) until this segment is 10/10.

### Segment 10 — CSV import only (not emails / SSE extras)

Usable with **no Entrata API**. `getEntrataAdapter()` reads `ENTRATA_ADAPTER` (`csv` default). `EntrataApiAdapter` throws `EntrataApiDisabledError` (“Import a CSV export instead.”) — 409. Nothing hard-depends on the API adapter.

- Parser: `lib/db/src/entrataCsv.ts`. Civil dates `YYYY-MM-DD` / `MM/DD/YYYY`. Money via `dollarsToCents` (`$1,450.00` → `145000n`). `guardCsvCell` prefixes formula chars. `firstPropertyCode` so office POST resolves org from CSV Property ID (not `listPortfoliosForOffice()[0]`).
- Apply: `artifacts/api-server/src/lib/entrataCsvAdapter.ts`. Units upsert by `(property, unitNumber)`. Notices `createTurn({ source: "import" })` then stamp `entrataNoticeId`; same notice id skips. Same file sha → `replayed`. POs unique `(org, poNumber)`; attach onto an invoice on that unit with null PO. Submit invoice writes `{CLIENT_BOARD_IMPORT_DIR or tmp/halo-entrata}/outbound/{invoiceNumber}.pdf` + `.json`. Drop-folder: `CLIENT_BOARD_IMPORT_DIR/{units|leases|notices|purchase_orders}/*.csv` after nightly recompute.
- HTTP: `POST/GET /v1/imports/entrata`, templates before `:id`, `POST /v1/invoices/:id/entrata`, client twins. Flag dark → 404. Office list aggregates every portfolio org.
- UI: `EntrataImport` in `lib/board-ui`. Office `/imports` (not `/import`). Client `/:token/imports`. Pulse “Entrata CSV” via `importHref`. After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.
- Tests: `entrataCsv.test.ts`, `entrataImport.integration.test.ts` (`caf-import-seg10` / `CAF_CLIENT_BOARD_IMPORT_SEG10`). Orval: strip `importEntrataCsvInput`.
- Do **not** build React Email, digests, or extra SSE. Segment 9 (work-source) shipped after this slice.

### Segment 9 — Work-source unification + permissions

- Filter `workSource=all|in_house|third_party` (default all) on Pulse, attention, Turn Board, and cost-to-serve. In-house cards use the same ring, evidence, and metrics as third-party.
- CTB vendor org (`ctb-multifamily`) has `crew_portal_comp = true` (full crew portal, no charge). Paloma seed member `property_manager` scoped to Paloma; Redbud `maintenance_lead`.
- Cost-to-serve: office `/how-work`, client `/:token/how-work`. Title **“How work gets done across the portfolio”** — not a vendor scorecard. Cost / days / rework by bedroom count, in-house vs third-party. Money as string integers. Flag dark → 404 `{ error: "Work-source views are not enabled" }`.
- Office without `x-halo-member-id` stays `asset_manager`. With the header, a `property_manager` scoped to A receives **403** on every property B office v1 resource in `CLIENT_BOARD_PROPERTY_BOUND_OFFICE_PATHS`. Scope/invoice approve over `properties.scope_approval_cents` (default 500000) is 403 server-side.
- Tests: `workSource.integration.test.ts` (`caf-work-seg9` / `CAF_CLIENT_BOARD_WORK_SEG9`). After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.
- Segment 7 (Bid Board) shipped after this slice. Do not enable `realtime`.

### Segment 7 — Bid Board

Vendor-neutral comparison. A single-vendor board is not a product. Lines align on price-item `code` + `tier`. Weights are per-property and shown openly (defaults 35 / 25 / 20 / 20: price vs schedule, on-time 90d, rework inverted, capacity). Hover/focus/click on the score opens a popover with weight % and component → contribution (not native `title=`). Award assigns the vendor, moves the turn to `scheduled`, writes an Entrata PO payload, notifies **every bidder including losers with their score**, and emits SSE `bid.awarded` with `scores[]`.

- Engine: `artifacts/api-server/src/lib/bidBoard.ts`. At-schedule price = 100, 2× = 0. Award walks `pending_approval` → `approved` → `scheduled` when needed. **Hard gate:** fewer than two submitted bids → 409 `"A single-vendor board is not a product..."`. `notifyVendorOrgs` on invite (`kind: bid.invited`). `notifyBidders` writes `client_portfolio_notifications` (`kind: bid.awarded`, payload `score` / `awarded` / full `scores`) to each submitted vendor’s org members (fallback `userId: vendor-org:{id}`) plus PM org members.
- Vendor auth: invited vendor POSTs `/v1/bid-requests/:id/bids` with **only** `x-halo-vendor-org-id` (no office cookie). Office-on-behalf still works with cookie + body `vendorOrgId`. Invited-only still 403 in `submitVendorBid`. `isVendorBidAuth` skips cookie / identity / Falkon mutation on that path when the header is set.
- HTTP: `POST /v1/scopes/:id/bid-requests`, `POST /v1/bid-requests/:id/invitations`, `POST /v1/bid-requests/:id/bids`, `GET /v1/bid-requests/:id/comparison`, `POST /v1/bid-requests/:id/award`. Client twins under `/client/:token/...`. Flag dark → 404 `{ error: "Bid board is not enabled" }`. Comparison document includes `timezone` (property IANA) and `eligibleVendors` (named `client_orgs` type vendor, excluding already invited). Segment 9 403 sweep includes these bid paths (`CLIENT_BOARD_PROPERTY_BOUND_OFFICE_PATHS` + `ResourceIds.bidRequestId`).
- UI: `BidBoard` in `lib/board-ui`. Named invite chips from `eligibleVendors` (not UUID paste). Coral warning if only one vendor invited; Award disabled unless ≥2 submitted. `ScoreHover` popover: 44px target, Escape closes, gold score. Due and earliest start format with `Intl` in `doc.timezone` (never the browser zone). Waiting columns have **Enter bid**: 14-line dollar form, civil date in the property zone, qty locked. Office `/bid-requests/:id`, client `/:token/bid-requests/:id`. Turn Ring: “Put out to bid” / “Compare bids”. Duplicate office UI in halo + halo-desktop.
- Seed: Paloma **second** open turn (`t === completedCount + 1`) is a live 14-line × 3-vendor comparison (Archangel / Summit / Prairie Star at 0% / +10% / +20%). Do **not** replace Paloma’s first-open marble+paint invoice demo.
- Tests: `bidBoard.test.ts`, `bidBoard.integration.test.ts` (`caf-bid-seg7` / `CAF_CLIENT_BOARD_BID_SEG7`). Office cookie for first bid; vendor header only for bids 2–3. Client twin GET comparison 200. Award SSE has 3 scores; 3 vendor notifications, exactly one awarded. One-bidder award → 409. After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.
- Flag `bidBoard` on. Segment 8 (Pipeline) shipped after this slice. Do not enable `realtime`.

### Segment 8 — Turn pipeline (the only forward-looking screen)

Office **`/board/pipeline`**. Existing office `/pipeline` (leads & bids) is untouched. Client twin `/:token/pipeline` (browser `/board/:token/pipeline` because Vite base is `/board/`). Pulse “Pipeline” links there.

- Engine: `artifacts/api-server/src/lib/turnPipeline.ts`. Math in `lib/db/src/turnPipelineMath.ts` (no ML). Vacate volume = scheduled + notices × on-schedule conversion (fraction of notices that vacated **on the scheduled civil day** — not 100%). Duration = property×bedroom vacate-to-ready × month seasonal index. Spend band: **low** = scheduled only; **mid** = scheduled + converted notices; **high** = scheduled + all notices. Method string is on the document and the page. Week starts are Monday civil days in the **portfolio IANA** timezone.
- Heatmap: 13 weeks × trades `paint` / `flooring` / `clean` / `drywall` / `hvac` / `punch`. Cell = projected demand / declared capacity. Ratio > 1.0 = crunch. Zero capacity + demand → 2.0. Plain CSS grid, no charting library. Timeline cell color is week-level portfolio crunch (capacity is vendor-global).
- Hold: `POST /v1/turns/:id/capacity-hold` writes six trade rows in one bundle against `capacity_declarations`, minus live holds. Expires in `properties.capacity_hold_hours` (default 72) unless `POST /v1/capacity-holds/:bundleId/confirm`. Second hold on the same turn → 409. Auto-drafts scope from the unit’s last ready turn. Manual vacate: `POST /v1/units/:id/vacate-notice` `{ scheduledVacate: YYYY-MM-DD }` in the property timezone via `zonedCivilToUtc`.
- HTTP: `GET /v1/portfolios/:id/pipeline`, client twins under `/client/:token/...`. Flag dark → 404 `{ error: "Pipeline is not enabled" }`. Segment 9 403 sweep includes hold + vacate-notice (`ResourceIds.unitId`).
- UI: `TurnPipeline` in `lib/board-ui`. 13-week property grid, CSS heatmap, spend 30/60/90 bands, pre-staging Hold/Confirm. Hold expiry formats with `doc.timezone` (never the browser zone). Duplicate office UI in halo + halo-desktop. After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.
- Seed: ~20% of completed turns miss the scheduled civil day. Leftover units get future notice turns (Paloma cluster week 2; others 4/7; last leftover on non-Paloma is notice-only). Capacity declarations cover **13 weeks**; Paloma week-2 paint capacity = 1 (crunch). Do **not** replace Paloma marble invoice or 14-line bid comparison.
- Tests: `turnPipelineMath.test.ts` (7/10 → 0.7; spend 200000/480000/600000), `turnPipeline.integration.test.ts` (`caf-pipe-seg8` / `CAF_CLIENT_BOARD_PIPE_SEG8`). `computePipeline` < 400ms on the fixture. Client twin 200. Second hold 409. Orval: strip `vacateNoticeInput`. Boot `ensureClientBoardSchema` flips shipped flags including `pipeline` on existing DBs.
- Flag `pipeline` on. Segment 11 (security) shipped after this slice. Do not enable `realtime`.

### Segment 11 — Security, audit, compliance hardening

- Auth: org/role from session. `ClientBoardRepo` throws `MissingOrgScopeError` without `orgId`. Routes do not `db.select().from(clientTurnsTable|clientEvidenceItemsTable|clientAuditLogTable|clientUnitsTable)` — use `loadTurnRef` / `loadEvidenceRef` / `loadPortfolioRef`.
- Resident PII: units by number. `stripResidentPii` / `RESIDENT_PII_KEYS` in `lib/db/src/orgScope.ts`.
- Signed URLs: 15-minute TTL, single-use `jti` tickets in `client_signed_url_tickets`. First GET 200, second 404. `consumeSignedFile` on evidence + record file GETs.
- Rate limits: 100/min reads, 20/min writes, 5/min `POST .../turns/:id/records` (`limitClientBoard` on client-board routers; relaxed under Vitest).
- Audit: `GET /v1/portfolios/:id/audit` (+ `/export` CSV). Auditor + asset_manager 200; regional_manager 403. Flag dark → 404 `{ error: "Audit log is not enabled" }`. Client twins `/client/:token/portfolio/audit` are 403 (office-only). UI `AuditLog` at office `/audit`. Pulse `auditHref` is office-only.
- Retention: `client_orgs.evidence_retention_years` default 7. Nightly `tombstoneExpiredEvidence`. Soft tombstone; `GET /verify` still `matches: true`. `POST /v1/evidence/:id/tombstone`.
- Secrets: `scripts/src/check-secrets.ts` (AWS access-key prefix, PEM private-key header, Postgres URLs with embedded passwords) in `@workspace/scripts` typecheck. `.githooks/pre-commit` — operators set `core.hooksPath`; agents do not `git config`.
- Backups: daily `pg_dump` + weekly restore test in `RUNBOOK.md`.
- Tests: `orgScope.test.ts`, `clientBoardSecurity.integration.test.ts` (`caf-sec-seg11` / `CAF_CLIENT_BOARD_SEC_SEG11`). After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.
- Flag `security` on. Segment 12 (performance, seeding, demo) shipped after this slice. Do not enable `realtime`.

### Segment 12 — Performance, testing, seeding, and demo mode

v1 definition of done: a regional manager opens Pulse and sees vacancy cost this month on live client data; sees which delays are hers; opens any unit and produces a document proving what happened; cannot be overbilled (the system shows that in a number); compares bids from vendors who are not you; sees what next month costs before it arrives.

- Budgets (already guarded): Pulse p95 17k-unit fixture, pipeline `< 400ms`, 40-photo PDF `< 8s`. Lists over 50 rows virtualize with `@tanstack/react-virtual`. Client-board routes are `React.lazy` + navy `#07101E` skeleton (`BoardRouteFallback`) matching Pulse layout. HaloCommand home stays eager.
- Turn Ring sizes `44 | 120 | 280`. Visual regression: three sizes × vendor gold / client hatch-or-outline / rework+over-p75 coral (`TurnRing.visual.test.tsx`).
- Seed: `pnpm seed:demo` (alias `seed:client-board`) — **12 properties × 40 units × 120 days**. Paloma / Desert Sage / Redbud stay first (bottleneck, two rework loops, in-house CTB). Paloma first open: paint `variance_pending` + `MARBLE-UP` off-schedule. Paloma second open: live 14-line × 3-vendor bid. `pnpm seed:live -- --source=./caf-export/` ingests real Entrata CSVs into `caf-live` (does not depend on the generated set).
- `DEMO_SAFE=true` redacts emails, phones, capturer names (`Crew`), and actor ids that look like emails on client-board JSON. Resident PII still stripped. Flag `demo` stays **false**. Do **not** enable `realtime`.
- Tests: `seedClientBoard.test.ts`, `seedClientBoardLive.test.ts`, `seedDemo.integration.test.ts`, `clientBoardFlows.integration.test.ts` (approve / block invoice / award bid / UTR+verify). Playwright spec at `artifacts/api-server/e2e/client-board.spec.ts` skips without `PLAYWRIGHT_BASE_URL`. After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.

## Client kanban load path

`GET /client/:token/board` resolves **both** tokens. `caf-paloma` is `client_accounts.dashboard_token`. `caf-regional` is `client_portfolios.dashboard_token` — `accountByToken` maps it to an active property account (optional `?property=` from the Pulse Board door, else the first linked account). Office Pulse Board falls back to the first tile when no site is selected. Client chrome is Watch-icon squircles on Command glass (`commandSurface.css` `.cb-ios-*` / `.cb-rail-*`). Do not regenerate OpenAPI for the property query — the client board page fetches it on the URL.

## Password-free regional vs property views

Office Pulse (`/portfolio`) still uses `OfficeGate`. Client links are the password-free path:

- **Regional:** `client_portfolios.dashboard_token` = `caf-regional`. Open `/board/caf-regional` (or HALO `/views` → Regional, or `/regional`). Sees every community in North Region. Can attach an existing org property or create a named one (`POST /client/{token}/portfolio/properties`). Pipeline / how-work / Entrata CSV stay on this link.
- **Property:** `client_accounts.dashboard_token` = `caf-paloma`. Open `/board/caf-paloma` (or `/paloma`). Pulse is Paloma only. Turn board / evidence / invoice for other properties in the same portfolio → 404. Cannot add properties. Audit is office-only (403 on client twins).
- Session cookie subject is the property UUID, or `r:{portfolioId}` for regional. Do **not** enable `realtime` or `demo`.

## Flight-control Pulse HUD (Direction B — balanced)

Cards and board chrome use **HALO Command module materials**: `#07101E` glass, hairline `rgba(255,255,255,0.09)`, layered shadow, 18px radius, lime status dot. The map is Esri World Street Map with an Apple-Maps grade (`saturate` / `brightness` / green `hue-rotate`) — parks read bright, roads stay light. Shared tokens live in `lib/board-ui/src/components/commandSurface.css`.

Cards are Apple Watch icons on **blue Apple glass**: saturated lime (`#B4FF44`, black ink) or system blue (`#0A84FF`, white ink) face; body and card modules use the shared `--cmd-glass` (cool blue frost, hairline, inset highlight). Not void navy, not washed baby blue, not white/emerald module pills. Contrast guard still applies. Map stays Carto Voyager / Apple-bright. Pulse left-of-map boxes use the same glass. Map fade is a left-to-right blue glass dissolve into the map (not `display: none`).

Ask this board is a **reasoning partner**: `askReason.ts` scores intent, resolves “that unit”, compares sites, and cites the clock. Cortex still ranks; the model only narrates. Answers render as a 5th-grade worksheet (`askSheet.ts`) — underlined color titles, 8-word bullets, mini kanban when the board can show it. Superpowers: MiniLM/hash memory, Holt on the **metrics vacant-day clock** (closed-turn terminals first), durable HITL queue, preference learning, and a **morning fork** card (sign vs wait in vacant days + Base44 proof). Ghost typeahead names the next signature. Propose queues a nudge and keeps it until the wait clears; queue-only POSTs skip narration. Never a second vacancy $ clock and never an auto-write. Server returns `{ answer, why, sections, citations, followUps, partner }`; invent-guard drops unknown units. Vacancy $ is the Pulse window (vacate → ready, property TZ). Do not embed HaloCommand. No HALO / Work App jargon on first run. Set `AGENT_HF=0` and `MEM0_TELEMETRY=false` in tests. Production MiniLM tries WASM then CPU.

Client Portfolio Pulse (`lib/board-ui` `PortfolioPulse`) is a **Needs you + Sites + map** home. Navy header: vacancy $ as a quiet stat, **Ask** as the header field (community / unit / what’s on fire). Labeled left rail: Ask, Sites, Needs, Turns, Photos, plus a text **Board** door (not a second lime CTA). Default-open is **Needs you + Sites only**. One lime object: the map pill (`Open Paloma · 214`) — next unit that needs the PM, C copy (`waiting on you, 4 days`). Crew is a chip on the selected site / “N of M sites live”, not a sixth open card. Photos, turns, vacancy detail, crew, detach stay in the product; they are not the first breath. Detach is hover-only (power move). Map fade is a premium left-to-right blue-glass dissolve into Carto Voyager (not hidden). No HALO / Work App jargon on first run. Left modules are Apple blue glass (`--cmd-glass`), same as client-board card modules. **Turns** still carry the live vacant timer + close-out strip; vacancy **dollars** still stop at `readyAt` (one formula). Photos still come from Base44 `before`/`after` evidence — do not invent a second store. Keys: `halo_client_pulse_hud_open_v6` / `_mode_v6` / `_pos_v6`. Reset docks everything and restores the two-card default. Stage uses `isolation: isolate`; boxes `z-index` 1100+. Do not add `transform`/`filter`/`will-change` on the stage. Do not port GPS Finder / Site Twin / Twilio. Tiles carry optional `latitude` / `longitude` / `city`. After `lib/board-ui` edits: `pnpm exec tsc --build lib/board-ui --force`.

## v1 is complete

Segments 1–12 shipped. Later work is operations (real Entrata export via `seed:live`) and optional `realtime`. Do not flip `realtime` or `demo` as a side effect of deploying.
