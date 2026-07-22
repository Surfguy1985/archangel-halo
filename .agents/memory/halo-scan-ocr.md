---
name: HALO scan/OCR pipeline
description: Rules for keeping the AI photo/PDF scanning accurate and reliable
---

Every scan entry point (receipt, check, import photo) must send images through the shared client-side `prepareScanImage` prep (downscale to ~2400px max edge, high-quality JPEG re-encode) — sending raw camera files caused 413s and poor reads, and re-encoding also normalizes odd camera formats.

Scanned/image-only PDFs get no selectable text from pdfjs; the Import flow must fall back to rendering pages to JPEG and OCR-ing them via `/ingest/scan` (threshold: <120 chars of extracted text).

**Why:** camera photos are 10–20MB HEIC/JPEG; the scan endpoints cap base64 at 14M chars and vision models read a properly downscaled sharp JPEG better than an oversized original.

**How to apply:** any new scan feature (client) imports the shared scanImage util in that app's `src/lib`; server-side AI calls go through `lib/ai.ts` which already retries transient provider failures and malformed JSON — don't add ad-hoc retry loops per route.
