# Grok Site Ops Bot

Autonomous on-site operations manager for Halo.

## What it manages

1. **Site presence** — who’s on site, densest building (building-ops)
2. **Dispatch** — Halo Operator pass (lock clean jobs, flag exceptions)
3. **Money Lock awareness** — exception counts (corrections stay on invoicing tab)
4. **Chat** — natural language: status | run | start | stop | site | exceptions

## API

```bash
GET  /api/site-ops-bot/health
GET  /api/site-ops-bot/status
GET  /api/site-ops-bot/history
POST /api/site-ops-bot/config   { "propertyId": "...", "intervalMs": 300000, "enabled": true }
POST /api/site-ops-bot/start   { "propertyId": "..." }
POST /api/site-ops-bot/stop
POST /api/site-ops-bot/run     { "propertyId": "...", "dryRun": false }
POST /api/site-ops-bot/chat    { "message": "run site ops", "propertyId": "..." }
```

## Activate

```bash
curl -s -X POST http://127.0.0.1:5000/api/site-ops-bot/start \
  -H 'Content-Type: application/json' \
  -d '{"propertyId":"YOUR_UUID"}'

curl -s -X POST http://127.0.0.1:5000/api/site-ops-bot/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"status"}'
```

Continuous mode: every 5 minutes (configurable) re-runs presence + operator.

## Policy

- Auto-lock **clean** jobs on Dispatch only
- Does **not** auto-send to invoice unless `AUTO_SEND_TO_INVOICE=true`
- Pulse/Portfolio remain money-free
