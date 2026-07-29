---
name: HALO client board pipeline
description: Auto-raised Trello-style cards on the client dashboard board + outbound webhook mirroring
---

Every client-facing send must call `raiseClientCard()` (api-server `lib/clientBoard.ts`) so a card lands on that property's board (`/client/:token/board`, feature key `board`). Currently hooked: invoice send, invoice paid (all three paid paths: record payment, status flip, pay-link settlement → `completeClientCard`), payment request send/paid, job summary send (+ separate flagged-areas card), recap email/share, tracker share, auto live-link.

**Rules:**
- Cards dedupe on (propertyId, sourceType, sourceId); a re-send reopens a done card into `inbox`. Pick a stable sourceType/sourceId for any new send path.
- `raiseClientCard`/`completeClientCard` swallow their own errors — a board failure must never fail the send. Keep it that way.
- Client accounts may set `webhookUrl`; every card event is POSTed there fire-and-forget (5s timeout). SSRF guard `webhookUrlProblem()` (https-only, port 443, public-host DNS check) runs at save AND at every dispatch — never bypass it.
- Columns: inbox | todo | in_progress | done; card moves are ownership-checked by propertyId via dashboard token.
- `client_board_cards` is in the Settings reset delete list.

The board page has a voice-guided tour (`BoardTour`, halo assets `board-tour/step-N.mp3`, pre-rendered ElevenLabs Jessica) using the same clip→SpeechSynthesis→timer fallback + generation-nonce pattern as the desktop tour; regenerate the matching clip whenever step copy changes.

**Why:** the client board is a hands-off mirror of everything the office sends; a missed hook means the client's board silently lies.

## Wekan collaboration layer (comments/checklists/labels/notifications)
- Comment threads + labels/checklist overlays work on ANY cardKey; pushed cards are keyed `push:<id>` everywhere — office UIs must never pass the raw card UUID as a thread key.
- Labels/checklist/notes are client-editable even on HALO-fed cards via the "override" row; title/description/due/priority only on `custom:` cards.
- Send-to-office and inbox respond use guarded conditional UPDATEs (pending-state first-wins, 409 otherwise); side-effect writes (notifications, activity log) after the primary mutation must be try/caught — never let them 500 a committed change.
- Client bell = `client_board_notifications` (audience client); office bell = existing `notificationsTable` kind "client_dashboard". raiseClientCard also raises a client bell entry.
- `client_card_comments` + `client_board_notifications` are in the Settings reset delete list; KPI endpoint (`/board/kpis`) returns dollars, not cents — no /100 in UIs.
