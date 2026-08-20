# Invoice Draft Autopilot + Apple-simple UI

## 30-second PM story
- Three numbers: Ready (green) · Review (yellow) · Blocked (red)
- One button: Approve all ready
- Multipoint checks on every card

## API
POST /api/invoice-drafts/run
GET  /api/invoice-drafts/summary
GET  /api/invoice-drafts?bucket=green|yellow|red
POST /api/invoice-drafts/approve-all-green
POST /api/invoice-drafts/:id/approve
GET  /api/invoice-drafts/job/:jobId

## UI
/invoice-drafts
