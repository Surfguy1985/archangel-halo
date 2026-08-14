---
name: HALO GPS Finder + Site Twin
description: Address/drop-pin GPS lock per property; isometric unit plate that snaps crew phone GPS to an apartment with a live title.
---

- GPS Finder lives in Add/Edit property and Pulse (map pin FAB). Search is `GET /api/geo/search?q=`; reverse is existing `GET /api/geo/reverse`. Locking a site is `POST /api/properties/:id/gps` which stamps `geocodedAt` so the background Nominatim job never overwrites a dropped pin.
- Nominatim 1 req/sec is shared in `geocode.ts` (search + reverse + lazy address geocode). Do not add a second Nominatim queue.
- Site Twin is `GET /api/properties/:id/site-twin`: OSM building footprint via Overpass (cached 1h), unit boxes from `property_units` georeferenced onto that bbox, crew GPS from today's track points + last check-in, snapped with `siteTwinCore.ts` (`inside` / `near` / `site` / `far`). HUD title: `UNIT 8A — Kyann Brooks · Paint · in unit`. Payload includes `setup` `{ pinned, unitCount, expectedUnits, liveGps }` so empty states can one-tap `POST /api/admin/accounts/:id/unit-map/grid` via `layoutUnitGrid`.
- Creating/updating a property with an address and no pin fires `geocodePropertyNow` (same Nominatim queue). Dropped pins still stamp `geocodedAt` and are never overwritten.
- Fractional unit boxes still follow `halo-unit-map-cms` (0..1, `normUnit`). Twin does not replace the Admin unit-map editor — it consumes it.
- The site anchor is repositionable from inside the twin: HUD "Move pin" makes the lime anchor marker draggable (map clicks also place it) into a local draft, and an explicit "Save pin" POSTs the existing `/properties/:id/gps`. Everything downstream — footprint, bbox, unit boxes, crew snapping — re-derives from that anchor, so a mis-geocoded pin corrupts the whole plate; this is the repair path. Twin polling pauses during move mode so a refresh can't stomp the draft, and every exit (Cancel / Escape / close / toggle) is disabled while the save is in flight — the POST can't be recalled, so the UI must never imply it was discarded.
- Site Twin HUD kicker is LIVE / LAST SEEN / PIN GPS from ping freshness (5 min). Roster shows last-seen age. Empty plate is a count field (not a 3D-rotated form) and infers count from job unit numbers when `property.units` is empty. `onRequestGps` texts the crew from the twin.
