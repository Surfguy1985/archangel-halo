# OPS 10/10 — Production runbook

## 1. Always On (you click this once)

1. Open Replit project **archangel-halo**
2. **Deployments** (or Hosting) → production deployment
3. Enable **Always On** / disable sleep
4. Confirm URL: `https://archangel-halo.replit.app`
5. Do **not** point Base44 at `.spock.replit.dev` for production

## 2. Redeploy after every main push

```bash
# On Replit (optional local sync)
git fetch origin && git reset --hard origin/main
pnpm --filter @workspace/api-server run build
```

Then **Deployments → Redeploy** (or Stop → Run for workspace only).

## 3. Secrets on the Deployment (not only workspace)

| Secret | Required |
|--------|----------|
| `DATABASE_URL` | Yes |
| `PUBLIC_APP_URL` | Yes → `https://archangel-halo.replit.app` |
| `WORK_RECONCILIATION_TOKEN` | Yes if Base44 sends Bearer |
| `HALO_WRITE_TOKEN` | Yes for Base44 pricing_alert push |
| `BASE44_WRITE_URL` | Yes → Base44 haloWrite function URL |
| `AUTO_SEND_TO_INVOICE` | Leave unset/false unless you want auto-invoice |

## 4. Base44 secrets (invoicing + Log Work)

```text
HALO_API_BASE=https://archangel-halo.replit.app
WORK_RECONCILIATION_URL=https://archangel-halo.replit.app/api/internal/work-logged
WORK_RECONCILIATION_TOKEN=<same as Halo>
```

## 5. Uptime monitor (every 5 minutes)

Primary:

```text
GET https://archangel-halo.replit.app/api/ops/status
```

Expect **HTTP 200** and `"ok": true`.

Also:

```text
GET https://archangel-halo.replit.app/healthz
GET https://archangel-halo.replit.app/api/work-reviews/health
GET https://archangel-halo.replit.app/api/pulse/health
```

Alert on 502/503 or `"ok": false`.

## 6. Smoke after redeploy

```bash
curl -s https://archangel-halo.replit.app/api/ops/status | head -c 800
curl -s https://archangel-halo.replit.app/api/portfolio/home | head -c 200
curl -s https://archangel-halo.replit.app/api/pulse/home | head -c 200
curl -s -X POST https://archangel-halo.replit.app/api/invoice-drafts/run   -H 'Content-Type: application/json' -d '{"limit":10}' | head -c 300
```

## 7. Map pins

Properties without lat/lng get **stable fallback coords** (approx) so maps are never empty in demos. Replace with real geocodes when available.

## 8. Definition of ops 10/10

- [ ] Always On enabled
- [ ] Production URL returns `/api/ops/status` 200
- [ ] Base44 points at replit.app
- [ ] Redeploy pipeline after main
- [ ] External uptime ping active
- [ ] Log Work → modal → field-submit works once
- [ ] `/` launch → Portfolio → Pulse → unit drawer works
