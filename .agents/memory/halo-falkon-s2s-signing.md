---
name: HALO Falkon S2S signing contract
description: Ed25519 canonical signing scheme for all Falkon gateway calls; common mistakes and verification rules.
---

## The canonical Falkon Ed25519 signing contract

**Signing string** (all fields joined by `\n`):
```
clientId + "\n" + timestampMs + "\n" + nonce + "\n" + sha256hex(rawBody)
```
- Timestamp is **epoch milliseconds** (not seconds).
- Empty-body requests (GET/DELETE with no body) use `sha256hex("")` — never skip it.
- nonce is a fresh UUID per request.

**Header names** (canonical, mandatory):
```
X-Falkon-Client-Id:  fk_archangel_halo_prod
X-Falkon-Timestamp:  <epoch ms>
X-Falkon-Nonce:      <uuid>
X-Falkon-Signature:  <ed25519 base64url-no-padding>
```
`base64url-no-padding` = base64 with `+→-`, `/→_`, strip `=`.

**What NOT to use**: `HALO-Timestamp`, `HALO-Signature` — these are legacy/wrong.

## Inbound webhook verification (fail-closed)

1. Extract `X-Falkon-Client-Id`, `X-Falkon-Timestamp`, `X-Falkon-Nonce`, `X-Falkon-Signature`.
2. Auto-detect seconds vs ms: if `ts < 1_000_000_000_000` → multiply by 1000.
3. Timestamp freshness: `|now - tsMs| < 5 * 60_000` (5 min window).
4. Reconstruct signing string using same formula above.
5. Decode `X-Falkon-Signature` from base64url-no-pad → Buffer.
6. Verify with `crypto.verify(null, msgBuf, falkon_remote_identity.public_key_pem, sigBuf)`.
7. If Ed25519 fails → hard reject (never fall through to HMAC when sig header is present).
8. HMAC-SHA256 fallback only when: no remote Ed25519 key AND webhookSecret is configured.

## Nonce deduplication

Table: `falkon_webhook_nonces (id, jti, received_at, expires_at)` — unique on `jti`.
Claim nonce before processing; `expires_at = now() + 24h`.
Also purge expired nonces (falkonScheduler.purgeExpiredNonces).

## Remote key caching

Falkon returns its Ed25519 public key in the step-2 trust-binding response (`falkonPublicKeyPem`).
Store in `falkon_remote_identity` table. Wiped on reconnect (`DELETE FROM falkon_remote_identity`).

## Key implementation files

- `lib/falkonGateway.ts` — signed outbound S2S calls
- `lib/falkonScheduler.ts` — outbox delivery sweep (Ed25519, HMAC fallback)
- `routes/falkonWebhook.ts` — inbound verification
- `routes/falkonAdmin.ts` step 2 — trust binding using signed `submitTrustBinding()`

**Why:** Previous code used unsigned `HALO-*` headers and HMAC for outbound delivery — incompatible with Falkon's enterprise contract; all calls were being rejected 401.
**How to apply:** Any new Falkon-facing HTTP call must use `gatewayFetch()` from `lib/falkonGateway.ts`.

## Gateway URL notes (confirmed Aug 2026)

- GATEWAY_ORIGIN = `https://building-blocks--austpryb1.replit.app/api` (correct — `/api` prefix is right)
- Health endpoint: `/healthz` (not `/health` — returns 404). Gateway returns `{"status":"ok"}` without `ok:true`; normalize in `gatewayHealth()`.
- Partner routes (`/api/partners/{clientId}/trust`, `/callbacks`, `/shadow/execute`, `/ping`) all return 404 — not yet implemented on gateway side.
- `falkon_inbound_events` uses `status` (text: 'pending'/'processed'), NOT a boolean `processed` column. Eligibility query must use `WHERE status = 'processed'`.
