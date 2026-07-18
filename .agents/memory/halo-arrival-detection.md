---
name: HALO on-site arrival detection
description: Owner-phone geofencing that prompts an AI job-start flow when arriving at a property
---
- Properties carry latitude/longitude, geocoded lazily from address via Nominatim (1 req/sec queue, failures stamped geocodedAt for 7-day retry). Geocoding must run in the BACKGROUND — never block the arrival-check request on it.
- Arrival check matches within 250m (haversine) and asks the AI for headline/message/job ideas with a static fallback; it must never fail the request when AI is down.
- Dedup lives in TWO places by design: client localStorage cooldown (per property, 4h, controls the prompt) AND server-side activity dedupe (per owner+property, 4h) so multiple devices/cleared storage can't spam the activity feed.
- Client watcher: enable flag + owner name in localStorage; changes broadcast via a window event so the geolocation watch starts/stops immediately — reading the flag once at mount is a privacy bug (watch keeps running after disable).
- Testing path: properties can be created with pinned lat/lng (server rejects partial pairs, stamps geocodedAt so the geocoder won't overwrite); Settings has a "Test it now" button that checks current position immediately and intentionally bypasses the client cooldown.
- It's per-phone opt-in (no accounts): each owner enables it in Settings on their own device. PWA limitation: location only watched while the app is open — no true background geofencing.
**Why:** unauthenticated single-org app; device-local identity is the only owner signal.
