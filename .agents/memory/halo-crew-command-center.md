---
name: HALO crew command center map
description: Full-screen live crew map in halo-desktop + /crews/map endpoint rules
---
- GET /crews/map returns one pin per active crew: today's dispatch status (from schedules where scheduledOn = LOCAL today) + last checkin WITH coords via `SELECT DISTINCT ON (crew_id) ... ORDER BY crew_id, created_at DESC` — never a global row-limit scan, or crews with old checkins lose their pin.
- Route must stay registered BEFORE any `/crews/:id/*` handlers or express shadows it.
- CrewCommandCenter.tsx (halo-desktop) uses react-leaflet + OSM tiles; markers are `L.divIcon` raw HTML — ALL interpolated values (selfiePath, name initial) must be HTML-escaped (XSS sink).
- Overlay opens from Crews list + CrewDetail headers; pin/roster click panel sends messages via useSendCrewMessage.
- Crew invoice reject (`send_back`) REQUIRES a non-empty note server-side — any review UI must collect it or the action 400s.
- CrewDetail redesign must keep photo-share flows reachable (per-day "Share link to photos" + "Full report" with notes/PDF); these were silently dropped once in a restyle.
