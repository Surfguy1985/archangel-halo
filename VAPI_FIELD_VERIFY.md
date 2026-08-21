# Vapi AI Field Verify → Dispatch → Confirm

## Flow

```
Field app submits work / review
        │
        ▼
 POST /api/vapi/verify-call   (AI calls crew)
        │
        ├─ Crew says "looks good" → confirm_field_accurate
        │
        └─ Crew says "wrong service / crew / price"
                │
                ▼
         apply_field_correction tool
                │
                ▼
         Job notes + review.fieldEdits + dispatch touch
                │
                ▼
         End of call → auto CONFIRM call
                │
                ▼
         Crew says YES → locked accurate
```

## Env (Replit Secrets)

```
VAPI_API_KEY=...
VAPI_PHONE_NUMBER_ID=...
VAPI_WEBHOOK_BASE=https://archangel-halo.replit.app
# optional:
VAPI_ASSISTANT_ID=...
VAPI_MOCK=true          # no real dial; test pipeline
```

In Vapi Dashboard → Server URL (or per-assistant):

```
https://archangel-halo.replit.app/api/vapi/webhook
```

## API

```bash
# Status
curl -s http://127.0.0.1:5000/api/vapi/health

# Start verify call (uses crews.phone or body.phone)
curl -s -X POST http://127.0.0.1:5000/api/vapi/verify-call \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"UUID","reviewId":"UUID","phone":"+12145551234"}'

# Force confirm call
curl -s -X POST http://127.0.0.1:5000/api/vapi/confirm-call \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"UUID"}'

# Pipeline helper
curl -s -X POST http://127.0.0.1:5000/api/vapi/verify-and-confirm \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"UUID","phone":"+1..."}'

# List calls
curl -s http://127.0.0.1:5000/api/vapi/calls
```

## Mock mode

Without `VAPI_API_KEY`, calls are recorded as `mock` so you can still test apply-correction:

```bash
curl -s -X POST http://127.0.0.1:5000/api/vapi/apply-correction \
  -H 'Content-Type: application/json' \
  -d '{"jobId":"UUID","correction":{"correctionType":"service_add","detail":"Add make-ready package"}}'
```

Dispatch job notes update; work review stores `vapiCorrections`.
