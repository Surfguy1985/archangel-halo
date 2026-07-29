---
name: HALO client dashboard board
description: Client-facing kanban PWA artifact — session auth, card projection, action registry conventions
---

# HALO client dashboard (artifact `client-dashboard`, preview `/dashboard/`)

- Entry is `/dashboard/:dashboardToken` (client_accounts.dashboardToken). The halo root app redirects bare `/client/:token` → `/dashboard/:token`; `/client/:token/admin` and `/requests` stay on the halo app. Admin onboarding links are built by `dashboardUrl()` in admin.ts — change it there, not per-callsite.
- **Auth**: stateless HMAC session tokens (`userId.exp.sig`, signed with SESSION_SECRET) issued by `/client/:token/board/login`, sent as `Authorization: Bearer` via `setAuthTokenGetter` in the shared api client. No session in query/body — mixing path+query params for the same op caused an orval TS2308 export collision.
  **Why:** orval generates colliding names when an operation mixes param styles no other op uses.
- **Board projection** (`clientBoard.ts`): HALO cards are computed on every read from jobs/invoices/crews/work_requests; `client_board_cards` stores only client edits — `kind=custom` rows are real cards, `kind=override` rows hold lane/position/notes for HALO cards (unique on propertyId+cardKey, upsert on move). Never persist HALO-derived fields.
- **Action registry**: every board button dispatches a named action to `/board/actions`; guards return `{blocked:true, reason}` (200, not error) and ALL dispatches — ok, blocked, failed — are audited to `client_board_actions`. Clients can never move job/invoice cards to Done; HALO state wins on next poll.
- Guest (no session) is read-only; seated `role=guest` users are also read-only. Writes gate via `requireWriter`, not per-route ad-hoc checks.
- Tracker links are root-relative `/track/:token` (halo mobile app at domain root serves them); photos/selfies/logo are absolute `/api/storage...`.

**Card template anatomy:** all board cards follow the uploaded 9-region template (fixed 340×430 frame, SLA heat rail, identity row, metric triad, evidence block, two decision buttons, footer); spec distilled in `client-dashboard/src/components/kanban/templateSpec.ts`; lane pipelines mirror the JSON template keys (work_order, make_ready, invoice, vendor_crew_live).

**Two board systems coexist:** the office "raise card" feed (table `client_board_cards` in clients.ts, API `/client/{token}/board/feed`, opIds `getClientBoardFeed`/`updateClientBoardFeedCard`, `ClientBoardFeed*` schemas, halo page) is separate from the client dashboard board (tables `client_dashboard_cards`/`client_dashboard_actions`, API `/client/{token}/board*`). Don't collapse or rename one into the other — both names are deliberate to avoid openapi/schema/table collisions.

## Card reordering (drop-position)
- `card.moved` payload may carry `orderedCardKeys` (full target-lane order after drop); server sets position=index for every card in it. Moved card's `position` is the literal drop index.
- Neighbor re-index writes are position-ONLY overrides (lane stays null) so HALO keeps recomputing lanes for cards the client never moved.
- The "can't drag into Done" guards allow same-lane reorder: `cardCurrentlyInDone` checks override lane, else computed lane (jobLane / invoice paid).
- Client computes drop index from card midpoints via getBoundingClientRect (shared by desktop drop + touch drag).
