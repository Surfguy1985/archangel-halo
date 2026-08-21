# Building-first Site Twin (no unit photo mapping)

## Truth model

1. **Property pin** → on-site / off-site  
2. **Building centroid** (1–20) → which building  
3. **Job.unitNo** → which unit (WO is truth)  
4. **Crew GPS** → presence + heat map  
5. **QR at breezeway** → hard building check-in  

## API

```bash
# Live plate
GET /api/properties/:id/building-ops

# QR payloads to print
GET /api/properties/:id/building-ops/qr

# Crew scan
POST /api/properties/:id/building-ops/checkin
{ "crewId": "...", "building": 12, "lat"?: n, "lng"?: n }
```

## Apply Thornbury layout first

```bash
curl -s -X POST "http://127.0.0.1:$PORT/api/settings/seed-thornbury-pulse"
curl -s "http://127.0.0.1:$PORT/api/properties/PROPERTY_ID/building-ops" | head -c 2000
```

## What you see

- `buildings[]` — 20 pins with lat/lng + unit catalog  
- `presence[]` — each crew: onSite, building, **unit from job**, title  
- `heat[]` — GPS density cells  
- `units[]` — status list from jobs (no geometry)  
- `byBuilding` — headcount per building  

## Why this is 10/10 for ops

Door-level unit polygons are optional. Wrong **property** and wrong **building** are the expensive mistakes — this stack catches both without tracing 300 units.
