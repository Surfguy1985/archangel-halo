---
name: HALO Presentation Mode
description: Investor demo — seeded mock property + narrated spotlight walkthrough on the live client board
---

# Presentation Mode

- Toggle lives in the HALO mobile app's More sheet ("Showcase" group). ON = `POST /presentation/demo` seeds a mock property, then opens `/board/<token>?present=1`; OFF = `DELETE` removes every demo row.
- Seed/teardown live in api-server `lib/presentationDemo.ts`, serialized by `withRefLock("presentation-demo")` (ledger's per-key in-process mutex — safe to nest with the "rebuild" key).
- **Teardown identity is a double marker**: property must match fixed name AND fixed brief; demo crews must match sentinel email `demo-crew@falkon.example` AND be crew leaders of demo-property jobs. Never loosen to a single marker — a name collision could delete real client data.
- `rebuildLedger()` runs after both seed and teardown so demo invoices never linger in the Books.
- Do NOT raise a manual card for a job that projects onto the board — the projected `job:` card would appear duplicated. The tour's live-move step targets the projected landscaping job card via the office actions endpoint (guarded: only when `/presentation/demo`'s dashboardToken matches the current board token).
- Client-side: `?present=1` on the board opens `PresentationMode.tsx` (suppresses DashboardTour + NewCardSpotlight). Narration = pre-rendered ElevenLabs Jessica MP3s in `client-dashboard/src/assets/presentation/step-N.mp3` → SpeechSynthesis → timer, nonce-guarded (same chain as the other tours). Regenerate clips whenever step copy changes.
- **Steps and MP3s are index-aligned by filename** — inserting a step means renaming every later `step-N.mp3` up by one AND generating the new clip, in both tours. Drift = wrong narration playing silently over the wrong step.
- Office-side half ("Board Demo — office side"): `?present=1` on `/properties/:id/board` (mobile halo) opens `OfficeBoardDemo.tsx`, same MP3 chain with clips in `halo/src/assets/office-demo/`. Desktop app does NOT have this route — desktop-viewport visitors get redirected to /desktop and would 404; the demo is mobile-only by design.
- Seed also uploads bundled before/after photos (`artifacts/api-server/assets/demo/*.jpg`) into object storage under fixed names `/objects/demo-board/*` (overwrite-safe) and raises a real `photos`-module card. The server runs bundled from dist, so asset paths must be probed (dist vs src vs cwd), never assumed from `import.meta.dirname`. Photo seeding is best-effort: storage failure skips the photos card, never fails the seed.
- Re-seeding (POST) invalidates the previous dashboardToken — always re-fetch the token after any activate call when testing.

## Simulcast lifecycle engine (client-dashboard presentation)
- Client-dashboard `?present=1` is now a 14-step narrated SIMULCAST: `POST /presentation/demo/step` (body `{token, step}`) drives idempotent lifecycle steps (reset, request_created, office_accept, assign_schedule, tracker_live, photos, summary_flags, invoice_sent, office_receipt); `GET /presentation/demo/office-board?token=` feeds the PiP OfficeBoardPanel (2s poll). Both are in officeAuth PUBLIC_PREFIXES, token-guarded.
- **Security invariant: public `GET /presentation/demo` must NEVER return the dashboardToken** — it returns only `{active, matches}` for a `?token=` query. The token is disclosed only by the office-gated seed POST. (Architect flagged token leak once; keep it closed.)
- Office-board projection shape: `{propertyName, dashboardUrl, board: {lanes: [defs], cards: [flat, each with .lane]}}` — panel normalizer must unwrap `.board` and group flat cards by lane.
- Board `?present=1` also permanently suppresses the intro DashboardTour (marks it seen once, ref-guarded) — otherwise two tutorials stack and the tour launches when the presentation closes.
- Client rails order is needs_you, requested, in_progress, done, paid(label "Billing") — RAIL_ORDER in board-ui railMapping.ts.
- Step firing must be StrictMode-proof: fire-once guards evaluated at timer *schedule* time get wiped by mount→cleanup→remount and steps silently never POST; check fired-set inside the timeout callback, gated on the current step ref.
- Screenshot showcase overlays (PresentationShowcase, fractional lime highlight rects) use PNGs bundled from src/assets/presentation/shots/ — keep every image under 2 MiB or the PWA Workbox precache fails the production build.
- Narration clips: generated via ElevenLabs external API, premade Jessica voice `cgSgspJ2msm6clMCkdW9`, `/with-timestamps?output_format=mp3_22050_32` (full-bitrate + /v1/voices responses blow the 1MB callback limit). Text = `title. body` per step.

## Desktop port
- Desktop app has its own OfficeBoardDemo copy (assets + component duplicated from mobile) opened by ?present=1 on the office board page; entry points live in the sidebar More dropdown ("Showcase" section) and seed the demo via activate before navigating.
- Desktop office board lanes are requested/scheduled/in_progress/done/billing (AppleBoard `lane-<key>` testids) — NOT the mobile column-inbox model; spotlight targets must use lane-requested for pushed cards.
- Desktop route alias /properties/:propertyId/board exists so the mobile Showcase link survives the desktop redirect.
