# PHASE 3 — Falkon ASSISTED Enforcement

**Branch:** `cursor/backend-hardening`  
**Date:** 2026-08-13  
**Frontend changes:** none  

Goal: **ASSISTED is a real invariant, not a UI badge.** One policy function decides every consequential mutation. LIVE stays disabled.

---

## Score

### Phase 3 — **10.0 / 10.0**

This score applies to the **Falkon mutation / S2S gate only**. It does **not** mean crew GPS tokens are redesigned (Phase 4), CORS is locked, or the public crew OS is fully authenticated.

| Phase 3 acceptance criterion | Result |
|---|---|
| Canonical decisions `ALLOW_AUTOMATIC` / `REQUIRE_APPROVAL` / `DENY` / `SHADOW_ONLY` | Pass — `decideFalkonPolicy` |
| LIVE always denied | Pass |
| Unknown mode fail-closed | Pass |
| ASSISTED: consequential mutations require approval unless an explicit threshold matches | Pass |
| Direct API bypass (`POST /invoices/:id/send`) cannot skip the gate | Pass — `falkonMutationGuard` |
| AI auto-action bypass (`POST /command/actions/execute`) | Pass — classified as `ai`; capability mapped |
| Background-job bypass (autopilot / scheduler) | Pass — `executeAutopilotAction(..., "worker")` |
| Prior approval consumed → `ALLOW_AUTOMATIC` | Pass — `X-Falkon-Approval-Id` |
| Auditable row: actor, role, tenant, capability, target, decision, policy, timestamp, correlation, approval | Pass — `falkon_policy_decisions` |
| HMAC S2S fallback removed (inbound + outbound delivery) | Pass — Ed25519 only |
| Gateway origin env-configurable; no hardcoded Replit hostname | Pass — `FALKON_GATEWAY_ORIGIN` / `FALKON_API_BASE_URL` |
| Empty production gateway config fail-closed | Pass — no fetch |
| Acceptance tests | Pass — `falkonPolicyCore.test.ts` |
| Backend typecheck | Pass |
| Zero HALO frontend redesign | Pass |

**STOP.** Do not start Phase 4 until explicitly instructed.

---

## What changed

| Change | Why |
|---|---|
| `falkonPolicyCore.ts` | Pure policy + route classification (testable without DB) |
| `falkonPolicy.ts` | Load mode/thresholds, persist decisions, consume approvals |
| `falkonMutationGuard` on `/api` | One HTTP boundary; public token surfaces skipped |
| Autopilot worker path calls `enforceFalkonMutation` | Scheduler cannot auto-send invoices in ASSISTED |
| `POST /falkon/approvals/:id/approve\|deny` | Operator resolves; retry original mutation with `X-Falkon-Approval-Id` |
| `falkon_policy_decisions` / `falkon_pending_approvals` | Durable audit + pending queue |
| Webhook + inbound + scheduler | Ed25519 only; missing key → reject / markFailed |
| `falkonGateway` getters | Origin/client/partner/tenant from env; production has no silent prod IDs |
| Command execute | Duplicate SHADOW/OFF short-circuit removed so the guard is the single gate |

No files under `artifacts/halo`, `halo-desktop`, `halo-crew`, `client-dashboard`, `walk`, `halo-ds`, `mockup-sandbox`, `devportal`, or `lib/board-ui` were modified.

---

## Mode rules

```
LIVE     → DENY (remain disabled)
UNKNOWN  → DENY
OFF      → ALLOW_AUTOMATIC (still classified + auditable)
SHADOW   → human office operator ALLOW_AUTOMATIC
           AI / worker / S2S     SHADOW_ONLY (not executed)
ASSISTED → REQUIRE_APPROVAL unless:
             - explicit policy threshold matches, or
             - a pending approval is consumed exactly once
```

Thresholds (`falkon_policies`): `autoDispatchEnabled`, `maxAutoInvoiceAmount`, `maxAutoCrewRate`, `maxAutoChangeOrder`. A role name never auto-allows.

---

## Bypass surfaces

| Surface | Gate |
|---|---|
| `POST /invoices/:id/send` (and other office mutations) | Middleware → `classifyMutation` → `decideFalkonPolicy` |
| `POST /command/actions/execute` | Actor channel `ai`; `invoice.send` → `send_invoice` |
| Autopilot auto-approve (`runAutopilot`) | Worker channel inside `executeAutopilotAction` |
| Office click `POST /autopilot/actions/:id/approve` | HTTP guard (human); inner worker gate skipped so approval retry is not double-blocked |
| Public `/portal/`, `/pay/`, `/client/`, `/live/`, `/checkin/` | Not office Falkon-gated (token surfaces) |

Blocked responses: `executed: false`, `decision`, `reason`, `approvalId`, `correlationId`. `REQUIRE_APPROVAL` → **202**. `DENY` → **403**. Handler `next()` runs only on `ALLOW_AUTOMATIC`.

---

## S2S

- Inbound `/falkon/webhook` and `/falkon/inbound/:eventType`: Ed25519 vs cached remote key. No HMAC fallback.
- Outbox scheduler: Ed25519 or `markFailed`. No HMAC delivery.
- Gateway fetch: `FALKON_GATEWAY_ORIGIN` or `FALKON_API_BASE_URL`. Empty origin or client id → no network call.
- Production does not default to `fk_archangel_halo_prod` or a Replit hostname.
- `POST /falkon/verify` still HMAC-signs a **HALO-owned** webhook ping (`webhookSecret`). That is not Falkon S2S.

---

## Tests

`artifacts/api-server/src/lib/falkonPolicyCore.test.ts` covers LIVE deny, SHADOW AI/worker block, ASSISTED API/AI/worker approval, policy threshold, unknown mode, invoice/job/chat classification, public-path skip, and audit packet fields.

Also re-ran `enforcerCore.test.ts`, `base44SyncCore.test.ts`, `waybill.test.ts`.

```
tsc --build
tsc -p artifacts/api-server --noEmit
vitest: 4 files, 76 tests passed
```

---

## Explicitly not this phase

- Crew GPS / check-in token redesign (Phase 4)
- Unrestricted CORS if `ALLOWED_ORIGINS` unused
- Full `/portal/:token` crew OS authentication
- HALO frontend Falkon Connect copy (still shows a Replit host in UI; Replit-owned)
