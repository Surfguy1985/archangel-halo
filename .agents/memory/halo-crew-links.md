---
name: HALO crew link shapes
description: The one correct URL shape for crew portal / paycard / join links, and why hand-built variants broke on crews' phones.
---

# Crew links are always root-served

Three unauthenticated crew surfaces: portal, paycard check-in, foreman join.
All three are routes of the **root web app**, so a crew link is
`<origin>/<portal|checkin|join>/<token>` and nothing else. Build them with the
shared crew-link helpers in the board UI package rather than by hand.

**Why:** hand-built variants shipped in several office screens, in three
different shapes. Two pointed at the Expo bundler path (`/halo-crew/portal/…`),
which resolves in the dev workspace and **not** in production; others prefixed
`import.meta.env.BASE_URL`, which works only from the root app and breaks from
any base-pathed artifact (e.g. the desktop app at `/desktop/`).

**How to apply:**
- New office UI that shares a crew link: use the helper, never string
  concatenation, and never `BASE_URL` for a crew link.
- The server texts the same shapes; keep them in sync with the helper.
- `BASE_URL` is for in-app route links only. API and asset URLs
  (`/api/storage…`, PDFs, downloads) must be absolute `/api/...`.
- Any new public token surface must also be added to the office-auth public
  prefixes or it 401s.

# One shared roster code, gated by office approval

The office hands out a single company-wide code (stored on the settings
singleton) behind a public pick-your-name page. The code has no passcode, so it
identifies nobody: **the office's approval is the identity check.** A claim
mints an extra portal bearer that starts `pending` and is inert; only an
approved bearer authenticates.

**Why:** crews kept losing individual links and the office wanted one printed
QR — but a bare shared code would have let anyone holding it open a co-worker's
portal, and pay, invoices and payment details all hang off portal identity.

**How to apply:**
- Portal token lookup must filter on approved status, not mere existence. Any
  new resolver that skips that check re-opens the whole gate.
- Handing the device its token before approval is fine (it's dead until the
  office acts) — what must never be returned is a crew's *existing* link.
- Approval is a guarded `pending → decided` update that also re-checks the crew
  is active, so double-taps 409 and a removed person can't be waved back in.
- Adding a status column to an already-shipped bearer table must backfill old
  rows to approved (add the column with that default, then flip the default),
  or every link issued before the gate dies on deploy.
- The public roster response is names, trades and team colours only. No phones,
  no pay, no roles, no tokens. Anything richer leaks to whoever has the QR.
- The self-add path matches an existing person by literal lowercased name under
  the same foreman, inside a transaction behind an advisory lock. Never `ILIKE`
  (its `%`/`_` match other people) and never an unlocked read-then-insert (twins).
- The "who do you report to" picker deliberately lists **every** name, not just
  people flagged as foremen: a new hire knows who runs their day, not how that
  person is filed. Only an *active foreman* may ever be written to
  `crews.leader_id`, though — pin colours and team membership depend on it — so
  naming anyone else falls back to that person's own foreman (validated the same
  way) and otherwise stores nothing, with the named person recorded in the
  office's approval notification. Resolve both hops **inside** the join
  transaction; a leader read before the insert can be deactivated or re-parented
  underneath you.

# Never mint a portal token from a read/list surface

Portal bearers are hashed at rest, so an already-issued link cannot be read
back. A roster or list endpoint that "ensures" a link for every crew therefore
mints a fresh token and overwrites the old one, silently killing every QR code
already printed or texted. A list may mint **only** for a crew that has neither
a legacy plaintext bearer nor a stored hash; for the rest it reports that a link
exists and leaves re-issuing to the deliberate per-crew action.

