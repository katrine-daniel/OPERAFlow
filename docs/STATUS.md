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

## Phase 3: Reporting engine, scheduler, delivery ✅ (2026-11-07)

**Delivered**
- **Report engine:**
  - Reports on one organisation-local day (DST-safe): either bookings made that day or arrivals.
  - Optional filters for channel, source and supplier, and whether cancelled bookings are included.
  - Every field the brief lists is included.
  - Totals are per currency and never converted.
  - Missing values stay MISSING: excluded from totals, counted, and listed as warnings. The report also shows the open reconciliation issues.
- **Exports:**
  - **Excel:** Summary, Bookings and Warnings sheets, with frozen headers, auto-filter, highlighted MISSING cells, and formula-injection protection.
  - **PDF:** landscape, paginated. Characters outside Latin-1 are flagged, never silently dropped.
- **Schedules:**
  - Defined by time + weekdays + IANA timezone (stored as cron, upcoming runs shown).
  - Created disabled, and can only be enabled after a preview (enforced by both the API and a DB constraint).
  - Changing filters, formats or timezone disables the schedule until it is previewed again.
- **Approved recipients:** only administrators can approve them. Schedules can't use unapproved addresses, and delivery re-checks approval.
- **Delivery:**
  - Email goes through an SMTP relay (TLS required in production) with the XLSX/PDF attachments.
  - Optional Teams or Slack summary with no guest data. Webhook URLs are restricted to allow-listed hosts (SSRF guard) and stored encrypted.
  - Exactly one delivery row per (run, channel, recipient), with an atomic claim per attempt; retries only touch failed rows; an interrupted send is surfaced as "outcome unknown" rather than resent.
  - Failures notify the schedule owner.
- **Idempotency:** a scheduled run is keyed by schedule + report day, so a queue retry never produces a second report or duplicate emails.
- **Worker** (`apps/api/dist/worker.js`, compose service `worker`):
  - BullMQ on Redis, with one job scheduler per enabled schedule, synced from the DB every minute.
  - Nightly reconciliation (`RECONCILIATION_CRON`).
  - Every job is recorded in `job_executions`, with a heartbeat for health checks.
  - Refuses to start without `REDIS_URL`, and the UI then says "scheduler inactive".
- **UI:**
  - Reports page: schedules, preview, enable/disable, run & send, one-off report, approved recipients, run history.
  - Run detail page: summary, currency totals, deliveries with retry, warnings, downloads.
  - Integrations page: worker, SMTP and OAuth status; chat channels with a real "Test" button.
- **Safety fixes found during verification:**
  - Test reset now refuses any database not named `*_test`, and a root-level vitest run is blocked. A mis-directed test run had truncated the local dev database, which held only seed/test data and was re-seeded.
  - The login form uses `method="post"`, so a pre-hydration native submit can never put credentials in a URL.

**Verification**
| Check | Result |
|---|---|
| Lint, typecheck | pass |
| shared unit tests | 25/25 |
| API unit + integration (PostgreSQL 17, real SMTP server via `smtp-server`) | 59/59 (11 new) |
| Browser (admin) | Status banners show "scheduler inactive / email not configured" honestly → create schedule → preview (Dubai previous day) → run page → PDF download (`%PDF`, attachment) |
| Worker without Redis | Exits with an explicit "INACTIVE" message |
| BullMQ against a live Redis | **Not run**: no Redis on this machine. Job handlers and idempotency are tested directly; the BullMQ wiring is unverified until deployment. |

## Phase 4: Email OAuth, reply detection, automated follow-ups ✅ (2026-11-07)

**Delivered**
- **Mailbox connection:** OAuth authorisation-code flow with PKCE for Google (`gmail.modify`) and Microsoft 365 (`Mail.ReadWrite`, `Mail.Send`, `offline_access`).
  - The state is bound to the admin through an encrypted, 10-minute httpOnly cookie.
  - The mailbox address is read from the provider, never from the request.
  - Refresh tokens are AES-256-GCM encrypted and rotated when Microsoft issues new ones; access tokens are kept only in memory.
- **Provider adapters:** Gmail REST and Microsoft Graph behind one interface: list sent emails, read a thread, create a reply draft, send a draft, send a reply.
  - Gmail replies are threaded with `In-Reply-To`/`References`; Graph uses `createReply`.
  - Header-injection characters are stripped, and an expired token triggers one refresh and retry.
- **Tracking:** pick a sent email from the connected mailbox.
  - Recipients are the original external To/Cc addresses that are also approved contacts of the chosen supplier. Internal colleagues and unrelated addresses are never targeted.
  - A thread can be tracked only once.
- **Reply classification** (conservative):
  - A reply from the recipient, or a colleague on the same supplier domain (free-mail domains excluded), stops the timer.
  - Out-of-office, auto-reply (`Auto-Submitted`, `X-Autoreply`, `Precedence`) and internal messages are ignored.
  - Bounces and unknown senders move the thread to "Needs review".
- **Engine:**
  - 24/48/72h rules with business hours, business days and timezone (a follow-up due at the weekend waits for Monday morning), and a maximum follow-up count (then "No reply").
  - Draft-review mode by default: a draft is created in the mailbox and the owner approves the exact text. Before sending, the thread is re-checked, and nothing goes out if the supplier has replied.
  - AUTO_SEND only after an administrator approves it (API permission plus a DB CHECK constraint). Editing the rule or its template revokes the approval.
  - Exactly one execution per (thread, follow-up number), with atomic claims; failures are retried up to 3 times, then go to review; an interrupted send is surfaced, never blindly resent.
- **Manual controls:** pause, resume, cancel, mark as replied, reschedule, skip a draft, and "Check now".
  - Staff can act on their own threads; managers and admins on any.
  - Every action is audited, and owners are notified of drafts, replies, reviews and failures.
- **Worker:** a `followup-tick` job runs every `FOLLOWUP_POLL_MINUTES` (default 10).
- **UI:**
  - Follow-ups page: action queue, tracking wizard, rules (with admin auto-send approval) and template editor (placeholder-validated).
  - Conversation page: thread timeline with classifications, the draft to review, history, and actions.
  - Integrations page: connect mailbox, test, disable.

**Verification**
| Check | Result |
|---|---|
| Lint, typecheck | pass |
| shared unit tests | 25/25 |
| API tests | 88/88 (29 new) |

What the new API tests cover:
- **Pure logic (13 tests):** classifier, business-hours scheduling, templates and recipient safety.
- **Engine (9 tests):** runs against an in-memory mailbox test double. Covers once-only drafts, approval sending exactly the reviewed text, a reply cancelling a pending draft, OOO ignored, bounce goes to review, weekend deferral, the auto-send approval gate (API and DB), retry after failure, exhaustion, owner permissions, and template validation.
- **OAuth and adapters (7 tests, mocked network):**
  - OAuth: PKCE redirect, state-mismatch rejection, encrypted token storage.
  - Adapters: the Gmail raw MIME and header-injection guard; Gmail 401 → refresh → retry; the Graph `createReply` → `PATCH` → `send` sequence.

Browser: the follow-ups and integrations pages show truthful status ("no mailbox connected", "Google/Microsoft OAuth not configured", "worker not running").

**Not verified live:** no Google or Microsoft OAuth app or mailbox exists on this machine. The adapters follow the documented Gmail/Graph REST contracts and are tested against mocked HTTP only. The first real connection must be tested with a non-critical mailbox (see `docs/CREDENTIALS.md`).

## Phase 5: Playwright booking-site testing engine ✅ (2026-11-07)

**Delivered**
- **Environments:**
  - SANDBOX, STAGING or PRODUCTION_READONLY, https only.
  - Private/internal targets are refused in production (SSRF guard).
  - Credentials are write-only and encrypted, used in steps as `{{secret.key}}`.
  - Optional extra allowed hosts (e.g. a payment provider's test mode).
- **Scenario DSL** (data, not code; validated before any browser starts): `goto`, `fill`, `select`, `check`, `click`, `press`, `waitFor`, `expectVisible`, `expectHidden`, `expectText`, `expectCount`, `expectUrl`, `extract`, `screenshot`. Supports variables, relative dates (`{{date:+30}}`), secrets and extracted values (e.g. the booking reference).
- **Catalogue of 10 seeded journeys:** search, availability, rate selection, guest validation, create, confirm, modify, cancel, refund/cancellation policy, negative inputs. Each is flagged critical and/or "mutates bookings".
- **Safety guards** (checked pre-flight and again at run time):
  - Booking-mutating journeys run only on SANDBOX with mutations explicitly enabled (also a DB CHECK constraint).
  - A Luhn-valid card number that isn't a published test card is refused before the browser opens.
  - Every request to a host outside the environment's allow-list is aborted and listed.
  - PRODUCTION_READONLY aborts all non-GET requests except allow-listed paths.
  - Navigation outside the site is refused.
  - Secrets and card numbers are redacted from all stored errors and logs.
- **Runner:**
  - Chromium on desktop (1366×800) and mobile (iPhone 13 emulation).
  - Per-step timeouts and a 5-minute scenario cap.
  - Saves a step-by-step result with timings, a full-page screenshot on failure plus any `screenshot` steps, and a Playwright trace (replayable at trace.playwright.dev).
  - Collects diagnostics (blocked requests, HTTP 5xx, console errors, captured values).
- **Failure classification:** assertion, timeout, network, HTTP error, environment/config, safety guard, unknown.
- **Alerts:** a failed or blocked critical scenario notifies all admins and QA users.
- **Execution:** the worker's `tests` queue (concurrency 1) when Redis is configured, otherwise inline in the API (serialised).
  - Scheduled runs come from a cron per scenario plus its target environment.
  - Scheduled runs are idempotent per fire time and viewport.
- **UI:**
  - Testing dashboard: 24h stats, scenarios with run history and Run button, environments.
  - Scenario editor: JSON steps with an example, schedule, viewports, critical flag.
  - Run detail: steps, failure explanation, screenshots, trace download, diagnostics.
- **Docker:** the API/worker image installs Chromium and its system dependencies.

**Verification**
| Check | Result |
|---|---|
| Lint, typecheck | pass |
| shared unit tests | 25/25 |
| API tests | 103/103 (15 new) |
| Browser, end to end | Added "Demo sandbox (local)" environment (credentials not echoed back) → inserted example steps → **Run** → desktop + mobile PASSED; run page shows 7 timed steps, blocked third-party host, and a 1366×800 screenshot |

The 15 new API tests:
- **Unit (7):** DSL, interpolation, test-card policy, host allow-list, private hosts, failure classes, redaction.
- **Real Chromium, against a local DEMO sandbox booking site (8):**
  - Search passes on desktop and mobile, with trace and screenshots stored and the third-party host blocked.
  - Booking create on staging is blocked before a browser starts, and critical alerts are sent.
  - Create → confirm → cancel passes in an enabled sandbox (using a secret and an extracted reference).
  - A real-looking card is refused.
  - Assertion, timeout, HTTP 500 and unconfigured scenarios are each classified correctly.
  - Client-side guest validation works.
  - A production read-only environment blocks form POSTs.

**Needs configuration:**
- Scenario steps depend on the real booking website's HTML. All seeded scenarios start as "steps not configured".
- The website's sandbox URL, test accounts, and the payment provider's test-mode hosts must be supplied (see `docs/CREDENTIALS.md`).
- The demo sandbox (`npx tsx apps/api/test/fixtures/sandbox-site.ts`) exists only for trying the engine.

## Phase 6: Hardening, observability, E2E, deployment ✅ (2026-11-07)

**Delivered**
- **Data retention:** admin-editable periods with safety minimums, a nightly worker job, and "Run purge now". It purges sessions, read notifications, finished job records, test artifacts, report files (run history is kept) and old audit entries. Bookings are never purged.
- **Notifications:** a header bell with an unread count, mark read / mark all read, and links to the item. Owners are notified about drafts, replies, review needs, delivery failures and critical test failures.
- **Global search:** in the header (press `/`), across bookings, suppliers, follow-ups and test scenarios, limited to what each role may see.
- **Account management:** a "My account" page with password change (other sessions are signed out); admins can reset a user's password from Users & roles.
- **Clean error pages:** a "no access" page for forbidden areas, and an error page that shows a reference code instead of internals.
- **Observability:**
  - JSON logs with `X-Request-Id` on every response, and the request ID in error bodies.
  - Generic 500 responses that don't leak stack traces.
  - `/health/ready` (database + Redis) and Prometheus `/metrics` (bearer token): HTTP counters/latency plus business gauges.
- **Security:**
  - A strict content security policy on the web app.
  - The CI dependency gate (`scripts/audit-check.mjs`) with a reviewed allow-list.
  - Production dependency advisories cut from 12 (8 high) to 3, all from one accepted chain in the Prisma CLI. The fixes:
    - **zod** moved to v4. This upgrade exposed and fixed a dangerous change: defaults applied during partial updates would have reset booking status and occupancy, supplier timezones and report recipients. Regression tests now guard it.
    - **nodemailer** moved to 10 and **csv-parse** to 7.
    - Overrides pin patched **multer**, **uuid** and **postcss**.
- **Browser E2E suite** (`npm run e2e`, Playwright Test, real API + Next.js + PostgreSQL, desktop and mobile):
  - login errors, and the anonymous redirect;
  - role isolation (QA);
  - an offline booking with inline hotel, missing-data flags and the duplicate warning;
  - CSV import with preview, partial errors and commit;
  - reconciliation and global search;
  - recipient approval, report preview and XLSX download;
  - notifications and sign-out;
  - mobile layout with no horizontal scroll and a working drawer.
- **CI:** dependency gate → lint → typecheck → unit/integration (with Chromium) → build → E2E (report uploaded on failure) → Docker image builds and compose validation.
- **Deployment:** a worker service in compose, Chromium in the API image, `deploy/backup.sh` (database + storage, with a restore recipe), a full deployment guide with a first-deployment checklist, and monitoring guidance.

**Final verification (this machine)**
| Check | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` (4 workspaces) | pass |
| `packages/shared` unit tests | 25/25 |
| `apps/api` unit + integration (PostgreSQL 17, SMTP test server, real Chromium) | 111/111 |
| `npm run e2e` (browser, desktop + mobile) | 9/9 |
| `node scripts/audit-check.mjs` | pass (1 accepted advisory) |
| Production `next build` + standalone server | pass; strict CSP served, `/api` proxy working |
| Worker without Redis | refuses to start with an explicit "INACTIVE" message |
| Manual browser check | settings, search, notification bell, request IDs |
| Docker images / compose up | **not run here** (no Docker); built and validated in CI |

---

# Overall status

All six phases are built and tested. **This is not yet a verified production deployment.** The application has never run on Docker, and no live external integration has been connected. Both need your environment and credentials.

## What works without any external credentials
- Users and roles, the audit log, the dashboard, notifications and search.
- The booking registry: offline entry, CSV/Excel import, duplicate detection, reconciliation and documents.
- Report generation, preview and download.
- The booking-site test engine against any reachable sandbox. The local demo is `npx tsx apps/api/test/fixtures/sandbox-site.ts`.

## What needs configuration before it does anything
| Capability | Needs |
|---|---|
| Scheduled reports, follow-up polling, scheduled tests, nightly reconciliation and retention | `REDIS_URL` + the worker (provided by compose) |
| Report email | SMTP relay credentials |
| Teams/Slack summaries | A webhook URL |
| Supplier follow-ups | A Google or Microsoft OAuth app, then connect the mailbox (**adapters never run against a live mailbox**) |
| Online bookings in real time | The booking website must send signed webhooks (`docs/WEBHOOK.md`) |
| Website API polling sync, TBO live API | **Not built.** They need the vendors' API specifications and credentials; until then these sources are labelled manual/CSV. |
| Booking-site tests on the real site | Sandbox URL, test accounts, and scenario selectors that match the site's HTML |

## Known limitations
- No MFA or SSO yet. Recommended before exposing the app beyond the office network.
- Document and report storage is local disk (a compose volume). For multiple hosts, swap `StorageService` for S3 or Azure Blob.
- PDF reports use standard fonts; non-Latin characters are flagged and replaced (Excel keeps exact values).
- Timestamps in client-side widgets use the timezone baked in at web build time; server-rendered pages use runtime `DEFAULT_TIMEZONE`.
- Reconciliation's "missing in source" check needs a full export from the source system.
- The single in-process inline test runner (used without Redis) runs one browser at a time inside the API.
- Accepted dependency advisory: `deepmerge-ts` in the Prisma CLI (migration-time only); review by 2027-02-01.
