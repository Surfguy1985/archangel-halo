---
name: HALO file ingest pipeline
description: Existing AI-based file-import backend that the frontend Import tool builds on
---

- HALO already has an AI-based ingest pipeline on the api-server: `POST /ingest/parse` (reads text/base64 content, uses Anthropic via `lib/ai.completeJson`, returns detected records) and `POST /ingest/commit` (inserts records into properties/jobs/invoices/expenses/inventory). Generated hooks: `useParseIngest`, `useCommitIngest`.
- **Why:** When asked to build a "file import tool that places info where it goes", the backend + AI extraction already existed — only a frontend was missing. Don't rebuild the parser.
- **How to apply:** For import/parsing features, reuse `/ingest/*`. It expects text content; the frontend must extract text first. PDFs are handled client-side via `pdfjs-dist` (see `artifacts/halo/src/lib/extractText.ts`) and sent as `text/plain`; the backend's `decodeContent` base64-decodes non-text mimetypes to utf-8, which produces garbage for real binaries — so always send extracted text, not raw binary.
- Commit is now transactional (all-or-nothing) and never skips records for unknown properties: it fuzzy-matches property names (exact → unique substring → unique token-overlap ≥0.6; ambiguity = no match) and auto-creates missing properties (or "Unassigned Imports" when no name). Properties commit before jobs/invoices so same-file linking works.
- `POST /ingest/scan` (vision OCR) accepts image/jpeg|png|webp|gif AND application/pdf (PDF goes to Anthropic as a `document` block). Desktop clients normalize arbitrary photos (HEIC, oversized) to a downscaled JPEG via canvas before sending; unreadable files must surface a visible error + manual-amount fallback, never a silent catch.
- Original uploaded documents are stored via `/api/storage/uploads/request-url` + PUT before commit; commit records an `import_uploads` history row (surfaced by `GET /ingest/history`). If the file upload fails, the client blocks the commit — no silent fallback.
