---
name: HALO Property Pulse
description: Optional tablet dashboard at /pulse matching the Property Pulse seed; live HALO + Base44 + Twilio SMS.
---

- `/pulse` is the Figma Make HUD ([Design Halo Interface](https://www.figma.com/make/yNS3Pu0b9cSzEO0k16cI4l/Design-Halo-Interface--Copy-?t=JesuQqT9qSIV1dlR-1)): navy header + left rail + full-bleed Carto Voyager map. HALO chat stays at `/`. Do not wrap Pulse in DesktopLayout/OpsLayout.
- **Tabs do not navigate.** Each rail tab (Overview, Sites, Crew, Schedule, Units, Calendar, Activity, Settings) toggles a draggable, resizable, hideable box over the map. Positions persist in `halo_pulse_hud_v1`; open set in `halo_pulse_hud_open_v1`. Multiple boxes can be open at once.
- Boxes are wired to live HALO: properties/jobs/crew GPS/Today feed/notifications/Twilio/Base44 sync. Dispatch in the header still routes to job board. GPS Finder + Site Twin remain full-screen overlays from Overview/Settings.
- Lime is `#B4FF44`. Fonts stay Outfit + Plus Jakarta Sans. Map pins are lime teardrops when a site is live.
- Ranking/copy lives in `artifacts/api-server/src/lib/pulseCore.ts`. Duplicate UI in `artifacts/halo` and `artifacts/halo-desktop`.
