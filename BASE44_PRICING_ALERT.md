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


---

## Status — haloWrite is not deployed yet

HALO's side is live and sends correctly. Base44 refuses it:

    POST https://wakeful-ready-track-flow.base44.app/functions/haloWrite
    404  Backend function 'haloWrite' not found or not deployed

The read function (`haloRead`) is up and answering, so the app and token are
fine — only the write function is missing. Until it exists, every push returns
`base44Push: { ok: false, error: "Work app returned 404" }`. Nothing in HALO
breaks: job completion and the work-logged reply carry on and still return
`cards[]`, so Base44 can render the modal from the response alone.

### Deploy this as `haloWrite` in Base44

Auth is the same `x-halo-token` header the read function uses; HALO sends
`HALO_WRITE_TOKEN` if set, otherwise `HALO_READ_TOKEN`.

```javascript
// Backend function: haloWrite
Deno.serve(async (req) => {
  if (req.method !== "POST") return Response.json({ error: "Method Not Allowed" }, { status: 405 });
  if (req.headers.get("x-halo-token") !== Deno.env.get("HALO_TOKEN")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json();

  if (body.action === "pricing_alert") {
    // Persist if you want a history; the modal only needs the response.
    return Response.json({
      ok: true,
      show_modal: (body.cards || []).length > 0,
      title: "Pricing needs attention",
      cards: body.cards,
      open_halo: body.resolve_url,
    });
  }

  if (body.action === "set_po") {
    // body: { po_number, job_no, unit_number, property, unit_id, crew_job_ids[] }
    // Stamp the PO onto the unit / crew jobs here.
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
});
```

Set `HALO_TOKEN` in Base44's secrets to the same value as HALO's
`HALO_READ_TOKEN`. Once it's deployed, re-send any job and `base44Push`
turns to `{ ok: true }` — no HALO change needed.


### Troubleshooting a 401 from haloWrite

Read the status code before touching HALO — it says which side is at fault:

| Response | Meaning |
| --- | --- |
| `404 ... not deployed` | The function doesn't exist in Base44 yet. |
| `401` **only with a wrong token** | Correct. Auth is working. |
| `401` **for every value, including no header at all** | Base44's `HALO_TOKEN` is unset or empty in the deployed function. `headers.get(...) !== undefined` never matches, so everything is rejected. Not a HALO problem — no token HALO sends can pass. |

If it rejects everything, in Base44: confirm the secret is named exactly
`HALO_TOKEN`, confirm it's scoped to the app running `haloWrite`, and
**redeploy the function** — secret edits usually don't reach an already-running
function.

To see it directly, make the reject branch report whether the var is present
(never the value):

```javascript
if (req.headers.get("x-halo-token") !== Deno.env.get("HALO_TOKEN")) {
  return Response.json(
    { error: "Unauthorized", token_configured: Boolean(Deno.env.get("HALO_TOKEN")) },
    { status: 401 },
  );
}
```

`token_configured: false` confirms the secret isn't reaching the function.
