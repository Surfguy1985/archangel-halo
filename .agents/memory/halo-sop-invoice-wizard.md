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
- "Create invoice from a job" (wizard) is a preview-only draft endpoint: pass 1 AI breakout + pass 2 independent AI audit (corrections applied) + deterministic applySopToInvoice preview; nothing persists — creation goes through the normal POST /invoices path so SOP/tax/ledger enforcement is never duplicated. Keep it that way for any new AI-drafting flow.
- SOP uploads accept PDF/image AND text (text/csv, text/plain): text docs are base64-decoded and sent to the text-JSON completion, not the image path — keep both branches when touching the upload route.
- Wizard draft is edited client-side (lines/notes) but creation still goes only through POST /invoices; post-create panel keeps the dialog open with an absolute `/api/invoices/:id/pdf` download link.
- Desktop: wizard dialog on PropertyDetail header; CreateInvoice shows banner, prefills, and blocks save when SOP requires a PO. Source doc link is absolute `/api/...` (never BASE_URL-prefixed).
