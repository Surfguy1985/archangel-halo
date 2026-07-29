---
name: HALO SOP Invoice Wizard
description: Per-property SOP billing rules extracted by AI and enforced on every invoice create path.
---

One SOP rule per property (unique propertyId), extracted by AI from an uploaded PDF/image and stored with the base64 source doc in the DB.

**Enforcement is server-side and central**: `applySopToInvoice(propertyId, draft)` in the SOP route module is the single helper — every invoice creation path (REST POST /invoices, voice tool) must call it, and any new invoice-creating path must too. Historical imports (/ingest/commit) intentionally skip it. Explicit user-supplied values always win; SOP only rejects (missing PO → 400) or fills blanks.

**Why:** the product promise is "every invoice for the property follows the rule regardless of which button created it"; enforcing in the UI alone would leak.

**How to apply:**
- Discriminated return `{ok:false,error}` vs `{ok:true,...fills}` — callers 400/skip on !ok.
- `{SEQ}` numbering is max-based per property against the format regex (deletions/concurrency safe-ish), mirroring the global INV max-based rule.
- SOP tax must stay tax-inclusive (`total*r/(1+r)`) to match resolveTaxAmount.
- Upload route needs the 15mb JSON parser allowlist in app.ts (global limit is 2mb).
- Table must stay in the Settings reset delete list.
- Desktop: wizard dialog on PropertyDetail header; CreateInvoice shows banner, prefills, and blocks save when SOP requires a PO. Source doc link is absolute `/api/...` (never BASE_URL-prefixed).
