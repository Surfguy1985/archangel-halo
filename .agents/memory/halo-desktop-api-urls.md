---
name: HALO desktop artifact API/asset URLs
description: How manual /api links must be built in the desktop artifact vs the mobile one (BASE_URL differs).
---

The desktop artifact (`artifacts/halo-desktop`) serves under BASE_URL `/desktop/`, while mobile (`artifacts/halo`) serves under `/`.

Rule: manual `<a href>` links to backend assets (storage files, PDFs — e.g. `/api/storage${path}`, `/api/invoices/:id/pdf`, `/api/packets/...`) must be ABSOLUTE `/api/...`, never prefixed with `import.meta.env.BASE_URL`.

**Why:** The generated `@workspace/api-client-react` uses relative `/api` and there is NO vite proxy; the platform proxy routes origin `/api` to the API server regardless of artifact. In mobile, `BASE_URL.replace(/\/$/,"")` yields `""`, so `${base}/api/...` happened to be absolute. On desktop it yields `/desktop`, so `${base}/api/...` becomes `/desktop/api/...` which hits the desktop vite server (404), not the API.

**How to apply:** When copying portal/detail pages from mobile to desktop, strip any `${base}`/BASE_URL prefix on `/api/...` asset links. Keep BASE_URL ONLY for in-app route links (e.g. building the crew portal URL `${origin}${base}/portal/${token}`), since those routes live inside the desktop app.
