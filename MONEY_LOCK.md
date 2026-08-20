# Money Lock — DISPATCH section (not Invoice)

## Flow

```
Dispatch jobs
    → Money Lock classify
    → CLEAN: auto field+bot final → margin_ready on DISPATCH (board: billing)
    → EXCEPTION: stays on Dispatch triage
    → BLOCKED: not ready

Invoice is a SEPARATE handoff:
    POST /api/work-reviews/:id/complete  (from Dispatch when office is ready)
```

Auto-approve does **not** call sent_to_invoice.
You correct mistakes and/or send to Invoice from the Dispatch / invoicing tools when you choose.

## APIs

| Path | Section |
|------|---------|
| POST /money-lock/run | Dispatch close |
| GET /money-lock/exceptions | Dispatch triage |
| GET /money-lock/dispatch-approved | Dispatch margin-locked |
| GET /money-lock/summary | Counts |
| GET /invoice-queue | Invoice only |
| POST /:id/complete | Explicit handoff Dispatch → Invoice |
| POST /:id/reopen-for-correction | Pull back if needed |
| POST /:id/apply-correction | Fix $ then optional re-queue |
