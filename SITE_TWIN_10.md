# Site Twin 10/10 — Thornbury pipeline

## Stack (honest)

| Layer | Tool | Role |
|-------|------|------|
| **Unit labels** | Leasing board photos (already extracted) | Every unit number 1–20 |
| **Georef** | QGIS Georeferencer (open source) + our affine GCPs | Image → WGS84 |
| **CAD (optional)** | LibreCAD / OpenPlan3D / VTracer | Vector buildings DXF/SVG |
| **Live GPS** | Halo Site Twin `snapGpsToFloor` | Crew pins → unit boxes |
| **Hugging Face** | Raster2Seq, planparser, YOLO walls | **Interior** plans only — *not* multi-building site boards |

Hugging Face floorplan models detect rooms/furniture on single-apartment drawings.
Thornbury’s wall map is a **site plan** (20 buildings). Correct path is **georeference + labeled units**, not HF room segmentation.

## Activate

```bash
git fetch origin && git reset --hard origin/main
pnpm --filter @workspace/api-server run build
# Run / Redeploy

curl -s -X POST "http://127.0.0.1:$PORT/api/settings/seed-thornbury-pulse"
# or
curl -s -X POST "http://127.0.0.1:$PORT/api/properties/PROPERTY_UUID/apply-thornbury-site-plan"
curl -s "http://127.0.0.1:$PORT/api/properties/PROPERTY_UUID/site-plan-georef"
```

Open **Site Twin** on the property — unit plate + live crew GPS.

## QGIS refinement (survey-grade)

1. Install [QGIS](https://qgis.org) (free, open source).
2. Raster → Georeferencer → load overview board photo.
3. Add 4+ control points against satellite / OSM (leasing office, street corners).
4. Export GeoTIFF; note corner lat/lng.
5. Update `THORNBURY_GCPS` in `thornburySitePlan.ts` with those points.
6. Re-run `apply-thornbury-site-plan`.

## Autodesk

If you have Civil 3D / AutoCAD Map: attach the board as underlay, set geographic location, export unit centroids as CSV (label, lat, lng) — we can ingest that next.

## Live crew GPS

Already connected:
- `crew_checkins` + `crew_track_points`
- Site Twin polls → `snapGpsToFloor` → unit confidence `inside | near | site | far`

Field calibration: stand in unit 1224 with portal open; confirm snap reads 1224.
