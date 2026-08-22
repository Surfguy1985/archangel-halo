# OSM → Halo Building 1–20 (auto match)

```bash
curl -s "http://127.0.0.1:5000/api/osm/buildings/matched" | head -c 1200
curl -s "http://127.0.0.1:5000/api/properties/PROPERTY_ID/osm-buildings/matched"
```

Each match: `building`, `label`, `ring`, `centroid`, `confidence`, `distanceM`.

Algorithm: nearest OSM footprint to each Halo building centroid within 90m (configurable `?maxMeters=`).

No hand labeling in iD required for Bldg numbers.
