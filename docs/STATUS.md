# Delivery status

## Phase 1: Architecture, database, authentication, roles, shell ✅ (2026-11-06)

**Delivered**
- Monorepo (npm workspaces): `apps/api`, `apps/web`, `packages/db`, `packages/shared`
- Full PostgreSQL schema for all four modules (29 tables) + integrity migration (CHECK constraints, append-only audit trigger)
- Idempotent seed: booking sources, follow-up template and 24/48/72h rules (draft-review), test-scenario catalogue, retention settings
- Session auth, lockout, rate limits, CSRF origin check, RBAC guard, audit logging, AES-256-GCM secret encryption
- APIs: `/auth/login|logout|me|change-password`, `/users` (list, create, update, reset password, assignable), `/audit-logs`, `/dashboard/summary`, `/health`
- Web: sign-in, responsive shell with permission-aware navigation, live dashboard, users & roles, audit log; honest "scheduled for Phase N" pages
- Dockerfiles, compose stack (Postgres, Redis, migrate, api, web, Caddy), GitHub Actions CI

**Verification run on the dev machine**
| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` (4 workspaces) | pass |
| `packages/shared` unit tests | 14/14 pass |
| `apps/api` tests (unit + integration on real PostgreSQL 17) | 28/28 pass |
| `next build` (production) + standalone server smoke test | pass |
| Manual browser check: sign-in → dashboard → users → audit log; 375px mobile layout | pass |
| Docker image build / compose up | **not run**: Docker not installed on dev machine |

## Phase 2: Booking registry, imports, reconciliation ✅ (2026-11-07)

**Delivered**
- **Registry API + UI:** list with search and filters (channel, source, supplier, status, confirmation, booking or check-in date range in the organisation timezone, missing data), detail, offline form (with inline hotel creation), edit, confirm and cancel
- **Data rules:**
  - Internal refs `OF-YYYY-NNNNNN` come from a DB sequence.
  - Margin is computed, never stored, and is null whenever price or cost is missing.
  - Optimistic locking (`version`) prevents silent overwrites.
  - On online bookings, source-owned fields are locked for staff.
  - Cancelled bookings allow only payment, cost and owner changes.
  - Manual entry is allowed only for MANUAL sources.
- **Duplicate detection:** a fingerprint of hotel + normalised guest name (case, accents, titles, word order) + dates. The form warns and requires explicit confirmation.
- **Change history:** a field-level diff for every change. PII is recorded as "changed" only.
- **Supporting documents:** content-sniffed allow-list, 10 MB cap, random storage keys outside the web root, attachment-only downloads with sandbox CSP, and download auditing.
- **CSV/Excel import:**
  - Two steps: preview, then commit.
  - Flexible headers; DD/MM/YYYY and Excel date cells are understood.
  - Row-level errors; blank cells never erase data.
  - In-file duplicate detection; identical-file re-import is refused.
  - Atomic commit that can't run twice; optional "skip invalid rows".
- **Signed webhook for online bookings:**
  - HMAC-SHA256 with a 5-minute replay window; the secret is stored encrypted and shown once.
  - Idempotent per `eventId`; failed events can be redelivered; stale updates are ignored.
  - Cancellations are applied.
  - The source shows "Receiving data" only after verified delivery.
- **Reconciliation:**
  - Detects duplicates, online/offline amount and status mismatches, and missing data.
  - Issues are fingerprinted, so re-runs never duplicate them.
  - Issues auto-resolve when the cause is fixed; dismissals stick.
  - Every run is recorded as a job execution.
- **Directory:** suppliers (with approved contacts), hotels, and booking sources with an honest status per adapter.
- **Ops:** the dashboard uses the same "missing data" definition, times display in the organisation timezone, and documents persist on a compose volume.

**Verification run on the dev machine**
| Check | Result |
|---|---|
| Lint, typecheck (4 workspaces) | pass |
| `packages/shared` unit tests | 21/21 pass |
| `apps/api` unit + integration tests on PostgreSQL 17 | 48/48 pass (20 new for Phase 2) |
| Production `next build` | pass |
| Browser, as Ops Manager | Ran end to end: add supplier → new offline booking with inline hotel → detail shows missing cost and owner (not zero) → duplicate warning on a re-entry with the name reordered and accented differently → reconciliation run flags missing data → registry missing-data filter → sources page |
| Docker | not run (no Docker on the dev machine) |

**Not built (needs input)**
- **Booking website API polling:** needs the vendor's API spec and credentials. The webhook covers real-time sync if the website can send it (`docs/WEBHOOK.md`).
- **TBO live API:** needs authorised credentials. TBO bookings use manual entry or CSV for now.
- **`MISSING_IN_SOURCE` reconciliation:** needs a full snapshot export from the source to compare against.

## Remaining phases
- **Phase 3:** Worker (BullMQ/Redis), report engine (XLSX/PDF), schedules, approved recipients, delivery history & retries
- **Phase 4:** Gmail / Microsoft Graph OAuth, thread tracking, reply classification, follow-up engine
- **Phase 5:** Playwright test engine, environments, scheduled runs, artifacts, alerts
- **Phase 6:** E2E tests, hardening (MFA/SSO option, retention jobs, upload scanning), observability, deployment verification

## Known limitations
- No live integrations are configured (see `CREDENTIALS.md`).
- Redis is provisioned in compose but unused until Phase 3.
- The admin password-reset endpoint has no UI yet.
- Reconciliation is manual (button). It will be scheduled with the Phase 3 worker.
- Document storage is local disk (compose volume). For multi-host deployments, swap `StorageService` for S3 or Azure Blob.
- Client-side timestamps use the timezone baked in at web build time (`DEFAULT_TIMEZONE` during `next build`). Server-rendered pages use the runtime value.
- **Not production-ready**: modules 1–4 are not built, and the deployment has not been verified.
