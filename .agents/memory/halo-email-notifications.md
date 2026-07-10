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

## Resend sandbox limitation
The `FROM` is `onboarding@resend.dev` (Resend sandbox). In sandbox mode Resend only
delivers to the connected account's own verified address; delivery to arbitrary addresses
like admin@archangelcontractors.com requires verifying a sending domain in Resend.
`sendEmail` returning `true` means the proxy accepted the request, not that it was delivered.

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
