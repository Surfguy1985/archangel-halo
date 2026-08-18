---
name: HALO Property Pulse
description: One map HUD, three desks — Portfolio (corporate), Pulse (PM), Punchlist (Archangel Contractors).
---

HALO is **one system, three desks**. Every desk is a live Carto map plus **three cards** and the lime Ask HALO pill. Header tiles are real portraits (Camille Hart / Elena Ruiz / Marcus Hale).

| Desk | Who | Cards | Desktop | Mobile |
|---|---|---|---|---|
| Property Portfolio | Corporate | Overview · Sites · Reports | `/` | `/property-portfolio` |
| Property Pulse | Property manager | Overview · POs · Vendors | `/pulse` | `/pulse` |
| Property Punchlist | Archangel Contractors | Overview · Sites · Crew (QR paycards) | `/punchlist` | `/punchlist` |

**Corporate** cares about the board pack: vacancy $ (client-board clock, one formula), typical turn days, CSV export, Present. Not crew tools.

**Pulse** cares about the morning: active units, POs (enter missing numbers by unit — stamps the job, texts the crew, and writes the PO into Base44 dispatch/field), time per turn, callbacks, vendors.

**Punchlist** is the field desk: where to go (map + sites), printed QR paycards per crew member, live green pins on check-in. Punch itself stays in Work. Each crew card is a paycard — they scan, log the unit, take before/after photos, and check out to get paid.

Map shows every community (real lat/lng, else city pin) and crew (live GPS when present, plus on-the-book demo dots). Solid lime/gold dots = live GPS; dashed = demo fill so a presentation is never an empty map.

`/portfolio` stays Client Portfolio Pulse. Do not wrap these HUDs in DesktopLayout. Lime `#B4FF44`. Outfit + Plus Jakarta Sans.
