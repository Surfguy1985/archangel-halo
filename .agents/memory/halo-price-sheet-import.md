---
name: HALO price-sheet import
description: Per-property AI price-sheet import (extract + bulk upsert) and its client file-prep chain
---

Property price books can be filled by uploading a price sheet (PDF/CSV/image) on the property page.

- `/properties/:id/price-items/extract` AI-reads text OR base64 image/PDF into review rows; lines priced "BID/quote/TBD" come back `bidOnly: true` with `rate: null` and default to unchecked in the review UI.
- `/properties/:id/price-items/bulk` upserts by normalized service name inside one transaction (existing service → rate/unit/detail update, never a duplicate row).

**Why:** review-then-confirm was required; silent duplicates in the price book make invoice autofill unpredictable.

**How to apply:** any new upload entry point must reuse the client prep chain from the Import page: images → `prepareScanImage`, PDFs → `extractFileText` then `renderPdfPages` OCR fallback when selectable text < ~120 chars (per-page extract calls, merge rows). Don't send raw binaries as "content".
