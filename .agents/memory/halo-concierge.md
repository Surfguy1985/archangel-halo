---
name: HALO client board concierge
description: Rules for the client-board concierge chatbot (SSE chat, tool loop, confirm-before-act).
---

- The concierge never touches the DB on the client's behalf: all tools run via internal HTTP fetch to `127.0.0.1:$PORT/api/client/:token/...`, forwarding the caller's cookie + bearer, so permissions/rate limits/audit stay identical to tapping the button.
- Mutating tools NEVER execute inside the model loop — they mint HMAC(SESSION_SECRET) confirm tokens (10-min TTL, bound to propertyId + clientUserId + jti). `POST /concierge/confirm` claims the jti via primary-key insert into `client_concierge_confirms` BEFORE executing — atomic one-time use across instances.
- **Why:** replayed/double-clicked confirms would double-file requests or messages; the claim insert makes replay a duplicate-key 400.
- Guests: read-only answers, no chips, ephemeral history (in-memory daily cap since their messages aren't persisted). Signed-in history lives in `client_concierge_messages`; both tables are in the settings-reset delete list.
- Chat is SSE (status/delta/chips/done events, custom fetch+ReadableStream parser in ConciergeChat.tsx — generated hooks can't stream). Deep links use `[[card:cardKey|label]]` markers parsed client-side into open-card buttons.
- **How to apply:** any new concierge action = new tool def + confirm branch that calls the existing public endpoint; never write directly to DB, never execute in-loop.
