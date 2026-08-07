---
name: HALO Crew GPS sentinel
description: AsyncStorage sentinel pattern preventing ghost location pings after crew checkout / force-quit / app restart in the Expo crew app.
---

# HALO Crew GPS sentinel

## The rule
The background GPS task (`halo-crew-bg-location`) MUST check `AsyncStorage.getItem('halo_gps_active')` === `'1'` before sending any location data. If the sentinel is absent or not `'1'`, return immediately without sending or buffering.

**Why:** On iOS/Android, force-quitting the app while checked in leaves the OS task registered. On next launch, if the crew is not checked in, the task fires anyway and posts stale location data under their token. The sentinel is the only reliable cross-restart coordination point.

## Lifecycle
- **Sentinel set** (`'1'`): just before `startLocationUpdatesAsync` is called (inside `start()` in `useGpsTracker`)
- **Sentinel cleared**: in `stopBgTask()` — called from the `!tracking` branch AND the `useEffect` cleanup on unmount. Cleared BEFORE `stopLocationUpdatesAsync` so any in-flight callback sees it immediately.

## Keys involved
- `halo_gps_active` — sentinel (this file's concern)
- `halo_crew_token` — read by background task to identify the crew
- `halo_gps_buffer` — offline coordinate buffer flushed by foreground

## How to apply
Any future change to GPS start/stop flow must:
1. Keep the sentinel write BEFORE `startLocationUpdatesAsync`
2. Keep the sentinel clear BEFORE `stopLocationUpdatesAsync`
3. Keep the sentinel check at the TOP of the background task handler, before token read
