---
name: HALO GPS Finder + Site Twin
description: Address/drop-pin GPS lock per property; georeferenced unit plate that snaps crew phone GPS to an apartment, with unit status, dwell/replay proof, and drag-to-place geometry.
---

- GPS Finder lives in Add/Edit property and Pulse (map pin FAB). Search is `GET /api/geo/search?q=`; reverse is existing `GET /api/geo/reverse`. Locking a site is `POST /api/properties/:id/gps` which stamps `geocodedAt` so the background Nominatim job never overwrites a dropped pin.
- Nominatim 1 req/sec is shared in `geocode.ts` (search + reverse + lazy address geocode). Do not add a second Nominatim queue.
- Site Twin is `GET /api/properties/:id/site-twin`: OSM building footprint via Overpass (cached 1h), unit boxes from `property_units` georeferenced onto that bbox, crew GPS from today's track points + last check-in, snapped with `siteTwinCore.ts` (`inside` / `near` / `site` / `far`). HUD title: `UNIT 8A — Kyann Brooks · Paint · in unit`. Payload includes `setup` `{ pinned, unitCount, expectedUnits, liveGps }` so empty states can one-tap `POST /api/admin/accounts/:id/unit-map/grid` via `layoutUnitGrid`.
- Creating/updating a property with an address and no pin fires `geocodePropertyNow` (same Nominatim queue). Dropped pins still stamp `geocodedAt` and are never overwritten.
- Fractional unit boxes still follow `halo-unit-map-cms` (0..1, `normUnit`). Twin does not replace the Admin unit-map editor — it consumes it. Drag-to-place inside the twin reuses `PATCH /admin/accounts/:id/unit-map/units/:unitId`, converting latlng back to a bbox fraction; there is no twin-specific geometry endpoint.
- The site anchor is repositionable from inside the twin: HUD "Move pin" makes the lime anchor marker draggable (map clicks also place it) into a local draft, and an explicit "Save pin" POSTs the existing `/properties/:id/gps`. Everything downstream — footprint, bbox, unit boxes, crew snapping — re-derives from that anchor, so a mis-geocoded pin corrupts the whole plate; this is the repair path. Twin polling pauses during move mode so a refresh can't stomp the draft, and every exit (Cancel / Escape / close / toggle) is disabled while the save is in flight — the POST can't be recalled, so the UI must never imply it was discarded.
- Site Twin HUD kicker is LIVE / LAST SEEN / PIN GPS from ping freshness (5 min). Roster shows last-seen age. Empty plate is a count field (not a 3D-rotated form) and infers count from job unit numbers when `property.units` is empty. `onRequestGps` texts the crew from the twin.

## Rules that are easy to break

- **Never cap the twin's GPS reads globally.** Track points and check-ins must be scoped to the site (a padded bbox around it) UNION the crews assigned to live work here. A plain `ORDER BY created_at DESC LIMIT n` across all properties lets a busy sister property push this property's breadcrumbs out of the window, which reads on screen as "the crew vanished" — the exact failure the feature exists to prevent. The assigned-crew bucket must stay un-geofenced: that is how "assigned here but GPS says off-site" is detected.
- **Dwell must never bridge an off-site fix.** Jitter merging (a stray ping in the unit next door, a hallway gap) is intentional so a crew standing on a shared wall doesn't shred a two-hour stay into nothing. A `far` ping is different in kind — it means they left, and it hard-splits the visit. `firstSeenAt`/`lastSeenAt` are first/last **on-site** pings, because the roster prints them as an arrival time.
- **Unit state precedence is `blocked` over `active`.** A blocked unit is the fact the office must act on even while someone is standing in it.
- Photos anchor to a unit by where the phone was when the shutter fired; only photos with no fix fall back to the job's unit number.
- Floors are inferred from the unit label (`204` → 2, `1B` → 1), never stored. A bare single digit yields no floor — guessing would file it under a floor that may not exist.
- `invoices.amount` / `taxAmount` are DOLLARS here, not cents.
- `computeUnitStatuses` is imported from `routes/clientCms.ts` and memo-cached (~15s) because it sweeps every job/request/invoice/line item for the property and the twin polls every 8s.

## Client component

- `SiteTwin.tsx` is deliberately duplicated byte-for-byte in `halo` and `halo-desktop`, with an identical appended block in each `index.css`. It is NOT in `@workspace/board-ui` — that package ships no CSS and no Leaflet dependency. Patch one, copy to the other, `cmp` to prove it.
- The endpoint is intentionally absent from `openapi.yaml`; the component uses raw `fetch`, so there is no codegen step to run.
- Crew markers glide between polls by holding the react-leaflet `position` prop **frozen at mount** and moving the marker imperatively. Passing live coordinates to that prop makes react-leaflet snap the marker and the animation never runs.
- Freezing the poll (pin move / unit placement / replay scrubbing) only stops future refreshes. An in-flight fetch must also be retired by a generation counter, or it lands mid-drag and stomps the operator's work.
