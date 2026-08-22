# Halo Site Map (MapKit) — Priority 1

Native iOS shell for field + PM:

- Live buildings (money tint colors)
- On-site crew pins
- Turn radar (aging / overdue)
- Unit list → posts shared selection (Unity/office follows)

## Setup

1. Xcode → New iOS App → replace with these sources under `HaloSiteMap/`
2. Set `HaloAPI.shared.apiBase` / `propertyId` if needed
3. Info.plist: location usage if you add user tracking later
4. Run on device / simulator

## API

- `GET /api/properties/:id/building-ops` — plate + layers
- `POST /api/properties/:id/selection` — sync with Unity
