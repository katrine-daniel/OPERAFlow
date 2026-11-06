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

## Remaining phases
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
