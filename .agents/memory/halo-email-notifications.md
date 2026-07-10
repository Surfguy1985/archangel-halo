---
name: HALO email notifications & scheduler
description: How daily/urgent task-list emails are built, sent via Resend, and scheduled in-process.
---

# Email notifications in HALO

## Source of the task list
Emails render the same `computeQueues()` feed the app uses. Each `FeedItem.tier`
(`now` / `today` / `week`) IS the urgency; `now` is most urgent. Order and color-code by
tier: now=red (#be3c3c), today=gold (#8f6a1f), week=gray. All mail goes to
`ADMIN_EMAIL` (admin@archangelcontractors.com) via the existing `sendEmail` Resend proxy.

## Resend sender is a verified domain, not the sandbox
Production sends go from `ArchAngel Contractors <bryce@megprimepay.com>` with reply-to
`admin@archangelcontractors.com`. megprimepay.com is the verified domain on the connected
Resend account (authorized by brycebeck85@gmail.com — a gmail login can never be a FROM
address; Resend requires a verifiable domain). The sender/reply-to are constants in email.ts.
**Why this shape:** the app is single-org and the connector proxy only whitelists `/emails`
(cannot list/verify domains via proxy — the api_key setting is a proxy token, not a raw
Resend key, so direct api.resend.com and sandbox `connectors.proxy` calls both 400).
`sendEmail` returning `true` means the proxy accepted the request, not guaranteed delivery.

## Scheduler is in-process (setInterval), state is in-memory
The scheduler runs via `setInterval` started from `index.ts` after listen — it only runs
while the process is alive (fine on an always-on Reserved VM; will not run on autoscale that
scales to zero). Daily digest fires at 06:45 America/New_York; urgent alerts are checked
every 15 min and sent only when the set of `now`-tier item ids changes.

**Rule:** advance scheduler dedup state (`lastDailyDate`, `lastUrgentSignature`) ONLY after a
confirmed successful send (`sent === true`), never before the attempt.
**Why:** setting state before the send means a Resend outage permanently skips that day's
digest / that urgent set with no retry.

**Known limitation:** state is in-memory, so a restart after 06:45 (before that day's digest
sent) skips the day. Manual `POST /api/notify/daily` is the fallback. Persisting last-sent
would need a DB/kv store — not built.

## Unauthenticated trigger endpoints
The whole API has no auth by design, so `POST /notify/daily` and `/notify/urgent` carry a
per-endpoint 60s cooldown (429 on repeat) to blunt spam/cost abuse rather than an auth gate.
The evening close (18:30 ET) and weekly scorecard (Mon 07:00 ET) follow the same pattern with
`POST /notify/close` and `/notify/weekly`.

## Any send-then-record flow must gate DB writes on send success
Beyond the scheduler dedup rule, ANY handler that sends mail and then records the outcome
(e.g. the recap send route stamping `jobs.recapSentAt` + inserting an `email` activity) must:
(1) resolve a real recipient and return 422 when none exists — never fall back to a dummy
address; (2) `await sendEmail(...)` and only perform the DB writes when it returns `true`,
returning 502 otherwise.
**Why:** ignoring the boolean records phantom "sent" recaps the operator will trust and never
resend; a dummy fallback address silently leaks client comms to the wrong place.
