---
name: HALO shared crew map pins
description: One shared crew pin component backs all six HALO maps; it takes a normalized shape, not a raw API payload.
---

Every map that shows checked-in crews (office Pulse on mobile + desktop, the desktop crew
command center, and the three client-dashboard map surfaces) renders the SAME pin component
from `@workspace/board-ui`. Do not hand-roll another `divIcon` crew marker.

The component takes a **normalized pin shape**, never a raw payload. Each caller converts its
own payload with an adapter (office map pins, client board crews, and the Pulse intel crews —
which include fabricated demo pins). When a new map surface appears, write an adapter; don't
widen the component to accept a new payload union.

**Why:** the six maps had drifted into six different marker implementations with different
sizes, colors, escaping, and popup content, so a fix to one never reached the others. Feeding
the component raw payloads would recreate that drift inside the shared file.

**How to apply:**
- Pin HTML is built as an interpolated string for Leaflet, so every value (crew name, unit,
  selfie URL) must stay HTML-escaped. Crew names and unit labels are user input.
- Surfaces that open their own detail sheet pass `popup={false}` plus `onSelect`; surfaces
  with extra content (e.g. a Live Tracker link) pass it as popup children.
- Client-facing maps must stay minimal — identity, unit, service, contractor, on-site status.
  No phone/email, no GPS trail on the embedded property card.

## Contractor identity

`crews.company` is nullable: **null means in-house**, and the label falls back to the business
settings company name, then to a hardcoded default. A subcontractor carries their own company
name. Resolve the label server-side (both the office and client map endpoints) so all pins
agree; never derive it in the client.

The service line on a pin is also resolved server-side and is deliberately ONE short line:
first incomplete job line item (with a `+N` suffix), else first item, else truncated job
description, else the crew's trade, else nothing.
