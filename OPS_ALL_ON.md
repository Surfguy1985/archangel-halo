# All-on: continuous Site Ops + Vapi + polish

## Replit Secrets

```text
# Site Ops Bot (auto-starts on boot unless false)
SITE_OPS_AUTO_START=true
SITE_OPS_INTERVAL_MS=300000

# Vapi live calls
VAPI_API_KEY=your_key
VAPI_PHONE_NUMBER_ID=your_number_id
VAPI_WEBHOOK_BASE=https://archangel-halo.replit.app
VAPI_AUTO_VERIFY=true

# Optional
VAPI_ASSISTANT_ID=
VAPI_MOCK=true
```

Vapi Dashboard Server URL:
`https://archangel-halo.replit.app/api/vapi/webhook`

## After deploy

```bash
git fetch origin && git reset --hard origin/main
pnpm --filter @workspace/api-server run build
# Stop → Run

# Logs should show:
#   Site Ops Bot continuous mode started
#   Server listening

curl -s http://127.0.0.1:5000/api/site-ops-bot/status | head -c 800
curl -s http://127.0.0.1:5000/api/vapi/health
```

## Behavior

1. **Continuous bot** — every 5 min: site presence + operator + money-lock awareness  
2. **Field submit** — if `VAPI_AUTO_VERIFY=true`, AI calls crew; corrections → dispatch; confirm call on changes  
3. **Thornbury seed** — photo insert is idempotent (no more duplicate key spam)
