---
name: HALO property hero images
description: AI-generated property card images — generation flow, cost guards, and display URL rules.
---

Property cards (mobile + desktop) show full-bleed AI hero images generated at runtime with gpt-image-1 via the Replit OpenAI AI-integrations proxy (`@workspace/integrations-openai-ai-server`, billed to user credits — no Google Maps/Street View key exists; images are prompt-built from name/address/city/units).

**Rules:**
- Generation is server-side: `POST /properties/:id/image` uploads the PNG to private object storage via presigned PUT and stores `imagePath` (`/objects/uploads/<uuid>`) on the property. Display URL is `/api/storage${imagePath}` (absolute, both apps).
- **Cost guards — keep all three:** server skips if `imagePath` already set; per-process `imageInFlight` Set dedupes concurrent calls; clients request at most once per mount via a ref Set. Removing any of these causes repeated paid generations.
- Property create fires generation in the background (fire-and-forget, never blocks the 201).
- **Why:** each generation is a paid API call (~15–60s); accidental regeneration loops are real money.
- **How to apply:** any new surface that renders properties without images should reuse the auto-generate hook pattern, not add server-side auto-triggers.
