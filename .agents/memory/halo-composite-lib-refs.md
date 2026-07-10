---
name: HALO composite lib references
description: Shared workspace libs consumed via TS project references must emit declarations and be built first, or consuming apps fail typecheck.
---

When a shared lib under `lib/` is referenced as a TypeScript project reference by an app (e.g. `lib/object-storage-web` consumed by `artifacts/halo`), its `tsconfig.json` MUST set `composite: true`, `declaration: true`, `declarationMap: true`, and `emitDeclarationOnly: true` so it produces `dist/*.d.ts`.

**Why:** A referenced project without emitted declarations makes the consuming app's typecheck fail with "cannot find module / no exported member" because TS resolves references to their built `.d.ts`, not source. `lib/object-storage-web` was missing these flags and broke `pnpm --filter @workspace/halo run typecheck`.

**How to apply:** After adding/fixing those flags, build the lib once so declarations exist: `pnpm exec tsc --build lib/<name>/tsconfig.json`. Then the consuming app typechecks. Re-run the build if the lib's public types change.
