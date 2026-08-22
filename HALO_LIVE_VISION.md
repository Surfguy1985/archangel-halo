# HALO Live — product rethink (saved)

## Prior work preserved (do not delete)

- Site Twin / building-ops plate, money tint, turn radar, photo billboards
- OSM bulk + matched Bldg 1–20 footprints
- Unity Site Twin + MCP bridge
- MapKit shell sources
- Vapi field verify, Site Ops Bot, Money Lock, work-reviews
- Base44 log-work → HALO review path
- Role rule: Portfolio + Pulse never see vendor money / crew payouts

## New production surface: `artifacts/halo-live`

Completely different UX — **DoorDash live map + Turo photo guide + Airbnb calm**.

### Shared Live Map (core)

One map both property and vendor use:

- Full-bleed dark map (DoorDash)
- Floating status sheet: headline, on-site crew, turn radar
- Building risk pins (clean / watch / hot)
- Crew GPS pins
- Role chip: portfolio | pulse | punchlist
- Money callouts only when role=punchlist

### Field app

Turo-style guided flow:

1. Get ready  
2. Before photos (camera / gallery)  
3. Services notes  
4. After photos  
5. Review → submit into HALO/Base44 path  

### Messages

Unit-scoped live board (not a separate tool).

### Marketing landing

Premium hero + product pillars; free stock via Unsplash (Shutterstock Free API optional for prod).

## Mobbin anchors

- https://mobbin.com — DoorDash tracking sheets
- Turo “Car photos” N of M guided camera
- Airbnb map + listing clarity

## How to run

```bash
pnpm --filter @workspace/halo-live dev
```

## Branch / fork note

Shipped as monorepo package `halo-live` (production UX fork). Legacy apps intact.
GitHub branch can be cut as `halo-live` from this commit for isolation.
