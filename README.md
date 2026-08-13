# HALO — Archangel Operations Platform

Full-stack property-operations OS built on a pnpm monorepo. The system covers work-order dispatch, crew management, client boards, invoicing, banking (Plaid), AI voice commands, and real-time job tracking.

---

## Repository layout

```
artifacts/
  api-server/       Express API (all business logic, DB access)
  halo/             Mobile-first PWA — the primary office app (HaloCommand)
  halo-desktop/     Desktop hub (6-panel sidebar layout)
  halo-crew/        Expo React Native crew field app
  halo-ds/          HALO Design System (tokens + components)
  client-dashboard/ Client-facing Kanban board PWA
  walk/             Property walk / inspection app
  devportal/        Developer documentation site
  mockup-sandbox/   Vite component preview server (canvas prototyping)
lib/
  db/               Drizzle ORM schema + migrations (shared across all apps)
  board-ui/         Shared Apple-style board component library
integration/        Third-party integration specs (Falkon Ops, billing rails)
scripts/            CI / post-merge automation
```

---

## Getting started (Cursor / local)

### Prerequisites

- Node.js 20+
- pnpm 9+ (`npm install -g pnpm`)
- PostgreSQL 16 (or use the Replit-managed DB via `DATABASE_URL`)

### 1 — Install dependencies

```bash
pnpm install
```

### 2 — Configure environment variables

```bash
cp .env.example .env
# Edit .env and fill in all values — see comments inside the file
```

> **Important:** All secrets live in `.env` locally and in Replit Secrets on Replit. Never commit `.env`.

### 3 — Push the database schema

```bash
pnpm --filter @workspace/db run db:push
```

### 4 — Run the full stack

```bash
# All services in parallel:
pnpm run dev

# Or individually:
pnpm --filter @workspace/api-server run dev   # API on $PORT (default 3001)
pnpm --filter @workspace/halo run dev          # Mobile PWA
pnpm --filter @workspace/halo-desktop run dev  # Desktop hub
```

---

## Replit ↔ Cursor collaboration

| Tool | Branch | Notes |
|------|--------|-------|
| **Replit** | `main` | Replit commits directly to `main`; the Replit deployment targets `main`. |
| **Cursor** | feature branches → PR to `main` | Create a branch (`git checkout -b feat/your-change`), push to GitHub, open a PR. Pull latest `main` before starting new work. |

> Avoid force-pushing `main`. Both tools share it.

---

## Key environment variables

See `.env.example` for the full list. The most critical ones:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Signs office session cookies (32+ random chars) |
| `RESEND_API_KEY` | Transactional email |
| `PLAID_CLIENT_ID` / `PLAID_SECRET` | Bank data — **production keys** |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | GPT-4o for voice, OCR, and AI features |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| API | Express + TypeScript + Drizzle ORM |
| DB | PostgreSQL 16 |
| Frontend | React 18 + Vite + Tailwind CSS v4 |
| Mobile | Expo (React Native) |
| AI | OpenAI gpt-4o, gpt-4o-mini, gpt-image-1 |
| Email | Resend |
| Banking | Plaid (production) |
| Auth | Custom passcode gate + HMAC session cookies |
| Monorepo | pnpm workspaces + TypeScript project references |

---

## Design system

All UI is built on `@workspace/halo-ds`. Read `artifacts/halo-ds/docs/` before writing new components. The design language is dark-first (`#080D17` base), Outfit/Geist typography, and `#B4FF44` lime accent.

---

## Database migrations

Migrations live in `lib/db/migrations/`. After any schema change:

```bash
# Generate a new migration:
pnpm --filter @workspace/db run db:generate

# Apply to the database:
pnpm --filter @workspace/db run db:push
```

---

## Security notes

- Office API routes require a signed session cookie (passcode gate). Public surfaces (client boards, crew portals, pay links) use HMAC token auth.
- Plaid keys are **production** — treat all bank data as live.
- Object storage paths are validated server-side; never trust client-supplied paths.
- Never expose `DATABASE_URL`, `SESSION_SECRET`, or any `*_KEY` / `*_SECRET` variable in client bundles.
