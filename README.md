# OPERAFlow

Internal travel-operations platform: one secure backend, database, audit trail and reporting engine for

1. **Booking registry**: online (API/webhook/export) and offline (TBO, direct hotel, supplier email) bookings
2. **Daily operations reports**: scheduled, timezone-aware Excel/PDF with delivery history
3. **Supplier follow-ups**: Gmail / Microsoft 365 thread tracking with automatic follow-ups
4. **Booking-site test automation**: Playwright journeys against an authorised sandbox

> **Status: all 6 phases built and tested** (145 unit/integration tests and 9 browser E2E tests).
> The app has **not yet been deployed on Docker or connected to live external services**. Those need your
> environment and credentials. See [docs/STATUS.md](docs/STATUS.md) for what works now and what needs
> configuration.

## Documentation
| Document | For |
|---|---|
| [docs/STATUS.md](docs/STATUS.md) | What is done, verification results, limitations |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Installing, upgrading, backups, monitoring |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Day-to-day use by operations, managers, QA, admins |
| [docs/CREDENTIALS.md](docs/CREDENTIALS.md) | Every external credential and where it comes from |
| [docs/SECURITY.md](docs/SECURITY.md) | Security checklist |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design decisions, roles, data model |
| [docs/WEBHOOK.md](docs/WEBHOOK.md) | Spec for the booking website's signed webhook |

## Repository layout

```
apps/api        NestJS REST API (auth, RBAC, audit, modules)
apps/web        Next.js 15 + Tailwind UI (proxies /api/* to the API)
packages/db     Prisma schema, SQL migrations, seed
packages/shared Role/permission matrix, zod schemas, masking & timezone helpers
scripts/        dev-postgres.mjs (local PostgreSQL without Docker)
deploy/         Caddyfile, docker env template
docs/           Architecture, deployment, security, credentials, operations, status
```

## Quick start (already set up on this computer)

Double-click **`start-operaflow.cmd`**, or run:

```bash
npm run local
```

Wait for "OPERAFlow is running", then open http://localhost:3000. The local login is the newest `ADMIN` line in `.local/seed-credentials.txt`. Keep the window open while you use the app; close it (or press Ctrl+C) to stop.

## Local development (Windows/macOS/Linux, no Docker needed)

Requires Node.js ≥ 20.11 (developed on Node 24).

```bash
npm install
```

```bash
copy .env.example .env
```

Fill `ENCRYPTION_KEY` in `.env` (command in the file), then copy `.env` to `packages/db/.env` (Prisma reads it there).

```bash
npm run dev:db
```

Leave that running (real PostgreSQL 17 on port 5433, data in `.data/pg`). In a second terminal:

```bash
npm run db:generate && npm run build -w @operaflow/shared && npm run db:migrate && npm run db:seed
```

```bash
npm run dev:api
```

```bash
npm run dev:web
```

Open http://localhost:3000. The seeded admin password is in `.local/seed-credentials.txt` (gitignored),
unless you set `SEED_ADMIN_PASSWORD`. Change it after first sign-in.

## Quality gates

```bash
npm run lint
```

```bash
npm run typecheck
```

```bash
npm test
```

API tests are integration tests against a real PostgreSQL database (`TEST_DATABASE_URL`, truncated between tests; the reset refuses any database not named `*_test`). The Playwright tests need Chromium once:

```bash
npx playwright install chromium
```

Browser end-to-end tests (starts its own API on :4100 and web on :3100):

```bash
npm run e2e
```

Dependency gate:

```bash
node scripts/audit-check.mjs
```

## Deployment

Docker Compose with PostgreSQL, Redis, a migration job, API, web and Caddy (TLS). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
