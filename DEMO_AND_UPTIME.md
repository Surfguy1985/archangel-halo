# Demo path + production uptime

## 30-second demo (Halo property views)

1. Open `/` → **Where to?**
2. Tap **Portfolio** → map + counts
3. Tap a property → drawer → **Open in Pulse**
4. Tap a unit → drawer with photos
5. Bottom nav: Pulse ↔ Portfolio only (no invoice)

**Invoicing demo:** Base44 Invoice Drafts (Halo APIs only).

## Production always-on

1. Replit **Deployments** → production URL `archangel-halo.replit.app`
2. Enable **Always On** if available
3. Base44 secrets:
   - `HALO_API_BASE=https://archangel-halo.replit.app`
   - `WORK_RECONCILIATION_URL=https://archangel-halo.replit.app/api/internal/work-logged`
4. Uptime monitor (every 5 min):
   - `GET /api/work-reviews/health`
   - `GET /api/pulse/health`
   - `GET /api/portfolio/health`
   - `GET /api/invoice-drafts/health`
5. After every `main` push: **Redeploy**

## Portal map

| Path | Audience |
|------|----------|
| `/` | Launch |
| `/portfolio` | Corporate |
| `/pulse` | Property |
| `/punchlist` | Vendor |
| `/command` | Halo Command (advanced) |
| Base44 | Invoicing UI |
