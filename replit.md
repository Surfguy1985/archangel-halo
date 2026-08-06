# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **Board contract guard**: client-board module types live in 4 places that must match — `lib/api-spec/openapi.yaml` (`ClientCardModule` oneOf + discriminator mapping), `lib/board-ui/src/components/kanban/moduleSchemas.ts` (Zod union), and BOTH renderer copies of `BoardCardModules.tsx` (board-ui + client-dashboard). `scripts/src/check-board-contract.ts` fails `pnpm run typecheck` on any drift. To add a new module type: spec → orval codegen → moduleSchemas → both renderers → server emitter, then run the guard (`pnpm --filter @workspace/scripts run check:board-contract`).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

## Design, Experience & Architecture Standards

Always follow the skill at `.agents/skills/premium-ui-ux-fixer/` for any UI, UX, layout, aesthetic, experience, flow, or frontend architecture work.

Target aesthetic: Premium fintech / high-end product design (Klarna, Stripe, Linear, Apple level), adapted to the existing HALO/Falkon brand palette (light theme, dark-lime `--gold` text accents, `#B4FF44` `--gold-light` buttons with black text).

Key principles:
- Soft, professional brand-colored glows (never tacky neon)
- Strong visual hierarchy and 8px spacing grid
- Distinctive typography (avoid Inter / generic system fonts)
- Atmosphere and depth instead of flat AI-slop
- Consistent component language across the entire app
- Accessibility first (contrast, focus, reduced motion)

Experience & Architecture:
- Improve full user journeys by learning from the best products in the category
- When needed, pull proven patterns from high-quality open-source design system repos and architectural reference repos, then adapt them cleanly to this project's stack and brand

When the user asks to fix/improve/polish the UI, elevate the experience, improve flows, or leverage external design/architectural repos, fully activate the premium-ui-ux-fixer skill and execute its complete process.
