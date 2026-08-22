# Site Twin priorities 1–5 (shipped)

## 1. MapKit shell
`ios/HaloSiteMap/` — buildings, crew, units, money colors, turn radar, selection POST.

## 2. Unity OSM footprints
`OsmFootprintLoader` — real Overpass meshes (needs Replit OSM routes live).

## 3. Shared selection
```
GET/POST /api/properties/:id/selection
GET /api/properties/:id/selection/stream
```
Deep link: `halo://site/{propertyId}?building=12`

## 4. Money tint
Plate includes `moneyTint` + `buildings[].risk` = clean | watch | hot  
Unity `SiteTwinLayersRenderer` colors buildings; MapKit marker tint matches.

## 5. Turn radar + photo billboards
Plate: `turnRadar[]`, `photoBillboards[]`  
Unity: radar cylinders + photo quads on buildings.

## Replit
```bash
git fetch origin && git reset --hard origin/main
pnpm --filter @workspace/api-server run build
# Restart API
curl -s localhost:5000/api/properties/$PROP/building-ops | head -c 500
```

## Plate fields (new)
moneyTint, turnRadar, photoBillboards, layerSummary, selection, buildings.risk
