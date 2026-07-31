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
