# OPERAFlow

Internal travel-operations platform: one secure backend, database, audit trail and reporting engine for

1. **Booking registry**: online (API/webhook/export) and offline (TBO, direct hotel, supplier email) bookings
2. **Daily operations reports**: scheduled, timezone-aware Excel/PDF with delivery history
3. **Supplier follow-ups**: Gmail / Microsoft 365 thread tracking with automatic follow-ups
4. **Booking-site test automation**: Playwright journeys against an authorised sandbox

> **Status: Phases 1–2 of 6 complete.** Authentication, roles, audit, the full database schema and the
> unified booking registry are built and tested. The registry covers offline entry, CSV/Excel import, the
> signed webhook for online bookings, documents and reconciliation. Reports, follow-ups and booking-site
> tests come in Phases 3–5. See [docs/STATUS.md](docs/STATUS.md). The booking-website webhook spec is in
> [docs/WEBHOOK.md](docs/WEBHOOK.md).

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

API tests are integration tests against a real PostgreSQL database (`TEST_DATABASE_URL`, truncated between tests).

## Deployment

Docker Compose with PostgreSQL, Redis, a migration job, API, web and Caddy (TLS). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
