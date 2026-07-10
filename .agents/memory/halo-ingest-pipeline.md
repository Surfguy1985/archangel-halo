---
name: HALO file ingest pipeline
description: Existing AI-based file-import backend that the frontend Import tool builds on
---

- HALO already has an AI-based ingest pipeline on the api-server: `POST /ingest/parse` (reads text/base64 content, uses Anthropic via `lib/ai.completeJson`, returns detected records) and `POST /ingest/commit` (inserts records into properties/jobs/invoices/expenses/inventory). Generated hooks: `useParseIngest`, `useCommitIngest`.
- **Why:** When asked to build a "file import tool that places info where it goes", the backend + AI extraction already existed — only a frontend was missing. Don't rebuild the parser.
- **How to apply:** For import/parsing features, reuse `/ingest/*`. It expects text content; the frontend must extract text first. PDFs are handled client-side via `pdfjs-dist` (see `artifacts/halo/src/lib/extractText.ts`) and sent as `text/plain`; the backend's `decodeContent` base64-decodes non-text mimetypes to utf-8, which produces garbage for real binaries — so always send extracted text, not raw binary.
