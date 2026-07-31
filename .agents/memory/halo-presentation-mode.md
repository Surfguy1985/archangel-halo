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
