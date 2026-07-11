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
