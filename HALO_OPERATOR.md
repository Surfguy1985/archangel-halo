# Halo Operator — operates Dispatch like a human

## What it does
- Scans dispatch (Money Lock)
- Clean → lock margin on Dispatch (board → billing)
- Exception → flag + nudge Base44 field card
- Optionally apply master prices
- Invoice ONLY if env AUTO_SEND_TO_INVOICE=true

## APIs
GET  /api/halo-operator/health
GET  /api/halo-operator/status
GET  /api/halo-operator/actions
POST /api/halo-operator/run  { dryRun?, limit? }
POST /api/halo-operator/action  { action, jobId?, reviewId?, boardStatus? }
POST /api/halo-operator/move-job
POST /api/halo-operator/lock-dispatch
POST /api/halo-operator/send-to-invoice
POST /api/halo-operator/flag-exception
POST /api/halo-operator/apply-master-price
POST /api/halo-operator/nudge-field

## Policy
Auto lock Dispatch: ON
Auto send Invoice: OFF unless AUTO_SEND_TO_INVOICE=true
