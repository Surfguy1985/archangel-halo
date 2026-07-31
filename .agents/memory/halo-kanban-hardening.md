---
name: HALO kanban hardening pack
description: Board contract enums/unions, ModuleBoundary, useBoardEvents SSE hook, client session cookie, rate limits — invariants after the Jul 2026 hardening integration.
---

# Kanban hardening (client + office boards)

- openapi.yaml now has REAL enums for card `kind`/`column`, an 11-way `ClientCardModule` discriminated oneOf, and a 5-way `ClientBoardCardActionBody` union. Any new module type or action MUST be added to the spec + regenerated (orval), or server Zod parsing rejects it. The `refer` variant carries `note` (we added it back — the pack dropped it but the referral form sends it).
- Board SSE on both apps goes through `useBoardEvents` from @workspace/board-ui (reconnect/backoff/visibility pause/refetch-on-open). Don't hand-roll EventSource effects for board streams.
- Card module surfaces (metrics/evidence/decision) are wrapped in `ModuleBoundary` (zod validation + error boundary). Unknown module types render a graceful face; keep new renderers inside the boundary and add their schema to moduleSchemas.ts.
- Templates: `resolveTemplate(key, audience)` — `unit_turnover` and `blank` exist in BOTH PM and vendor catalogs; always pass audience ('pm'|'vendor'). Dev-mode duplicate-key guard logs collisions.
- board-ui is browser-only: never reference `process` directly (use `(globalThis as any).process?.env`), zod is a dependency.
- Server: `POST /client/:token/session` mints an httpOnly HMAC cookie (SESSION_SECRET); `clientAuth` middleware on `/client/:token` prefers cookie, but MUST pass through (next()) when the token doesn't resolve — some /client routes serve paused accounts (billing resume). STRICT_MODE is off; flipping it requires auditing those routes.
- Rate limits (in-memory, src/lib/rateLimit.ts): login 5/min, cardAction 30/min, session 10/min, bank 5/min, pay 10/min — pay limiter applies to MUTATING methods only; GET /pay pages must stay unthrottled (shared-IP 429 regression otherwise).
- pino logger redacts token path segments (client/portal/pay/track/... /<redacted>). Keep new tokened route prefixes in that regex.
- Deliberately NOT integrated: the pack's transactional outbox (server/board-events.ts in /tmp pack + repo attached_assets zip) — overlaps the existing "multi-server live updates" project task; current emitBoardEvent is in-process.
- Dev proxy rewrites cookie SameSite=Strict → None; origin sets Strict (verified via localhost).
- The old local client-dashboard copy of apple-board/ was dead code and was deleted; kanban/BoardCardModules local copy is still live and must stay in sync with lib/board-ui.
