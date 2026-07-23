---
name: HALO Plaid credentials
description: Plaid is connected via secrets (not a Replit connector); keys are PRODUCTION environment.
---

# Plaid in HALO

Plaid is wired through plain secrets `PLAID_CLIENT_ID` / `PLAID_SECRET` — the user
dismissed the Replit-managed Plaid connector flow and chose secrets instead. Do not
re-propose the connector; use the env vars.

**The keys are PRODUCTION keys.** Verified 2026-07-11: `/institutions/get` succeeds
against `production.plaid.com` and returns INVALID_API_KEYS against `sandbox.plaid.com`.

**How to apply:** any Plaid client/base URL must target the production environment
(`https://production.plaid.com`); sandbox test flows (`/sandbox/*` endpoints,
`user_good` test creds) will NOT work with these keys. Real bank data — treat
integrations as live and be conservative with write/link operations.

# Multi-bank data model

`plaid_items` holds one row per connected bank; `item_id` is UNIQUE and the exchange
endpoint upserts (`ON CONFLICT item_id DO UPDATE`) — never delete-then-insert, never
wipe the table on connect.

**Why:** delete-then-insert under concurrent/retried exchanges can duplicate an item
and double-count every bank aggregate.

**How to apply:** accounts/transactions/cashflow/analysis endpoints must loop ALL
items; analysis cache key = sorted item ids + days; `DELETE /plaid/item` takes
optional `?bankId` (removes one bank) or wipes all when omitted.
