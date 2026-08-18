---
name: HALO crew paycard (/checkin/:token)
description: Client-side rules for the crew-facing paycard page — GPS error typing, photo evidence source of truth, and the server-owned checkout gate.
---

# Crew paycard client rules

## GeolocationPositionError is not an Error
`err instanceof Error` is false for `GeolocationPositionError`, so any
`err instanceof Error ? err.message : "…"` branch throws away the single most
common field failure (location denied) and shows a generic string.
**Why:** crews whose location is off got "Check-in failed." with no way to know
why, and the office saw them as no-shows.
**How to apply:** normalize errors through a helper that checks `code` 1/2/3
(denied / unavailable / timeout) before falling back to `instanceof Error`.
The same applies anywhere else GPS is captured.

## Photo counts are authoritative, thumbnails are not
`GET /checkin/:token` returns `photos.before`/`photos.after` counted over the
newest ~40 rows but only ~12 `items`. Rows come back **newest-first**.
**Why:** deriving "before photo missing" from `items` lets a crew with many
retakes see "Before photo needed" while the server happily accepts checkout —
and scanning `items` from the end shows the *oldest* retake after a retry.
**How to apply:** step state and CTA copy come from the counts; `items` only
feed the thumbnail (`find`, not reverse scan).

## The checkout photo gate is server-owned
`POST /checkin/:token/checkout` returns 409 `photos_required` without a before
AND after photo. The disabled CTA is a mirror of that rule, not the rule.
**Why:** photos are the pay evidence; a client-side bypass would just 409, and
adding one would undermine the money rule.
**How to apply:** never add an escape hatch; on a failed checkout, re-read the
card so the UI reflects the server's own verdict.

## File inputs must reset their value
A camera input that does not clear `e.target.value` fires no change event when
the crew picks the *same* photo again, so every retry after a failed upload
looks dead.

## Cards left open overnight
An unbounded elapsed timer renders totals like `478:56:27` for check-ins that
were never closed. Past ~12h, show the check-in date in a caution tone plus
"left open from an earlier shift" copy instead of a running clock.
