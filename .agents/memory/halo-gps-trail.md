---
name: HALO crew GPS trail
description: 30s breadcrumb pings + green trail on maps + after-photos checkout gate
---
- crew_track_points table stores 30s GPS pings; written only via POST /portal/:token/track-points, which 409s unless the crew's latest check-in is today (local day) and open. jobId is ALWAYS taken from the open check-in — never trust a client-supplied jobId (wrong-job breadcrumbs leak location to another client's map).
- **Why:** trail points feed client-visible maps; misattribution is a privacy leak. 409 doubles as the "stop pinging" signal to the portal loop.
- Trails are "today"-scoped everywhere; the single day basis is Node-local midnight passed as a SQL param — never date_trunc('day', now()) in SQL (DB session tz can differ).
- Reads: /track/:token (trail field), /crews/map (per-crew trail + pin follows freshest breadcrumb), /client/:token/board/map (per-job trail). Green polyline #16a34a in TrackerMap, CrewCommandCenter, client map + Birdseye.
- Portal ping loop lives in CheckinTab: localStorage halo_gps_trail_<token> resumes across reloads, stops on checkout/409/404/day change. PWA limitation: pings only while portal page is open.
- Checkout is gated server-side: kind=checkout 409s (code after_photos_required) unless crew_photos has phase='after' for the job (explicit jobId or the open check-in's job).
- Retention: scheduler purges points >30 days every 6h; table indexed on (job_id,created_at), (crew_id,created_at), (created_at). Rate limit limits.trackPoint.
- New schema table checklist honored: settings reset list + job/crew delete cascades include crew_track_points.
