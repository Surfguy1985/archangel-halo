# Base44 — Log Work → Full Discrepancy Cards

POST https://archangel-halo.replit.app/api/internal/work-logged
Authorization: Bearer <WORK_RECONCILIATION_TOKEN>
{ "jobId": "<uuid>", "jobNo": "J-1234", "unitNo": "204", "propertyName": "Paloma" }

Response includes cards[] for full-screen modal.
Halo also pushes action: "pricing_alert" to haloWrite.

```javascript
if (body.action === "pricing_alert") {
  return { ok: true, show_modal: (body.cards || []).length > 0, title: "Pricing needs attention", cards: body.cards, open_halo: body.resolve_url };
}
```

GET https://archangel-halo.replit.app/api/discrepancies/job/<jobId>

Cards: Base44 + Halo Punchlist only. Never Pulse/Portfolio.
