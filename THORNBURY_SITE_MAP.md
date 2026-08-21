# Thornbury at Chase Oaks — unit site map

Built from the leasing office wall maps (buildings **1–20** + unit numbers).

## What this does

1. Seeds **every unit label** onto `property_units` with fractional x/y on the site plate
2. Site Twin snaps **live crew GPS** to the nearest unit box
3. Pulse / map views can show which unit a crew is in

## Apply on Replit

```bash
# Find Thornbury property id
curl -s http://127.0.0.1:$PORT/api/portfolio/home | head -c 1500

# Or re-run full pulse seed (also applies layout)
curl -s -X POST http://127.0.0.1:$PORT/api/settings/seed-thornbury-pulse

# Or apply layout only to a property UUID
curl -s -X POST http://127.0.0.1:$PORT/api/properties/PROPERTY_UUID/apply-thornbury-site-plan
```

## Open Site Twin (desktop)

Property detail → **Site Twin** (or property pulse with map).

Live crew dots snap to unit plates using GPS + the layout.

## Source maps

- Overview: Thornbury at Chase Oaks site board
- Buildings 1–20 close-ups with unit numbers
- Leasing office **7101**, Chase Oaks Boulevard / Oak Ridge Drive

## Accuracy note

Building centroids are traced from the overview photo. Unit packing inside each building is grid-based from the close-ups. For survey-grade GPS, refine centroids after one field walk with crew pins.
