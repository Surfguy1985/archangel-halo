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
