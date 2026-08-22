# OSM bulk buildings — no hand mapping

## Why
Hand-editing each building in iD (`.osc`) does not scale. Halo pulls **all** `building=*` footprints in a bbox from OpenStreetMap via Overpass.

## Endpoints

```bash
# Thornbury / Watters Creek preset
curl -s "https://archangel-halo.replit.app/api/osm/buildings/thornbury" | head -c 800

# Property-centered bbox
curl -s "https://archangel-halo.replit.app/api/properties/49dec4b1-1dc5-4b59-8025-0c0bc14d35ce/osm-buildings"

# Custom bbox
curl -s "https://archangel-halo.replit.app/api/osm/buildings?south=33.0705&west=-96.6975&north=33.0755&east=-96.692"

# GeoJSON only
curl -s "https://archangel-halo.replit.app/api/osm/buildings?south=33.0705&west=-96.6975&north=33.0755&east=-96.692&format=geojson"
```

## Response
- `buildings[]` — id, name, levels, flats, ring, centroid, area
- `geojson` — FeatureCollection polygons for MapKit / Unity / QGIS

## Workflow
1. Call `/osm/buildings/thornbury` once
2. Match largest footprints → your Bldg 1–20 labels (optional)
3. Keep unit lists in Halo (your `building:flats` data)
4. No more one-by-one iD edits

## Overpass turbo (manual check)
https://overpass-turbo.eu — paste the query from `osmBuildings.ts`
