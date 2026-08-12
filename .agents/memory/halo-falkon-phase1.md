---
name: HALO Falkon Phase 1
description: Ed25519 signing identity, S2S gateway client, make-ready pipeline, capability registry, webhook receiver, 10-tab admin control plane.
---

# HALO Falkon Phase 1 — Implementation Notes

## What was built

| File | Purpose |
|---|---|
| `artifacts/api-server/src/lib/falkonIdentity.ts` | Ed25519 keypair gen/cache; AES-256-GCM encrypted private key in `falkon_identity` table; `getPublicKeyPem()` / `buildTrustDoc()` |
| `artifacts/api-server/src/lib/falkonGateway.ts` | S2S HTTP client with Ed25519 signing; `HALO-Client-Id`, `HALO-Timestamp`, `HALO-Signature`, `HALO-Tenant`, `X-Falkon-Mode` headers |
| `artifacts/api-server/src/lib/falkonCapabilities.ts` | Static registry of 22 capabilities (15 mapped, 7 new); `getCapabilityRegistration()` |
| `artifacts/api-server/src/lib/ensureFalkonSchema.ts` | Raw-SQL bootstrap for 7 new tables + ALTER TABLE additions; idempotent `CREATE TABLE IF NOT EXISTS` |
| `artifacts/api-server/src/lib/falkonMakeReady.ts` | Gate evaluation + phase advancement for 12-phase pipeline; SHADOW-safe (only writes to `falkon_executions` / `falkon_execution_events`) |
| `artifacts/api-server/src/routes/falkonWebhook.ts` | `POST /api/falkon/webhook` (Ed25519 verify + nonce dedup); trust doc served at `app.ts` root |
| `artifacts/api-server/src/routes/falkonAdmin.ts` | Five-step verify, twin sync, make-ready routes, usage metering, LIVE eligibility + gated mode promotion |
| `artifacts/halo-desktop/src/pages/FalkonConnect.tsx` | 10-tab control plane: Overview, 5-Step Verify, Properties, Units, Vendors, Capabilities, Make-Ready, Events, Usage, Eligibility |

## Critical rules

**DB lib must be rebuilt before typechecking:**
```bash
cd /home/runner/workspace && pnpm exec tsc -p lib/db/tsconfig.json
```
The api-server uses TypeScript project references; stale `.d.ts` files cause false "no exported member" errors.

**Schema additions always in TWO places:**
1. `lib/db/src/schema/falkon.ts` (Drizzle schema type)
2. `artifacts/api-server/src/lib/ensureFalkonSchema.ts` (raw SQL bootstrap)
Skipping either causes typecheck failures or runtime errors.

**`falkon_connections` new columns added in Phase 1:**
`status`, `verification_steps`, `partner_client_id`, `partner_tenant`, `trust_doc_verified_at`

**New tables in Phase 1:**
`falkon_identity`, `falkon_remote_identity`, `falkon_webhook_nonces`, `falkon_executions`, `falkon_execution_events`, `falkon_usage_meters`

**Webhook security — FAIL CLOSED:**
- No `FALKON-SIGNATURE` header → always reject
- No remote key cached + event is NOT `partner.verify.ping` → reject
- Only `partner.verify.ping` gets the bootstrap exception (needed for verify step 5 to complete)

**Mode promotion — gated:**
- Connection must be `status = "verified"` (five-step verify complete)
- Only SHADOW → ASSISTED → LIVE ladder allowed (not SHADOW → LIVE)
- Ed25519 signing identity must be active

**`invoicesTable.amount` not `.total`:**
The invoices table column is `amount`, not `total`. Don't confuse with `taxAmount`.

**Trust doc is at root, not /api:**
`GET /.well-known/falkon-trust.json` is mounted in `app.ts` before the `/api` router — not in any route file.

**`ensureFalkonIdentity` must run AFTER `ensureFalkonSchema`:**
Both are called in `index.ts`; chain them: `ensureFalkonSchema().then(() => ensureFalkonIdentity())`.

**`USE import.meta.env.BASE_URL` in halo-desktop — no `@/lib/config`:**
The config module doesn't exist. Use `import.meta.env.BASE_URL` directly. Pattern: `const BASE = import.meta.env.BASE_URL as string`.

## Gateway coordinates
- Origin: `https://building-blocks--austpryb1.replit.app/api`
- Client ID: `fk_archangel_halo_prod`
- Tenant: `archangel-halo-prod`
- Partner ID: `archangel-halo`
- Trust doc: `https://archangel-halo.replit.app/.well-known/falkon-trust.json`
- Webhook: `https://archangel-halo.replit.app/api/falkon/webhook`
