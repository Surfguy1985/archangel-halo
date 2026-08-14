---
name: HALO merge corruption in route handlers
description: Task merges can leave the tree broken in files you never touched; verify before submitting
---

Task-merge conflict resolution has repeatedly corrupted files the current session never edited (`clientAccess.ts`, `clientBoard.ts`, `PropertyDetail.tsx`, and later `command.ts` / `walks.ts` / `crewCheckinLinks.ts`): wrong Zod body schema pasted into handlers, handler bodies spliced into each other (a POST-create silently becoming a SELECT), identifiers used before declaration, triple-duplicated destructuring lines, stray code after `export default`, dropped imports/state that other code still uses. A merge can also *inflate* a file well beyond its clean size — a sudden jump in line count is a reliable tell.

**Why:** merges land between sessions, so completion review judges the whole tree — a clean personal diff can still be rejected for pre-existing breakage.

**How to apply:** run the touched artifacts' typechecks before `markTaskComplete`; if an untouched file fails, restore the affected sections from the last clean git version (`git log -- <file>`), keeping any intervening feature deltas. After merges that add schema columns, run `lib/db` `pnpm run push` — the dev DB may lag the schema and 500 on unrelated endpoints.
