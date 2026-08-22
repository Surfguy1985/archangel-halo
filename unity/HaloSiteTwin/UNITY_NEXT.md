# Unity — next: real OSM footprints

## What changed
`OsmFootprintLoader` pulls **real building outlines** from:

```
GET {apiBase}/api/osm/buildings/thornbury
```

(Overpass bulk via Halo — no hand mapping.)

Extrudes each polygon into a 3D mesh, labels it, fits the camera, and can hide the old grid.

## On your Mac

```bash
cd ~/archangel-halo
git pull
# → latest with OsmFootprintLoader
```

Copy scripts into Unity project:

```text
unity/HaloSiteTwin/Assets/Scripts  →  YourProject/Assets/Scripts
```

In Unity:

1. **Halo → Setup Site Twin Scene** (adds OsmFootprintLoader)
2. **Play**
3. Console: `[Halo OSM] Loaded N footprints…`
4. Real building shapes instead of abstract cubes

## Manual

Select `HaloSiteTwin` → **Osm Footprint Loader** → ⋮ → **Reload OSM Footprints**

## Requirements

- Halo API running with commit `7b3b660+` (OSM routes)
- Production: `https://archangel-halo.replit.app/api/osm/buildings/thornbury`
- Overpass reachable from the API server (may take 10–30s first call)

## Grid vs OSM

| Mode | Component |
|------|-----------|
| Abstract 20 cubes | SiteTwinRenderer (`useGridLayout`) |
| Real OSM outlines | OsmFootprintLoader |

Both can run; loader hides grid when footprints succeed (`replaceGridWhenLoaded`).
