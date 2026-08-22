# HALO Live — premium production surface

**DoorDash × Turo × Airbnb** energy for property make-ready ops.

## Product

| Surface | Pattern | Who |
|---------|---------|-----|
| **Live Map** | DoorDash full-bleed map + status sheet | Portfolio / Pulse / Punchlist |
| **Field guide** | Turo screen-by-screen photo coaching | Crew |
| **Messages** | Unit-tied live board | Everyone on the turn |
| **Landing** | Premium marketing | Public |

**One shared map.** Same `building-ops` plate. Role gates hide vendor money from Portfolio/Pulse.

## Design references (Mobbin)

- DoorDash live tracking bottom sheet + map pins
- Turo guided photo steps (N of M, one primary CTA)
- Airbnb map + card clarity

## Run

```bash
pnpm --filter @workspace/halo-live install   # if needed
pnpm --filter @workspace/halo-live dev      # :5177
```

Proxies `/api` → `HALO_API_PROXY` or `https://archangel-halo.replit.app`.

## API wiring

- `GET /api/properties/:id/building-ops` — plate, crew GPS, radar, photos
- `POST /api/properties/:id/selection` — shared focus
- Field submit → existing work-reviews / Base44 log-work (next wire)

## Photos

Landing uses **Unsplash** CDN URLs (free, attributed via Unsplash license).  
Production can swap to **Shutterstock Free API** (3M images, 500 licenses/mo test tier) via `SHUTTERSTOCK_API_TOKEN`.

## Brand

- Ink `#0A0F0C` · Lime `#B4FF44` · HALO logo asset
- DM Sans + Instrument Serif

## Not deleted

Legacy `halo`, `halo-desktop`, `halo-crew` remain. This is the **new** production UX fork inside the monorepo.
