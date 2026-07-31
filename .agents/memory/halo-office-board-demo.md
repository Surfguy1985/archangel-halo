---
name: HALO Office Board Demo shared script
description: Office Board Demo narration script + MP3 clips are shared between mobile and desktop via a lib package.
---

The office-side Board Demo script (titles/bodies) and pre-rendered ElevenLabs clips live in `@workspace/board-demo` (`lib/board-demo/src/office.ts` + `src/assets/office-demo/step-N.mp3`). Both halo and halo-desktop OfficeBoardDemo components import it and keep only per-app spotlight TARGETS arrays (mobile `column-*`, desktop `lane-*`), zipped with the script by index.

**Why:** the script existed twice and could drift so audio no longer matched text; clips are matched to steps purely by filename index.

**How to apply:** edit steps only in the shared package and regenerate the full step-0..N-1 clip set there. The narration guard (`scripts/src/check-demo-narration.ts`, runs in `pnpm run typecheck`) parses the shared file — renaming `OFFICE_DEMO_SCRIPT` or its type breaks the guard. When adding/removing steps, update both apps' TARGETS arrays too (missing entries silently center instead of spotlighting).
