---
name: HALO Developer Portal
description: Registry-driven docs site conventions for artifacts/devportal
---
The devportal (previewPath /devportal/) is frontend-only, no backend. All docs are markdown files in `artifacts/devportal/src/content/` registered in `registry.ts` (slug, title, category, description, markdown via `?raw` import).

**Rule:** to add a new uploaded doc, copy the .md into src/content/ and add one registry entry — never hardcode doc links or sections; nav, sidebar, search, and home grid all derive from the registry.

**Why:** the user will upload many docs over time; hardcoded links (like the original "/docs/billing-service" nav link) go stale.

**How to apply:** headings/TOC use a single shared slugify + extractText in Doc.tsx — keep TOC extraction and heading id generation in sync. Tailwind v4: `@apply ... !important` is invalid and 500s the dev server; don't use it.
